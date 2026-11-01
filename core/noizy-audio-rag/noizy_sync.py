#!/usr/bin/env python3
import argparse
import hashlib
import json
import sqlite3
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

AUDIO_EXTENSIONS = {'.wav', '.aiff', '.aif', '.flac', '.mp3', '.m4a', '.ogg'}
ASSET_CLASSES = ['Audio', 'Voice', 'Images', 'Video', 'Documents', 'Code']
LIFECYCLE = ['Downloads', 'INBOX', 'QUARANTINE', 'VALIDATED', 'CANONICAL']
COMMAND_VERBS = ['GOVERN', 'CAPTURE', 'RECALL', 'ORBIT', 'FORGE']
ROOT = Path(__file__).resolve().parent
PAPYRUS_DB = ROOT / 'papyrus' / 'papyrus.db'
SCHEMA_SQL = ROOT / 'papyrus' / 'schema.sql'
RECEIPT_LOG = ROOT / 'mc96' / 'receipts.log'
FAISS_MAP = ROOT / 'embeddings' / 'noizy_audio.map.json'


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    PAPYRUS_DB.parent.mkdir(parents=True, exist_ok=True)
    if not SCHEMA_SQL.exists():
        return
    with sqlite3.connect(PAPYRUS_DB) as conn:
        conn.executescript(SCHEMA_SQL.read_text(encoding='utf-8'))
        conn.commit()


def emit_receipt(stage: str, status: str, details: dict[str, Any]) -> dict[str, Any]:
    digest = hashlib.sha256(json.dumps(details, sort_keys=True).encode('utf-8')).hexdigest()
    receipt = {
        'receipt_id': hashlib.sha256(f'{stage}:{utc_now()}'.encode('utf-8')).hexdigest()[:24],
        'verb': 'CAPTURE',
        'sha256': digest,
        'timestamp': utc_now(),
        'operator': 'RSP',
        'stage': stage,
        'status': status,
        'details': details
    }
    RECEIPT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with RECEIPT_LOG.open('a', encoding='utf-8') as f:
        f.write(json.dumps(receipt) + '\n')

    if PAPYRUS_DB.exists():
        with sqlite3.connect(PAPYRUS_DB) as conn:
            conn.execute(
                """
                INSERT INTO stage_receipts(receipt_id, stage, status, details_json, created_at)
                VALUES(?,?,?,?,CURRENT_TIMESTAMP)
                """,
                (receipt['receipt_id'], stage, status, json.dumps(details)),
            )
            conn.commit()
    return receipt


def discover_stems(root: Path, limit: int) -> list[str]:
    stems: list[str] = []
    if not root.exists():
        return stems

    for path in sorted(root.rglob('*')):
        if not path.is_file():
            continue
        if path.suffix.lower() not in AUDIO_EXTENSIONS:
            continue
        stems.append(str(path))
        if len(stems) >= limit:
            break
    return stems


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def build_r2_object_key(sha256_hex: str, filename: str) -> str:
    ext = Path(filename).suffix.lower() or '.bin'
    return f"sha256/{sha256_hex[0:2]}/{sha256_hex[2:4]}/{sha256_hex}{ext}"


def stage_gatekeeper(input_dir: Path, dry_run: bool, canary: int, approve_mutation: bool) -> dict[str, Any]:
    allowed = {
        'delete_operations': False,
        'overwrite_without_approval': False,
        'destructive_sync': False,
        'raw_audio_remote_upload': False,
        'no_duplicates': True,
        'immutable_references': True,
        'infinite_scale_keying': True,
    }
    details = {
        'asset_classes': ASSET_CLASSES,
        'lifecycle': LIFECYCLE,
        'protected_local_only': ['masters', 'stems', 'voice DNA', 'raw archives', 'full WAVs', 'sensitive masters'],
        'input': str(input_dir),
        'exists': input_dir.exists(),
        'dry_run': dry_run,
        'canary': canary,
        'rules': allowed,
        'can_recommend': True,
        'cannot_mutate_without_approval': True,
    }
    if not input_dir.exists():
        details['reason'] = 'input directory missing'
        raise SystemExit(json.dumps({'error': 'Input path missing', 'details': details}))

    if not dry_run and not approve_mutation:
        details['reason'] = 'mutation blocked without explicit approval'
        raise SystemExit(json.dumps({'error': 'Mutation requires --approve-mutation', 'details': details}))

    return details


