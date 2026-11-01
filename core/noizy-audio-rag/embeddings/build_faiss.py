#!/usr/bin/env python3
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'embeddings' / 'embeddings.jsonl'
OUT_INDEX = ROOT / 'embeddings' / 'noizy_audio.index'
OUT_MAP = ROOT / 'embeddings' / 'noizy_audio.map.json'


def main() -> None:
    records = []
    if SRC.exists():
        with SRC.open('r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                records.append(json.loads(line))

    # Local-first placeholder index artifact.
    OUT_INDEX.write_text('FAISS_PLACEHOLDER_INDEX\n', encoding='utf-8')
    OUT_MAP.write_text(json.dumps({'count': len(records), 'ids': [r['asset_id'] for r in records]}, indent=2), encoding='utf-8')
    print(json.dumps({'indexed': len(records), 'index': str(OUT_INDEX), 'map': str(OUT_MAP)}))


if __name__ == '__main__':
    main()
