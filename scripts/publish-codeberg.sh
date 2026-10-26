#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/publish-docker.sh" ]; then
  "$SCRIPT_DIR/publish-docker.sh"
else
  echo "publish-codeberg: publish-docker.sh not found, skipping container build."
fi
