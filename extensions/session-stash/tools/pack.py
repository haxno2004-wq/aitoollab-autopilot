#!/usr/bin/env python3
"""Build the Chrome Web Store upload zip for Session Stash.

Chrome requires manifest.json at the root of the archive, so the zip is built
from an explicit allow-list of shipped files rather than by zipping the folder.
Dev-only assets (tools/, docs, previous releases) are intentionally excluded.

Usage:  python extensions/session-stash/tools/pack.py [version]
"""

import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SHIPPED = [
    "manifest.json",
    "background.js",
    "popup.html",
    "popup.js",
    "manager.html",
    "manager.js",
    "ui.css",
    "lib/common.js",
    "lib/license.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
]


def main() -> int:
    manifest_path = os.path.join(ROOT, "manifest.json")
    with open(manifest_path, encoding="utf-8") as fh:
        manifest = json.load(fh)

    version = sys.argv[1] if len(sys.argv) > 1 else manifest["version"]
    if version != manifest["version"]:
        manifest["version"] = version
        with open(manifest_path, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(manifest, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print(f"bumped manifest version to {version}")

    missing = [rel for rel in SHIPPED if not os.path.isfile(os.path.join(ROOT, rel))]
    if missing:
        print("missing files, aborting:", ", ".join(missing))
        return 1

    out_dir = os.path.join(ROOT, "releases")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"session-stash-{version}.zip")

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel in SHIPPED:
            zf.write(os.path.join(ROOT, rel), arcname=rel)

    with zipfile.ZipFile(out_path) as zf:
        bad = zf.testzip()
        names = zf.namelist()

    print(f"wrote {out_path}")
    print(f"  entries: {len(names)}  integrity: {'OK' if bad is None else 'CORRUPT ' + bad}")
    print(f"  manifest at root: {'manifest.json' in names}")
    print(f"  bytes: {os.path.getsize(out_path)}")
    return 0 if bad is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