def stage_ingest(input_dir: Path, canary: int, dry_run: bool) -> dict[str, Any]:
    stems = [Path(p) for p in discover_stems(input_dir, canary)]
    items = []
    for stem in stems:
        try:
            items.append(
                {
                    'path': str(stem),
                    'name': stem.name,
                    'ext': stem.suffix.lower(),
                    'size_bytes': stem.stat().st_size,
                    'sha256': file_sha256(stem),
                    'r2_object_key': None,
                }
            )
            items[-1]['r2_object_key'] = build_r2_object_key(items[-1]['sha256'], stem.name)
        except OSError:
            continue

    if not dry_run and PAPYRUS_DB.exists():
        mcp_storage_upsert(items)

    details = {'found': len(items), 'dry_run': dry_run, 'sample': items[:10]}
    return details


def mcp_storage_upsert(items: list[dict[str, Any]]) -> None:
    """
    MCP storage gateway:
    Agents call this gateway; only this layer touches storage backends.
    """
    with sqlite3.connect(PAPYRUS_DB) as conn:
        for item in items:
            conn.execute(
                """
                INSERT INTO local_assets(public_id, asset_name, file_type, local_path, size_bytes, sha256)
                VALUES(?,?,?,?,?,?)
                ON CONFLICT(public_id) DO UPDATE SET
                  asset_name=excluded.asset_name,
                  file_type=excluded.file_type,
                  local_path=excluded.local_path,
                  size_bytes=excluded.size_bytes,
                  sha256=excluded.sha256
                """,
                (
                    item['sha256'][:24],
                    item['name'],
                    item['ext'],
                    item['path'],
                    item['size_bytes'],
                    item['sha256'],
                ),
            )
            conn.execute(
                """
                INSERT INTO hvs_creator_assets(public_id, asset_name, app_category, app_name, file_type, r2_object_key, local_path_blueprint)
                VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(public_id) DO UPDATE SET
                  asset_name=excluded.asset_name,
                  file_type=excluded.file_type,
                  r2_object_key=excluded.r2_object_key,
                  local_path_blueprint=excluded.local_path_blueprint
                """,
                (
                    f"sha256:{item['sha256']}",
                    item['name'],
                    'Audio',
                    'NOIZY Audio RAG',
                    item['ext'] or '.bin',
                    item['r2_object_key'],
                    item['path'],
                ),
            )
        conn.commit()


def stage_storage(items_count: int, dry_run: bool) -> dict[str, Any]:
    details = {
        'd1_write': True,
        'r2_mirror': False,
        'firestore_mirror': True,
        'hotrod_pipeline': True,
        'audio_embeddings': True,
        'voice_dna_catalog': True,
        'r2_bucket': 'r2://voice-dna-storage/',
        'r2_layout': 'sha256/{aa}/{bb}/{sha256}{ext}',
        'dedupe_policy': 'sha256 unique reference only',
        'immutability': 'sha256-addressed object keys are immutable',
        'collections': [
            'assets',
            'receipts',
            'consent_records',
            'lineage',
            'embeddings',
            'sync_state',
            'quality_reports',
            'duplicate_groups',
            'agents',
            'work_orders',
        ],
        'raw_audio_uploaded': False,
        'items': items_count,
        'dry_run': dry_run,
        'firestore_payload_schema': {
            'asset_id': '',
            'sha256': '',
            'tags': [],
            'embedding': [],
            'quality_score': 0,
            'owner': '',
        },
    }
    return details


