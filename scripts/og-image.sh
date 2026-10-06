#!/usr/bin/env bash
# Renders site/og.html into site/og.png (1200x630) with headless Chrome/Chromium.
set -euo pipefail
cd "$(dirname "$0")/.."
chrome="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
"$chrome" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --screenshot="$PWD/site/og.png" "file://$PWD/site/og.html"
