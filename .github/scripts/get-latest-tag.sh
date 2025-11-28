#!/bin/bash
set -e

# Try to get the latest tag (ignore errors if none exist)
latest_tag=$(git describe --tags $(git rev-list --tags --max-count=1) 2>/dev/null || true)

# If no tag exists, default to 0.0.0
if [ -z "$latest_tag" ]; then
  latest_tag="0.0.0"
fi

# Export to GitHub Actions environment
echo "latest_tag=$latest_tag" >> $GITHUB_ENV
