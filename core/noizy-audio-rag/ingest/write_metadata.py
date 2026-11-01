#!/usr/bin/env python3
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'papyrus' / 'papyrus.db'


def write_asset_metadata(payload: dict) -> None:
    with sqlite3.connect(DB) as conn:
        conn.execute(
            """
            INSERT INTO assets(asset_id, sha256, tags_json, embedding_json, quality_score, owner)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(asset_id) DO UPDATE SET
              tags_json=excluded.tags_json,
              embedding_json=excluded.embedding_json,
              quality_score=excluded.quality_score,
              owner=excluded.owner
            """,
            (
                payload['asset_id'],
                payload['sha256'],
                json.dumps(payload.get('tags', [])),
                json.dumps(payload.get('embedding', [])),
                float(payload.get('quality_score', 0)),
                payload.get('owner', 'RSP'),
            ),
        )
        conn.commit()


if __name__ == '__main__':
    sample = {
        'asset_id': 'sample-asset',
        'sha256': '0' * 64,
        'tags': ['demo'],
        'embedding': [],
        'quality_score': 0,
        'owner': 'RSP',
    }
    write_asset_metadata(sample)
    print(json.dumps({'written': True, 'asset_id': sample['asset_id']}))
