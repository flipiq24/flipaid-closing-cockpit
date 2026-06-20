#!/bin/bash
set -e

# Static Express/npm app: only dependency install is needed after a merge.
# Idempotent and non-interactive. No DB migrations or build step.
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi
