#!/bin/bash
# Verify: Explorer mode with filesystem server
# Expected: Starts, connects, lists tools, UI loads on port 3100
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../packages/cli/dist/cli.js"

if [ ! -f "$CLI" ]; then
  echo "FAIL: CLI not built. Run 'pnpm build' from repo root first."
  exit 1
fi

echo "Starting burnish in Explorer mode on port 3100..."
node "$CLI" --port 3100 --no-open -- npx -y @modelcontextprotocol/server-filesystem /tmp &
PID=$!

# Give the server time to start and connect to the MCP server
sleep 8

PASS=0
FAIL=0

# Check the UI responds
if curl -sf http://localhost:3100 > /dev/null 2>&1; then
  echo "PASS: UI loaded on port 3100"
  PASS=$((PASS + 1))
else
  echo "FAIL: UI not responding on port 3100"
  FAIL=$((FAIL + 1))
fi

# Check tools endpoint
TOOLS=$(curl -sf http://localhost:3100/api/tools 2>/dev/null || echo "")
if [ -n "$TOOLS" ] && echo "$TOOLS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(d); process.exit(Array.isArray(j) && j.length > 0 ? 0 : 1)" 2>/dev/null; then
  echo "PASS: /api/tools returned a non-empty array"
  PASS=$((PASS + 1))
else
  echo "FAIL: /api/tools did not return expected data"
  echo "  Response: $(echo "$TOOLS" | head -c 200)"
  FAIL=$((FAIL + 1))
fi

kill $PID 2>/dev/null
wait $PID 2>/dev/null || true

echo ""
echo "Explorer mode: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PASS: Explorer mode test complete" || echo "FAIL: Explorer mode test had failures"
exit "$FAIL"
