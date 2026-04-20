#!/usr/bin/env bash
# Scan tracked files for mojibake patterns that creep in when a script
# reads UTF-8 as cp1252 (common on Windows) and writes it back.
#
# Why: the 0.4.0 release PR shipped with "Burnish â€" navigation" in
# package.json descriptions because a Python version-bump script opened
# files without encoding='utf-8'. Prevent that class of bug from
# reaching npm / a release ever again.
#
# Run locally or in CI. Exit 1 on any hit.

set -eu

# Common mojibake sequences (UTF-8 chars interpreted as cp1252):
#   â€" = em-dash (U+2014)
#   â€"  = en-dash (U+2013)
#   â€˜  = left single quote (U+2018)
#   â€™  = right single quote (U+2019)
#   â€œ  = left double quote (U+201C)
#   â€  = right double quote (U+201D)
#   Â   = non-breaking or extraneous cp1252 artefact
patterns='â€|Â[^A-Za-z0-9]'

# Check JSON-escaped versions too (for package.json with ensure_ascii=True)
escaped='\\u00e2\\u20ac\\u201[cd9]|\\u00e2\\u20ac\\u2018'

# Files to scan: tracked JSON, markdown, and text config files.
files=$(git ls-files '*.json' '*.md' '*.yml' '*.yaml' '*.txt' 2>/dev/null || true)
if [[ -z "$files" ]]; then
    echo "check-encoding: no files to scan"
    exit 0
fi

hits=$(echo "$files" | xargs -d '\n' grep -lE "$patterns|$escaped" 2>/dev/null || true)
if [[ -n "$hits" ]]; then
    echo "ERROR: mojibake detected in:"
    echo "$hits" | sed 's/^/  /'
    echo ""
    echo "Offending lines:"
    echo "$files" | xargs -d '\n' grep -nE "$patterns|$escaped" 2>/dev/null | head -20
    echo ""
    echo "This usually means a script wrote UTF-8 text to a file using cp1252"
    echo "or similar. Reopen the affected files in a UTF-8 editor and restore"
    echo "the intended characters (em-dash, curly quotes, etc.). When scripting"
    echo "JSON edits, prefer 'jq' or explicit encoding='utf-8', ensure_ascii=False."
    exit 1
fi

echo "check-encoding: OK"