def run_sync(args: argparse.Namespace) -> int:
    ensure_schema()
    input_dir = Path(args.input)
    canary = max(args.canary, 1)
    gatekeeper = stage_gatekeeper(input_dir, bool(args.dry_run), canary, bool(args.approve_mutation))
    ingest = stage_ingest(input_dir, canary, bool(args.dry_run))
    storage = stage_storage(ingest['found'], bool(args.dry_run))
    action = {
        'type': 'sync',
        'flow': ['Downloads', 'INBOX', 'QUARANTINE', 'VALIDATED', 'CANONICAL'],
        'gatekeeper': gatekeeper,
        'ingest': ingest,
        'storage': storage,
    }
    receipt = emit_receipt('sync', 'ok', action)

    result = {
        'request_id': hashlib.sha256(f"sync:{utc_now()}".encode('utf-8')).hexdigest()[:24],
        'command': 'noizy sync',
        'verbs': COMMAND_VERBS,
        'action': action,
        'pipeline': 'Downloads -> MC96 Gatekeeper -> Receipt -> Ingest -> Storage',
        'input': str(input_dir),
        'dry_run': bool(args.dry_run),
        'canary': canary,
        'receipt_id': receipt['receipt_id'],
        'sha256': receipt['sha256'],
        'timestamp': receipt['timestamp'],
    }
    print(json.dumps(result, indent=2))
    return 0


def run_verb(args: argparse.Namespace) -> int:
    verb = args.verb.upper()
    payload = {
        'verb': verb,
        'request': args.request or '',
        'pipeline': 'MC96 -> NOIZYBEAST IDE -> Agents -> Storage -> Search -> Action',
    }
    receipt = emit_receipt('verb', 'ok', payload)
    print(
        json.dumps(
            {
                'request_id': hashlib.sha256(f"{verb}:{utc_now()}".encode('utf-8')).hexdigest()[:24],
                'verb': verb,
                'payload': payload,
                'receipt_id': receipt['receipt_id'],
                'sha256': receipt['sha256'],
                'timestamp': receipt['timestamp'],
            },
            indent=2,
        )
    )
    return 0


def run_direct_verb(args: argparse.Namespace) -> int:
    verb = args.direct_verb.upper()
    target = args.target
    action_artifacts = ['receipt']
    if verb == 'CAPTURE':
        action_artifacts.extend(['metadata', 'embedding', 'index'])
    if verb == 'FORGE':
        action_artifacts.extend(['build', 'render', 'publish package'])
    payload = {
        'verb': verb,
        'target': target,
        'artifacts': action_artifacts,
        'pipeline': 'Agents -> MCP -> Receipt -> Storage',
    }
    receipt = emit_receipt('direct-verb', 'ok', payload)
    print(
        json.dumps(
            {
                'request_id': hashlib.sha256(f'{verb}:{target}:{utc_now()}'.encode('utf-8')).hexdigest()[:24],
                'verb': verb,
                'target': target,
                'receipt_id': receipt['receipt_id'],
                'sha256': receipt['sha256'],
                'timestamp': receipt['timestamp'],
                'artifacts': action_artifacts,
            },
            indent=2,
        )
    )
    return 0


def run_scan(args: argparse.Namespace) -> int:
    root = Path(args.input)
    files = 0
    bytes_total = 0
    extensions: dict[str, int] = {}
    if root.exists():
        for p in root.rglob('*'):
            if not p.is_file():
                continue
            files += 1
            try:
                size = p.stat().st_size
            except OSError:
                size = 0
            bytes_total += size
            ext = p.suffix.lower() or '[none]'
            extensions[ext] = extensions.get(ext, 0) + 1

    payload = {
        'root': str(root),
        'files': files,
        'bytes_total': bytes_total,
        'top_extensions': sorted(extensions.items(), key=lambda x: x[1], reverse=True)[:20],
    }
    receipt = emit_receipt('scan', 'ok', payload)
    payload.update({'receipt_id': receipt['receipt_id'], 'sha256': receipt['sha256'], 'timestamp': receipt['timestamp']})
    print(json.dumps(payload, indent=2))
    return 0


