#!/usr/bin/env python3
"""Drive inventory scanner — multi-volume aware.
Scans all NOIZY canonical volume paths or a custom root.
Override scan roots via NOIZY_SCAN_ROOTS (colon-separated) or NOIZY_INPUT_PATH.
"""
import json
import os
from pathlib import Path

# All canonical NOIZY volume roots (commercial + personal)
CANONICAL_ROOTS: list[str] = [
    # Commercial libraries
    "/Volumes/12TB/_02.Instruments",
    "/Volumes/12TB/AUDIO_SFX_LIBRARY",
    "/Volumes/12TB/_Spectrasonics_3rd_Party",
    "/Volumes/12TB/_WAVE",
    "/Volumes/4TB Lacie/SAMPLES",
    "/Volumes/MAG 4TB/01_Drums",
    "/Volumes/MAG 4TB/02_EastWest",
    "/Volumes/NOIZY_POOL_A/NOIZY_SAMPLE_MASTER",
    "/Volumes/NOIZY_POOL_A/_ORGANIZED",
    "/Volumes/Hollywood Orchestra Mac/Play Libraries",
    # Personal career catalog
    "/Volumes/4TB Lacie/RSP_ORIGINAL_WORK",
    "/Volumes/4TB Lacie/FISH_MUSIC",
    "/Volumes/4TB Lacie/MISSION_CONTROL_96",
    "/Volumes/2TB_SGW/RSP_ORIGINAL_WORK",
    "/Volumes/2TB_SGW/FISH_MUSIC",
    "/Volumes/2TB_SGW/MISSION_CONTROL_96",
    "/Volumes/12TB/_01.AUDIO FROM ALL",
    "/Volumes/12TB/NOIZYLAB_ARCHIVES",
    "/Volumes/12TB/MissionControl96",
    "/Volumes/3TB-GRF/MC96ECOUNIVERSE",
    "/Volumes/NOIZY_POOL_A/NOIZY_CLOUD_CONSOLIDATION",
    "/Volumes/MAG 4TB/NOIZYFISH_THE_AQAURIUM",
    "/Volumes/NOIZY_POOL_B/FOR SORTING",
]

AUDIO_EXTS = {'.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg', '.m4a',
              '.nki', '.nkx', '.nkm', '.nksn', '.mid', '.midi'}


def scan_root(root: Path) -> dict:
    if not root.exists():
        return {'root': str(root), 'status': 'NOT_MOUNTED', 'files': 0}
    files = 0
    bytes_total = 0
    exts: dict[str, int] = {}
    audio_files = 0
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        files += 1
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        bytes_total += size
        ext = path.suffix.lower() or '[none]'
        exts[ext] = exts.get(ext, 0) + 1
        if ext in AUDIO_EXTS:
            audio_files += 1
    return {
        'root': str(root),
        'status': 'SCANNED',
        'files': files,
        'audio_files': audio_files,
        'bytes_total': bytes_total,
        'gb': round(bytes_total / 1e9, 3),
        'top_extensions': sorted(exts.items(), key=lambda x: x[1], reverse=True)[:20],
    }


def resolve_roots() -> list[Path]:
    env_roots = os.environ.get('NOIZY_SCAN_ROOTS', '')
    single = os.environ.get('NOIZY_INPUT_PATH', '')
    if env_roots:
        return [Path(r) for r in env_roots.split(':') if r.strip()]
    if single:
        return [Path(single)]
    return [Path(r) for r in CANONICAL_ROOTS]


def main() -> None:
    roots = resolve_roots()
    results = []
    total_files = 0
    total_bytes = 0
    total_audio = 0
    for root in roots:
        r = scan_root(root)
        results.append(r)
        total_files += r.get('files', 0)
        total_bytes += r.get('bytes_total', 0)
        total_audio += r.get('audio_files', 0)

    print(json.dumps({
        'scan_type': 'multi_volume_drive_inventory',
        'roots_scanned': len(results),
        'total_files': total_files,
        'total_audio_files': total_audio,
        'total_bytes': total_bytes,
        'total_gb': round(total_bytes / 1e9, 2),
        'results': results,
    }, indent=2))


if __name__ == '__main__':
    main()
