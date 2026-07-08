#!/bin/sh
# Format only the staged JS/TS files and re-stage them, so the commit snapshot
# matches the working tree (the old whole-tree `prettier --write` formatted
# after staging, leaving unstaged formatting churn behind every commit).
files=$(git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' '*.js' '*.jsx')
[ -z "$files" ] && exit 0
echo "$files" | xargs npx prettier --write --cache
echo "$files" | xargs git add
