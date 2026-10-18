#!/usr/bin/env bash
# Scaffolds a site with this checkout's `bin/nera.js`, the way a user's
# `npx @nera-static/nera new` does: `nera new` runs `npm install` itself, in a
# fresh temp directory with no lockfile, so npm resolves today's versions of
# everything (vite included). Then builds and validates the site. Any failing
# command fails the run. This catches what `npm ci` on our own lockfile cannot:
# an install that breaks for a new user on the lowest Node `engines` allows.
#
# The site depends on the *published* `@nera-static/nera`, so this proves the
# ecosystem as a user gets it, not the unreleased code of this commit (only
# `nera new` itself runs from this checkout).
#
# Runs in .github/workflows/smoke.yml.
#
# Usage: scripts/smoke.sh <starter|none>
#   starter   a `--starter` spec, e.g. blank, blog or business
#   none      no starter: the base template
set -euo pipefail

if [ $# -ne 1 ]; then
    echo 'Usage: scripts/smoke.sh <starter|none>' >&2
    exit 2
fi
starter=$1

nera="$(cd "$(dirname "$0")/.." && pwd)/bin/nera.js"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "node $(node --version), npm $(npm --version), starter: $starter"

args=(new site --yes)
if [ "$starter" != none ]; then
    args+=(--starter "$starter")
fi
(cd "$work" && node "$nera" "${args[@]}")

cd "$work/site"
npm run build
npm run validate
echo "✅ smoke ($starter) passed"
