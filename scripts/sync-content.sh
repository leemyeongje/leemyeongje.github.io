#!/usr/bin/env bash
# Sync the Obsidian vault from Google Drive into ./content so Vercel deploys
# a real folder (not a symlink). Re-run this whenever the vault changes.
set -euo pipefail

VAULT="${CONTENT_SOURCE:-/Users/leemyeongje/Library/CloudStorage/GoogleDrive-mangsoonggi6@gmail.com/My Drive/obsidian/kiwi}"
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/content"

if [ ! -d "$VAULT" ]; then
  echo "error: vault source not found: $VAULT" >&2
  echo "set CONTENT_SOURCE to override the path." >&2
  exit 1
fi

rsync -av --delete \
  --exclude '.obsidian' \
  --exclude '.DS_Store' \
  "$VAULT"/ "$DEST"/

echo "synced vault -> $DEST"
