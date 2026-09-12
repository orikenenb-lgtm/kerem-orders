#!/usr/bin/env bash
# Launch TradingView Desktop (Mac) with the remote-debugging port the MCP server needs.
set -euo pipefail

TV_APP="/Applications/TradingView.app/Contents/MacOS/TradingView"
PORT="${1:-9222}"

if [[ ! -x "$TV_APP" ]]; then
  echo "TradingView Desktop not found at $TV_APP — install it from tradingview.com/desktop" >&2
  exit 1
fi

if pgrep -x TradingView >/dev/null; then
  echo "TradingView is already running. Quit it first so it can relaunch with the debug port." >&2
  exit 1
fi

echo "Launching TradingView with --remote-debugging-port=$PORT ..."
exec "$TV_APP" --remote-debugging-port="$PORT"
