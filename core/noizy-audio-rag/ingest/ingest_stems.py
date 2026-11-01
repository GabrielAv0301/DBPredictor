#!/usr/bin/env python3
"""Stem ingestor — multi-volume aware.
Reads from all NOIZY canonical volume paths.
Override via NOIZY_SCAN_ROOTS (colon-sep) or NOIZY_INPUT_PATH.
NOIZY_CANARY=N limits to first N files per root (0 = unlimited).
"""
import json
import os
import sys
from pathlib import Path

AUDIO_EXTS = {'.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a',
              '.nki', '.nkx', '.mid', '.midi'}

CANONICAL_ROOTS: list[str] = [
    # Commercial
    "/Volumes/12TB/_02.Instruments",
    "/Volumes/12TB/AUDIO_SFX_LIBRARY",
    "/Volumes/12TB/_Spectrasonics_3rd_Party",
    "/Volumes/4TB Lacie/SAMPLES",
    "/Volumes/MAG 4TB/01_Drums",
    "/Volumes/MAG 4TB/02_EastWest",
    "/Volumes/NOIZY_POOL_A/NOIZY_SAMPLE_MASTER",
    # Personal
    "/Volumes/12TB/_01.AUDIO FROM ALL",
    "/Volumes/4TB Lacie/RSP_ORIGINAL_WORK",
    "/Volumes/4TB Lacie/FISH_MUSIC",
    "/Volumes/4TB Lacie/MISSION_CONTROL_96",
    "/Volumes/2TB_SGW/RSP_ORIGINAL_WORK",
    "/Volumes/2TB_SGW/FISH_MUSIC",
    "/Volumes/3TB-GRF/MC96ECOUNIVERSE",
    "/Volumes/MAG 4TB/NOIZYFISH_THE_AQAURIUM",
    "/Volumes/NOIZY_POOL_B/FOR SORTING",
]

ROOT_DIR = Path(__file__).resolve().parents[1]


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


def run(roots: list[Path]) -> dict:
    canary = int(os.environ.get('NOIZY_CANARY', '0'))
    total = 0
    per_root: list[dict] = []
    for root in roots:
        if not root.exists():
            per_root.append({'root': str(root), 'status': 'NOT_MOUNTED', 'files_seen': 0})
            continue
        count = 0
        for path in root.rglob('*'):
            if path.is_file() and path.suffix.lower() in AUDIO_EXTS:
                count += 1
                if canary and count >= canary:
                    break
        total += count
        per_root.append({'root': str(root), 'status': 'SCANNED', 'files_seen': count})
    return {
        'stage': 'ingest',
        'roots_scanned': len(roots),
        'total_files_seen': total,
        'per_root': per_root,
    }


if __name__ == '__main__':
    print(json.dumps(run(resolve_roots()), indent=2))