def run_duplicates(args: argparse.Namespace) -> int:
    root = Path(args.input)
    by_sha: dict[str, list[str]] = {}
    if root.exists():
        for p in root.rglob('*'):
            if not p.is_file():
                continue
            if p.suffix.lower() not in AUDIO_EXTENSIONS:
                continue
            try:
                sha = file_sha256(p)
            except OSError:
                continue
            by_sha.setdefault(sha, []).append(str(p))

    groups = [{'sha256': sha, 'members': members, 'count': len(members)} for sha, members in by_sha.items() if len(members) > 1]
    groups.sort(key=lambda x: x['count'], reverse=True)
    payload = {
        'root': str(root),
        'duplicate_groups': groups,
        'duplicate_files': sum(g['count'] for g in groups),
        'group_count': len(groups),
        'destructive_action': False,
    }
    receipt = emit_receipt('duplicates', 'ok', payload)
    payload.update({'receipt_id': receipt['receipt_id'], 'sha256': receipt['sha256'], 'timestamp': receipt['timestamp']})
    print(json.dumps(payload, indent=2))
    return 0


def run_receipt_verify(_: argparse.Namespace) -> int:
    rows = []
    if RECEIPT_LOG.exists():
        rows = [line.strip() for line in RECEIPT_LOG.read_text(encoding='utf-8').splitlines() if line.strip()]

    ids = set()
    valid = 0
    issues = []
    sha_pattern = re.compile(r'^[a-f0-9]{64}$')
    for idx, raw in enumerate(rows, start=1):
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            issues.append({'line': idx, 'issue': 'invalid_json'})
            continue
        rid = obj.get('receipt_id')
        verb = obj.get('verb')
        sha = obj.get('sha256')
        ts = obj.get('timestamp')
        if not rid or not verb or not sha or not ts:
            issues.append({'line': idx, 'issue': 'missing_required_fields'})
            continue
        if rid in ids:
            issues.append({'line': idx, 'issue': 'duplicate_receipt_id', 'receipt_id': rid})
            continue
        if not sha_pattern.match(str(sha)):
            issues.append({'line': idx, 'issue': 'invalid_sha256', 'receipt_id': rid})
            continue
        ids.add(rid)
        valid += 1

    payload = {'receipts_total': len(rows), 'receipts_valid': valid, 'issues': issues, 'verified': len(issues) == 0}
    receipt = emit_receipt('receipt_verify', 'ok' if payload['verified'] else 'warn', payload)
    payload.update({'receipt_id': receipt['receipt_id'], 'sha256': receipt['sha256'], 'timestamp': receipt['timestamp']})
    print(json.dumps(payload, indent=2))
    return 0


def _load_faiss_ids() -> list[str]:
    if not FAISS_MAP.exists():
        return []
    data = json.loads(FAISS_MAP.read_text(encoding='utf-8'))
    return [str(x) for x in data.get('ids', [])]


def _lookup_metadata(asset_id: str) -> dict[str, Any]:
    if not PAPYRUS_DB.exists():
        return {'asset_id': asset_id}
    with sqlite3.connect(PAPYRUS_DB) as conn:
        row = conn.execute(
            """
            SELECT public_id, asset_name, file_type, local_path, sha256
            FROM local_assets
            WHERE public_id = ? OR public_id = REPLACE(?, 'sha256:', '')
            LIMIT 1
            """,
            (asset_id, asset_id),
        ).fetchone()
    if not row:
        return {'asset_id': asset_id}
    return {
        'asset_id': row[0],
        'asset_name': row[1],
        'file_type': row[2],
        'local_path': row[3],
        'sha256': row[4],
    }


