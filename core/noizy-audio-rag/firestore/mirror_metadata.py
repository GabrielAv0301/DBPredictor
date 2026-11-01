#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'papyrus' / 'papyrus.db'
OUT = ROOT / 'firestore' / 'mirror_payload.json'


def build_payload(limit: int = 500) -> list[dict]:
    rows = []
    with sqlite3.connect(DB) as conn:
        query = """
        SELECT public_id, sha256
        FROM local_assets
        ORDER BY created_at DESC
        LIMIT ?
        """
        for public_id, sha256 in conn.execute(query, (limit,)):
            rows.append(
                {
                    'asset_id': public_id,
                    'sha256': sha256,
                    'tags': [],
                    'embedding': [],
                    'quality_score': 0,
                    'owner': 'RSP',
                }
            )
    return rows


if __name__ == '__main__':
    payload = build_payload()
    OUT.write_text(json.dumps({'assets': payload, 'metadata_only': True}, indent=2), encoding='utf-8')
    print(json.dumps({'mirrored_count': len(payload), 'path': str(OUT)}))
