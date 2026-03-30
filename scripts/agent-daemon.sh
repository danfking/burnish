#!/usr/bin/env bash
# Agent Daemon — polls GitHub issues by label, spawns claude CLI for each phase.
# Usage: bash scripts/agent-daemon.sh
# Config via env vars: POLL_INTERVAL, MAX_CONCURRENT, REPO
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCKS_DIR="$SCRIPT_DIR/.locks"
LOGS_DIR="$SCRIPT_DIR/logs"
PROMPTS_DIR="$SCRIPT_DIR/prompts"

POLL_INTERVAL="${POLL_INTERVAL:-30}"
MAX_CONCURRENT="${MAX_CONCURRENT:-2}"
REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

# Phase timeouts in seconds
TIMEOUT_PLAN="${TIMEOUT_PLAN:-900}"       # 15 min
TIMEOUT_IMPLEMENT="${TIMEOUT_IMPLEMENT:-1800}"  # 30 min
TIMEOUT_REVIEW="${TIMEOUT_REVIEW:-600}"   # 10 min
TIMEOUT_SHIP="${TIMEOUT_SHIP:-300}"       # 5 min

# Max review→implement retries before failing
MAX_REVIEW_RETRIES=2

mkdir -p "$LOCKS_DIR" "$LOGS_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

