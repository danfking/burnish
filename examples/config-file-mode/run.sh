#!/bin/bash
# Verify: Config file mode with mcp-servers.json
# Expected: Starts, connects to filesystem server, UI loads on port 3101
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../../packages/cli/dist/cli.js"
CONFIG="$SCRIPT_DIR/mcp-servers.json"

if [ ! -f "$CLI" ]; then
  echo "FAIL: CLI not built. Run 'pnpm build' from repo root first."
  exit 1
fi

echo "Starting burnish with --config on port 3101..."
node "$CLI" --port 3101 --no-open --config "$CONFIG" &
PID=$!

# Give the server time to start and connect
sleep 8

PASS=0
FAIL=0

# Check the UI responds
if curl -sf http://localhost:3101 > /dev/null 2>&1; then
  echo "PASS: UI loaded on port 3101"
  PASS=$((PASS + 1))
else
  echo "FAIL: UI not responding on port 3101"
  FAIL=$((FAIL + 1))
fi

# Check servers endpoint shows the filesystem server
SERVERS=$(curl -sf http://localhost:3101/api/servers 2>/dev/null || echo "")
if [ -n "$SERVERS" ] && echo "$SERVERS" | node -e "
  const d = require('fs').readFileSync('/dev/stdin','utf8');
  const j = JSON.parse(d);
  const hasFs = Array.isArray(j) && j.some(s => s.name === 'filesystem');
  process.exit(hasFs ? 0 : 1);
" 2>/dev/null; then
  echo "PASS: /api/servers includes 'filesystem' server"
  PASS=$((PASS + 1))
else
  echo "FAIL: /api/servers did not include 'filesystem' server"
  echo "  Response: $(echo "$SERVERS" | head -c 200)"
  FAIL=$((FAIL + 1))
fi

kill $PID 2>/dev/null
wait $PID 2>/dev/null || true

echo ""
echo "Config file mode: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PASS: Config file mode test complete" || echo "FAIL: Config file mode test had failures"
exit "$FAIL"