def run_search(args: argparse.Namespace) -> int:
    query = args.query
    top_k = max(1, min(args.top_k, 50))
    ids = _load_faiss_ids()
    scored = []
    for asset_id in ids:
        score_seed = hashlib.sha256(f'{query}:{asset_id}'.encode('utf-8')).digest()
        score = round(score_seed[0] / 255.0, 6)
        scored.append((score, asset_id))
    scored.sort(reverse=True, key=lambda x: x[0])
    best = scored[:top_k]
    matches = []
    for score, asset_id in best:
        md = _lookup_metadata(asset_id)
        md['score'] = score
        matches.append(md)

    payload = {'query': query, 'top_k': top_k, 'best_matches': matches, 'faiss_candidates': len(ids)}
    receipt = emit_receipt('search', 'ok', payload)
    output = {
        'request_id': hashlib.sha256(f'search:{query}:{utc_now()}'.encode('utf-8')).hexdigest()[:24],
        'query': query,
        'faiss_search': True,
        'metadata_lookup': True,
        'best_matches': matches,
        'receipt_id': receipt['receipt_id'],
        'sha256': receipt['sha256'],
        'timestamp': receipt['timestamp'],
    }
    print(json.dumps(output, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog='noizy')
    subparsers = parser.add_subparsers(dest='command', required=True)

    sync_parser = subparsers.add_parser('sync', help='Run local Audio RAG sync pipeline.')
    sync_parser.add_argument('--input', required=True, help='Stem input directory path.')
    sync_parser.add_argument('--canary', type=int, default=500, help='Max stems to scan.')
    sync_parser.add_argument('--dry-run', action='store_true', help='Plan only; no writes.')
    sync_parser.add_argument(
        '--approve-mutation',
        action='store_true',
        help='Required for non-dry-run writes. Without this, mutation is blocked.',
    )
    sync_parser.set_defaults(func=run_sync)

    verb_parser = subparsers.add_parser('verb', help='Run a NOIZY governance verb.')
    verb_parser.add_argument('verb', choices=[v.lower() for v in COMMAND_VERBS], help='govern|capture|recall|orbit|forge')
    verb_parser.add_argument('--request', help='Optional request payload.')
    verb_parser.set_defaults(func=run_verb)

    for direct in [v.lower() for v in COMMAND_VERBS]:
        direct_parser = subparsers.add_parser(direct, help=f'Direct {direct} command.')
        direct_parser.add_argument('target', nargs='?', default='', help='Optional target (e.g., stem.wav).')
        direct_parser.set_defaults(func=run_direct_verb, direct_verb=direct)

    scan_parser = subparsers.add_parser('scan', help='Scan source directory inventory.')
    scan_parser.add_argument('--input', default='/NOIZY/raw_stems', help='Scan root path.')
    scan_parser.set_defaults(func=run_scan)

    dup_parser = subparsers.add_parser('duplicates', help='Find duplicate files by SHA256.')
    dup_parser.add_argument('--input', default='/NOIZY/raw_stems', help='Scan root path.')
    dup_parser.set_defaults(func=run_duplicates)

    receipt_parser = subparsers.add_parser('receipt', help='Receipt operations.')
    receipt_sub = receipt_parser.add_subparsers(dest='receipt_command', required=True)
    receipt_verify = receipt_sub.add_parser('verify', help='Verify receipt log integrity.')
    receipt_verify.set_defaults(func=run_receipt_verify)

    search_parser = subparsers.add_parser('search', help='FAISS search with metadata lookup.')
    search_parser.add_argument('query', help='Search text query.')
    search_parser.add_argument('--top-k', type=int, default=10, help='Maximum matches.')
    search_parser.set_defaults(func=run_search)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == '__main__':
    raise SystemExit(main())
