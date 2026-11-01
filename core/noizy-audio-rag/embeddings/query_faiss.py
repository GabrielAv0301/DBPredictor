#!/usr/bin/env python3
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAP = ROOT / 'embeddings' / 'noizy_audio.map.json'


def main() -> None:
    query = sys.argv[1] if len(sys.argv) > 1 else 'audio'
    if not MAP.exists():
        print(json.dumps({'query': query, 'results': [], 'reason': 'index map missing'}))
        return
    data = json.loads(MAP.read_text(encoding='utf-8'))
    ids = data.get('ids', [])[:10]
    print(json.dumps({'query': query, 'results': [{'asset_id': i, 'score': 0.9} for i in ids]}, indent=2))


if __name__ == '__main__':
    main()