# Count currently running agent processes (by lock files with live PIDs)
count_active() {
  local count=0
  for lockfile in "$LOCKS_DIR"/*.lock; do
    [ -f "$lockfile" ] || continue
    local pid
    pid=$(cat "$lockfile" 2>/dev/null || echo "")
    if [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      count=$((count + 1))
    fi
  done
  echo "$count"
}

# Clean stale locks (PID no longer alive)
clean_stale_locks() {
  for lockfile in "$LOCKS_DIR"/*.lock; do
    [ -f "$lockfile" ] || continue
    local pid
    pid=$(cat "$lockfile" 2>/dev/null || echo "")
    if [ -z "$pid" ] || ! [[ "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
      log "Cleaning stale lock: $lockfile (PID $pid dead)"
      rm -f "$lockfile"
    fi
  done
}

# Acquire lock for an issue. Returns 0 if acquired, 1 if already locked.
acquire_lock() {
  local issue=$1
  local lockfile="$LOCKS_DIR/${issue}.lock"
  if [ -f "$lockfile" ]; then
    local pid
    pid=$(cat "$lockfile" 2>/dev/null || echo "")
    if [ -n "$pid" ] && [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
      return 1  # already locked by live process
    fi
    rm -f "$lockfile"  # stale
  fi
  echo $$ > "$lockfile"
  return 0
}

release_lock() {
  local issue=$1
  rm -f "$LOCKS_DIR/${issue}.lock"
}

# Get retry count from issue comments (count "Implementation Complete" comments)
get_retry_count() {
  local issue=$1
  gh issue view "$issue" --repo "$REPO" --comments --json comments \
    -q '[.comments[] | select(.body | test("REQUEST_CHANGES"))] | length' 2>/dev/null || echo "0"
}

# Post failure comment and label
fail_issue() {
  local issue=$1
  local phase=$2
  local logfile=$3
  local message=${4:-"Agent failed during $phase phase."}

  log "FAIL: Issue #$issue during $phase"

  local log_tail=""
  if [ -f "$logfile" ]; then
    log_tail=$(tail -50 "$logfile" 2>/dev/null || echo "(no log)")
  fi

  gh issue comment "$issue" --repo "$REPO" --body "$(cat <<EOF
## ❌ Agent Failed

**Phase:** $phase
**Message:** $message

<details>
<summary>Last 50 lines of log</summary>

\`\`\`
$log_tail
\`\`\`

</details>

To retry, remove \`agent:failed\` and add the appropriate phase label.
EOF
)" || true

  # Remove all agent:* labels, add agent:failed
  local current_labels
  current_labels=$(gh issue view "$issue" --repo "$REPO" --json labels -q '.labels[].name' | grep '^agent:' || true)
  for label in $current_labels; do
    gh issue edit "$issue" --repo "$REPO" --remove-label "$label" 2>/dev/null || true
  done
  gh issue edit "$issue" --repo "$REPO" --add-label "agent:failed" || true
}

# Run a phase for an issue
run_phase() {
  local issue=$1
  local phase=$2    # plan, implement, review, ship
  local from_label=$3
  local to_label=$4

  local timestamp
  timestamp=$(date '+%Y%m%d-%H%M%S')
  local logfile="$LOGS_DIR/${issue}-${phase}-${timestamp}.log"

  log "Starting phase '$phase' for issue #$issue"

  # Determine timeout
  local timeout_var="TIMEOUT_${phase^^}"
  local timeout=${!timeout_var:-600}

  # Transition label immediately to prevent double-pickup
  if [ "$from_label" != "$to_label" ]; then
    gh issue edit "$issue" --repo "$REPO" --remove-label "$from_label" --add-label "$to_label" || true
  fi

  # Read the prompt template
  local prompt_file="$PROMPTS_DIR/${phase}.md"
  if [ ! -f "$prompt_file" ]; then
    fail_issue "$issue" "$phase" "$logfile" "Prompt file not found: $prompt_file"
    return 1
  fi

  # Build the claude CLI command
  local prompt
  prompt=$(cat "$prompt_file")

  # Set up allowed tools based on phase
  local allowed_tools
  case "$phase" in
    plan)
      allowed_tools="Read,Glob,Grep,Bash"
      ;;
    implement)
      allowed_tools="Read,Glob,Grep,Bash,Edit,Write"
      ;;
    review)
      allowed_tools="Read,Glob,Grep,Bash"
      ;;
    ship)
      allowed_tools="Read,Glob,Grep,Bash"
      ;;
  esac

  # For implement phase, set up a worktree
  local work_dir="$PROJECT_ROOT"
  if [ "$phase" = "implement" ]; then
    local issue_title
    issue_title=$(gh issue view "$issue" --repo "$REPO" --json title -q .title)
    local issue_labels
    issue_labels=$(gh issue view "$issue" --repo "$REPO" --json labels -q '.labels[].name' | tr '\n' ' ')

    # Determine branch type
    local branch_type="feat"
    if echo "$issue_labels $issue_title" | grep -qi 'bug\|fix'; then
      branch_type="fix"
    elif echo "$issue_labels $issue_title" | grep -qi 'chore\|ci\|doc\|refactor'; then
      branch_type="chore"
    fi

    # Create slug from title
    local slug
    slug=$(echo "$issue_title" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//' | cut -c1-40)
    local branch="${branch_type}/${issue}-${slug}"
    local worktree_dir="$PROJECT_ROOT/.claude/worktrees/$branch"

    # Create worktree if it doesn't exist
    if [ ! -d "$worktree_dir" ]; then
      git -C "$PROJECT_ROOT" fetch origin main
      git -C "$PROJECT_ROOT" worktree add "$worktree_dir" -b "$branch" origin/main 2>/dev/null || \
        git -C "$PROJECT_ROOT" worktree add "$worktree_dir" "$branch" 2>/dev/null || true
    fi

    if [ -d "$worktree_dir" ]; then
      work_dir="$worktree_dir"
    else
      fail_issue "$issue" "$phase" "$logfile" "Failed to create worktree at $worktree_dir"
      return 1
    fi

    export WORKTREE_DIR="$worktree_dir"
  elif [ "$phase" = "review" ] || [ "$phase" = "ship" ]; then
    # Find existing worktree for this issue
    local worktree_dir
    worktree_dir=$(git -C "$PROJECT_ROOT" worktree list --porcelain | grep "^worktree.*/${issue}-" | head -1 | sed 's/^worktree //' || true)
    if [ -n "$worktree_dir" ] && [ -d "$worktree_dir" ]; then
      work_dir="$worktree_dir"
      export WORKTREE_DIR="$worktree_dir"
    fi
  fi

  # Run claude CLI
  export ISSUE_NUMBER="$issue"

  (
    cd "$work_dir"
    timeout "$timeout" claude -p "$prompt" \
      --allowedTools "$allowed_tools" \
      --verbose \
      2>&1
  ) > "$logfile" 2>&1
  local exit_code=$?

  if [ $exit_code -ne 0 ]; then
    if [ $exit_code -eq 124 ]; then
      fail_issue "$issue" "$phase" "$logfile" "Phase timed out after ${timeout}s"
    else
      fail_issue "$issue" "$phase" "$logfile" "Claude CLI exited with code $exit_code"
    fi
    return 1
  fi

  log "Phase '$phase' completed for issue #$issue"
  return 0
}

