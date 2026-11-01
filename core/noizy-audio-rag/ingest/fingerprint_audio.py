#!/usr/bin/env python3
"""Audio fingerprinter — multi-volume SHA-256 engine.
Scans all NOIZY canonical volume paths or a custom input.
Override via NOIZY_SCAN_ROOTS (colon-sep), NOIZY_INPUT_PATH, or pass path as argv[1].
NOIZY_CANARY=N limits to first N files (0 = unlimited).
"""
import hashlib
import json
import os
import sys
from pathlib import Path

AUDIO_EXTS = {'.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a',
              '.nki', '.nkx', '.nkm', '.nksn'}

CANONICAL_ROOTS: list[str] = [
    "/Volumes/12TB/_02.Instruments",
    "/Volumes/12TB/AUDIO_SFX_LIBRARY",
    "/Volumes/12TB/_01.AUDIO FROM ALL",
    "/Volumes/12TB/_Spectrasonics_3rd_Party",
    "/Volumes/4TB Lacie/RSP_ORIGINAL_WORK",
    "/Volumes/4TB Lacie/FISH_MUSIC",
    "/Volumes/4TB Lacie/SAMPLES",
    "/Volumes/4TB Lacie/MISSION_CONTROL_96",
    "/Volumes/2TB_SGW/RSP_ORIGINAL_WORK",
    "/Volumes/2TB_SGW/FISH_MUSIC",
    "/Volumes/NOIZY_POOL_A/NOIZY_SAMPLE_MASTER",
    "/Volumes/3TB-GRF/MC96ECOUNIVERSE",
    "/Volumes/MAG 4TB/01_Drums",
    "/Volumes/MAG 4TB/02_EastWest",
    "/Volumes/MAG 4TB/NOIZYFISH_THE_AQAURIUM",
    "/Volumes/NOIZY_POOL_B/FOR SORTING",
]


def fingerprint(path: Path) -> dict:
    h = hashlib.sha256()
    size = 0
    try:
        with path.open('rb') as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b''):
                h.update(chunk)
                size += len(chunk)
    except OSError as e:
        return {'path': str(path), 'sha256': None, 'size_bytes': 0, 'error': str(e)}
    return {
        'path': str(path),
        'sha256': h.hexdigest(),
        'size_bytes': size,
        'ext': path.suffix.lower(),
    }


def resolve_roots() -> list[Path]:
    if len(sys.argv) > 1:
        return [Path(sys.argv[1])]
    env_roots = os.environ.get('NOIZY_SCAN_ROOTS', '')
    single = os.environ.get('NOIZY_INPUT_PATH', '')
    if env_roots:
        return [Path(r) for r in env_roots.split(':') if r.strip()]
    if single:
        return [Path(single)]
    return [Path(r) for r in CANONICAL_ROOTS]


def main() -> None:
    canary = int(os.environ.get('NOIZY_CANARY', '0'))
    roots = resolve_roots()
    rows: list[dict] = []

    for root in roots:
        if not root.exists():
            continue
        for p in sorted(root.rglob('*')):
            if not p.is_file():
                continue
            if p.suffix.lower() not in AUDIO_EXTS:
                continue
            rows.append(fingerprint(p))
            if canary and len(rows) >= canary:
                break
        if canary and len(rows) >= canary:
            break

    sha_set: set[str] = set()
    duplicates = 0
    for r in rows:
        sha = r.get('sha256')
        if sha:
            if sha in sha_set:
                r['duplicate'] = True
                duplicates += 1
            else:
                sha_set.add(sha)
                r['duplicate'] = False

    print(json.dumps({
        'total_fingerprinted': len(rows),
        'duplicates_detected': duplicates,
        'roots': [str(r) for r in roots],
        'files': rows,
    }, indent=2))


if __name__ == '__main__':
    main()
