#!/usr/bin/env bash
#
# scripts/smoke-test.sh
#
# Clean-machine smoke test for the PUBLISHED `burnish` npm package.
#
# This is a PRE-RELEASE verification gate (see #386). It is NOT run on every
# PR. It pulls `burnish@latest` from npm, runs it from a fresh temporary
# directory, and verifies:
#
#   1. `npx -y burnish@latest --help` exits 0 and prints a help banner.
#   2. `npx -y burnish@latest --no-open -- <stdio-mcp-server>` boots a local
#      HTTP server that responds with HTML on the advertised localhost URL.
#
# Run manually:
#   bash scripts/smoke-test.sh
#
# Or via the GitHub Actions workflow `.github/workflows/smoke-test.yml`
# (workflow_dispatch or release tag).
#
# Requires: node >= 20, npm, curl.
#
set -u
# NOTE: intentionally not using `set -e` — we want to report PASS/FAIL
# cleanly rather than abort on the first failure.

PKG="${BURNISH_SMOKE_PKG:-burnish@latest}"
# Use the well-known reference MCP server. It is published on npm and has
# no external dependencies, so it works from a clean machine.
MCP_CMD=(npx -y @modelcontextprotocol/server-everything)
PORT="${BURNISH_SMOKE_PORT:-34567}"
URL="http://localhost:${PORT}"

# Clean environment
export BURNISH_TELEMETRY=0
export CI=1
export BURNISH_SKIP_OPEN=1   # harmless if unsupported by the published version

TMPDIR_SMOKE="$(mktemp -d 2>/dev/null || mktemp -d -t burnish-smoke)"
LOG_HELP="$TMPDIR_SMOKE/help.log"
LOG_RUN="$TMPDIR_SMOKE/run.log"
BURNISH_PID=""

cleanup() {
    if [ -n "$BURNISH_PID" ] && kill -0 "$BURNISH_PID" 2>/dev/null; then
        kill "$BURNISH_PID" 2>/dev/null || true
        sleep 1
        kill -9 "$BURNISH_PID" 2>/dev/null || true
    fi
    rm -rf "$TMPDIR_SMOKE"
}
trap cleanup EXIT INT TERM

FAILED=0
pass() { echo "  PASS: $*"; }
fail() { echo "  FAIL: $*"; FAILED=1; }

echo "=============================================="
echo "Burnish clean-machine smoke test"
echo "  package: $PKG"
echo "  tmpdir:  $TMPDIR_SMOKE"
echo "  port:    $PORT"
echo "=============================================="
cd "$TMPDIR_SMOKE" || { echo "cannot cd to tmpdir"; exit 2; }

# ----------------------------------------------------------------------
# Step 1: --help
# ----------------------------------------------------------------------
echo
echo "Step 1: npx $PKG --help"
if npx -y "$PKG" --help > "$LOG_HELP" 2>&1; then
    if grep -qi "burnish" "$LOG_HELP" && grep -qi "usage" "$LOG_HELP"; then
        pass "--help exited 0 and printed a help banner"
    else
        fail "--help exited 0 but output did not look like a help banner"
        sed 's/^/    | /' "$LOG_HELP"
    fi
else
    fail "--help exited non-zero"
    sed 's/^/    | /' "$LOG_HELP"
fi

# ----------------------------------------------------------------------
# Step 2: boot against an MCP server, verify localhost responds
# ----------------------------------------------------------------------
echo
echo "Step 2: npx $PKG --no-open --port $PORT -- ${MCP_CMD[*]}"
# Run in background. stdout+stderr go to LOG_RUN.
(
    npx -y "$PKG" --no-open --port "$PORT" -- "${MCP_CMD[@]}" > "$LOG_RUN" 2>&1
) &
BURNISH_PID=$!

# Wait up to 90s for the server to print its localhost URL.
READY=0
for i in $(seq 1 90); do
    if ! kill -0 "$BURNISH_PID" 2>/dev/null; then
        break
    fi
    if grep -q "http://localhost:${PORT}" "$LOG_RUN" 2>/dev/null; then
        READY=1
        break
    fi
    sleep 1
done

if [ "$READY" -eq 1 ]; then
    pass "CLI advertised ${URL} on stdout"
else
    fail "CLI did not advertise ${URL} within 90s"
    sed 's/^/    | /' "$LOG_RUN"
fi

if [ "$READY" -eq 1 ]; then
    # Give the HTTP listener a moment to actually bind.
    sleep 2
    BODY_FILE="$TMPDIR_SMOKE/body.html"
    HTTP_CODE="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' "$URL" || echo 000)"
    if [ "$HTTP_CODE" = "200" ]; then
        pass "GET $URL returned 200"
    else
        fail "GET $URL returned HTTP $HTTP_CODE"
    fi
    if grep -qi "burnish\|<script" "$BODY_FILE" 2>/dev/null; then
        pass "response body contains expected HTML substring"
    else
        fail "response body did not contain 'burnish' or '<script'"
        head -c 400 "$BODY_FILE" 2>/dev/null | sed 's/^/    | /'
        echo
    fi
fi

# ----------------------------------------------------------------------
# Summary
# ----------------------------------------------------------------------
echo
echo "=============================================="
if [ "$FAILED" -eq 0 ]; then
    echo "Smoke test: PASS"
    exit 0
else
    echo "Smoke test: FAIL"
    echo "Run log:"
    sed 's/^/    | /' "$LOG_RUN" 2>/dev/null || true
    exit 1
fi