# Process a single issue through its current phase
process_issue() {
  local issue=$1
  local label=$2

  if ! acquire_lock "$issue"; then
    return 1  # already being processed
  fi

  # Run in background subshell
  (
    trap "release_lock $issue" EXIT

    case "$label" in
      agent:queue)
        run_phase "$issue" "plan" "agent:queue" "agent:planning"
        ;;
      agent:approved)
        # Check retry count
        local retries
        retries=$(get_retry_count "$issue")
        if [ "$retries" -ge "$MAX_REVIEW_RETRIES" ]; then
          fail_issue "$issue" "implement" "" "Max review retries ($MAX_REVIEW_RETRIES) exceeded. Manual intervention needed."
          gh issue edit "$issue" --repo "$REPO" --remove-label "agent:approved" 2>/dev/null || true
          exit 1
        fi
        run_phase "$issue" "implement" "agent:approved" "agent:implementing"
        ;;
      agent:implementing)
        # Re-implement after review requested changes
        local retries
        retries=$(get_retry_count "$issue")
        if [ "$retries" -ge "$MAX_REVIEW_RETRIES" ]; then
          fail_issue "$issue" "implement" "" "Max review retries ($MAX_REVIEW_RETRIES) exceeded. Manual intervention needed."
          exit 1
        fi
        run_phase "$issue" "implement" "agent:implementing" "agent:implementing"
        ;;
      agent:reviewing)
        run_phase "$issue" "review" "agent:reviewing" "agent:reviewing"
        ;;
      agent:ship)
        run_phase "$issue" "ship" "agent:ship" "agent:ship"
        ;;
    esac
  ) &

  # Update lock file with the background PID
  echo $! > "$LOCKS_DIR/${issue}.lock"
}

# Fetch issues with a given label
get_issues_with_label() {
  local label=$1
  gh issue list --repo "$REPO" --label "$label" --json number -q '.[].number' 2>/dev/null || echo ""
}

# ─── Main Loop ──────────────────────────────────────────────────────────────────

log "Agent daemon starting"
log "  Repo: $REPO"
log "  Poll interval: ${POLL_INTERVAL}s"
log "  Max concurrent: $MAX_CONCURRENT"
log "  Logs: $LOGS_DIR"
log ""

trap 'log "Daemon shutting down"; kill $(jobs -p) 2>/dev/null; exit 0' INT TERM

while true; do
  clean_stale_locks

  active=$(count_active)

  # Process labels in priority order
  for label in "agent:queue" "agent:approved" "agent:implementing" "agent:reviewing" "agent:ship"; do
    if [ "$active" -ge "$MAX_CONCURRENT" ]; then
      break
    fi

    issues=$(get_issues_with_label "$label")
    for issue in $issues; do
      if [ "$active" -ge "$MAX_CONCURRENT" ]; then
        break
      fi

      # Skip if already locked
      if [ -f "$LOCKS_DIR/${issue}.lock" ]; then
        local_pid=$(cat "$LOCKS_DIR/${issue}.lock" 2>/dev/null || echo "")
        if [ -n "$local_pid" ] && [[ "$local_pid" =~ ^[0-9]+$ ]] && kill -0 "$local_pid" 2>/dev/null; then
          continue
        fi
      fi

      if process_issue "$issue" "$label"; then
        active=$((active + 1))
      fi
    done
  done

  sleep "$POLL_INTERVAL"
done
