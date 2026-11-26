#!/usr/bin/env bash
set -euo pipefail

# Opens a GitHub PR from the current branch into develop.
# The body is .ai/pr-description.md when it exists (codee-generate-pr-description writes it),
# otherwise the PR template's headings to fill in.
# Requires: an origin remote and an authenticated gh CLI.
# The title is the branch's first commit subject, a conventional commit, unless PR_TITLE is set.
# Usage: yarn pr:create   (BASE_BRANCH and PR_TITLE override the defaults)

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "Error: the repository has no origin remote." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is required but not found in PATH." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh CLI is not authenticated. Run 'gh auth login'." >&2
  exit 1
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ -z "$CURRENT_BRANCH" || "$CURRENT_BRANCH" == "HEAD" ]]; then
  echo "Error: unable to determine the current branch." >&2
  exit 1
fi

BASE_BRANCH="${BASE_BRANCH:-develop}"
FIRST_SUBJECT="$(git log --reverse --format=%s "${BASE_BRANCH}..HEAD" | sed -n 1p)"
PR_TITLE="${PR_TITLE:-${FIRST_SUBJECT}}"
if [[ -z "$PR_TITLE" ]]; then
  echo "Error: the branch has no commit over ${BASE_BRANCH}; set PR_TITLE or commit first." >&2
  exit 1
fi

BODY_FILE=".github/PULL_REQUEST_TEMPLATE.md"
if [[ -f .ai/pr-description.md ]]; then
  BODY_FILE=".ai/pr-description.md"
fi

gh pr create \
  --base "$BASE_BRANCH" \
  --head "$CURRENT_BRANCH" \
  --title "$PR_TITLE" \
  --body-file "$BODY_FILE"
