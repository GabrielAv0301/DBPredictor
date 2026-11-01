#!/usr/bin/env python3
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'papyrus' / 'papyrus.db'
OUT = ROOT / 'embeddings' / 'embeddings.jsonl'


def fake_embedding(seed: str, dims: int = 16) -> list[float]:
    digest = hashlib.sha256(seed.encode('utf-8')).digest()
    return [round((digest[i % len(digest)] / 255.0), 6) for i in range(dims)]


def main() -> None:
    rows = []
    with sqlite3.connect(DB) as conn:
        for public_id, sha256 in conn.execute('SELECT public_id, sha256 FROM local_assets ORDER BY created_at DESC LIMIT 500'):
            rows.append({'asset_id': public_id, 'sha256': sha256, 'embedding': fake_embedding(sha256)})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open('w', encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row) + '\n')
    print(json.dumps({'written': len(rows), 'path': str(OUT)}))


if __name__ == '__main__':
    main()
