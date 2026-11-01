#!/usr/bin/env python3
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'mc96' / 'receipts.log'


def emit(verb: str, payload: dict, operator: str = 'RSP') -> dict:
    serialized = json.dumps(payload, sort_keys=True)
    sha = hashlib.sha256(serialized.encode('utf-8')).hexdigest()
    timestamp = datetime.now(timezone.utc).isoformat()
    rid = hashlib.sha256(f'{verb}:{timestamp}'.encode('utf-8')).hexdigest()[:24]
    receipt = {
        'receipt_id': rid,
        'verb': verb,
        'sha256': sha,
        'timestamp': timestamp,
        'operator': operator,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open('a', encoding='utf-8') as f:
        f.write(json.dumps(receipt) + '\n')
    return receipt


if __name__ == '__main__':
    print(json.dumps(emit('CAPTURE', {'stage': 'stub'}), indent=2))
