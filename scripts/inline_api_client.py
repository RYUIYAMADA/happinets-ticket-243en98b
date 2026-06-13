#!/usr/bin/env python3
"""
api-client.js を各 HTML にインライン化し、本番 Worker URL を設定する。
Usage: python3 scripts/inline_api_client.py
"""
import os, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER_URL = "https://family-tickets-api.row2014-2015-k.workers.dev"
API_CLIENT_PATH = os.path.join(BASE, "api-client.js")

with open(API_CLIENT_PATH, "r", encoding="utf-8") as f:
    api_content = f.read()

INLINE = (
    '<script>\n'
    f'window.WORKER_API_BASE_URL = "{WORKER_URL}";\n'
    '</script>\n'
    '<script>\n'
    f'{api_content}\n'
    '</script>'
)

OLD_TAG = '<script src="./api-client.js"></script>'

FILES = [
    os.path.join(BASE, "index.html"),
    os.path.join(BASE, "player-form.html"),
    os.path.join(BASE, "player-dashboard.html"),
    os.path.join(BASE, "admin.html"),
]

for fpath in FILES:
    with open(fpath, "r", encoding="utf-8") as f:
        content = f.read()

    if "WORKER_API_BASE_URL" in content:
        # すでにインライン化済み。URLだけ更新
        import re
        content2 = re.sub(
            r'window\.WORKER_API_BASE_URL\s*=\s*"[^"]*"',
            f'window.WORKER_API_BASE_URL = "{WORKER_URL}"',
            content
        )
        if content2 != content:
            with open(fpath, "w", encoding="utf-8") as f:
                f.write(content2)
            print(f"URL updated: {os.path.basename(fpath)}")
        else:
            print(f"no change: {os.path.basename(fpath)}")
        continue

    if OLD_TAG not in content:
        print(f"WARNING: <script src> tag not found in {os.path.basename(fpath)}", file=sys.stderr)
        continue

    content = content.replace(OLD_TAG, INLINE, 1)
    with open(fpath, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"inlined: {os.path.basename(fpath)}")

print("Done.")
