#!/bin/bash
# Double-click to start RepoBoard. Close this window to stop it.
cd "$(dirname "$0")"
echo "Starting RepoBoard…  (close this window to stop)"
open http://localhost:3000 2>/dev/null &
npm run dev
