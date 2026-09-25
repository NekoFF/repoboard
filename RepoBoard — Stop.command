#!/bin/bash
# Double-click to stop RepoBoard if it is running in the background.
cd "$(dirname "$0")"
node scripts/stop.mjs
echo ""
read -n 1 -s -r -p "Done. Press any key to close."
