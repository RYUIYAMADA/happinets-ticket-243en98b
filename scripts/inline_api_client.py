#!/usr/bin/env python3
"""
api-config.js の Worker URL を更新する。
Usage: python3 scripts/inline_api_client.py https://<worker>.workers.dev
"""
import os, re, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE, "api-config.js")

if len(sys.argv) < 2:
    print("Usage: python3 scripts/inline_api_client.py https://<worker>.workers.dev", file=sys.stderr)
    sys.exit(1)

worker_url = sys.argv[1]

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    content = f.read()

updated = re.sub(
    r'window\.WORKER_API_BASE_URL\s*=\s*"[^"]*"',
    f'window.WORKER_API_BASE_URL = "{worker_url}"',
    content,
)

with open(CONFIG_PATH, "w", encoding="utf-8") as f:
    f.write(updated)

print(f"updated: {os.path.basename(CONFIG_PATH)}")
