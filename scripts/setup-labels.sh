#!/usr/bin/env bash
# Create agent:* labels on the GitHub repo for the autonomous workflow state machine.
# Usage: bash scripts/setup-labels.sh
set -euo pipefail

REPO="${GITHUB_REPO:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

labels=(
  "agent:queue|0E8A16|Issue queued for autonomous agent pickup"
  "agent:planning|1D76DB|Agent is generating an implementation plan"
  "agent:plan-review|FBCA04|Plan posted — awaiting human review"
  "agent:approved|0E8A16|Plan approved — ready for implementation"
  "agent:implementing|1D76DB|Agent is writing code"
  "agent:reviewing|1D76DB|Agent is reviewing its own changes"
  "agent:verify|FBCA04|Implementation done — awaiting human verification"
  "agent:ship|1D76DB|Agent is creating the PR"
  "agent:done|0E8A16|PR created — workflow complete"
  "agent:failed|D93F0B|Agent encountered an error"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name color description <<< "$entry"
  echo "Creating label: $name"
  # Try to create; if it already exists (422), update it via PATCH
  if ! gh api "repos/$REPO/labels" --method POST \
    -f name="$name" -f color="$color" -f description="$description" \
    --silent 2>/dev/null; then
    gh api "repos/$REPO/labels/$(echo "$name" | sed 's/:/%3A/g')" --method PATCH \
      -f color="$color" -f description="$description" \
      --silent 2>/dev/null || true
    echo "  (updated existing)"
  fi
done

echo "All agent labels created."
