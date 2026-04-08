#!/bin/bash
# Verify: Schema export produces valid JSON with tool definitions
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$SCRIPT_DIR/../packages/cli/dist/cli.js"
SCHEMA_FILE="/tmp/burnish-schema-test.json"

if [ ! -f "$CLI" ]; then
  echo "FAIL: CLI not built. Run 'pnpm build' from repo root first."
  exit 1
fi

echo "Exporting schema from filesystem MCP server..."
node "$CLI" export -- npx -y @modelcontextprotocol/server-filesystem /tmp > "$SCHEMA_FILE" 2>/dev/null

PASS=0
FAIL=0

# Check the file is valid JSON
if node -e "JSON.parse(require('fs').readFileSync('$SCHEMA_FILE','utf8'))" 2>/dev/null; then
  echo "PASS: Schema is valid JSON"
  PASS=$((PASS + 1))
else
  echo "FAIL: Schema is not valid JSON"
  FAIL=$((FAIL + 1))
fi

# Check it has the expected structure
RESULT=$(node -e "
  const s = JSON.parse(require('fs').readFileSync('$SCHEMA_FILE','utf8'));
  const hasVersion = s.burnish === '1.0';
  const hasTools = Array.isArray(s.tools) && s.tools.length > 0;
  const hasServers = Array.isArray(s.servers) && s.servers.length > 0;
  console.log('version=' + hasVersion + ' tools=' + s.tools.length + ' servers=' + s.servers.length);
  process.exit(hasVersion && hasTools && hasServers ? 0 : 1);
" 2>/dev/null || echo "")

if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
  echo "PASS: Schema has expected structure ($RESULT)"
  PASS=$((PASS + 1))
else
  echo "FAIL: Schema missing expected fields"
  echo "  Contents: $(head -c 300 "$SCHEMA_FILE")"
  FAIL=$((FAIL + 1))
fi

rm -f "$SCHEMA_FILE"

echo ""
echo "Schema export: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] && echo "PASS: Schema export test complete" || echo "FAIL: Schema export test had failures"
exit "$FAIL"
