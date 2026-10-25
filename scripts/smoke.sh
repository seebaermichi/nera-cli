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
# Except while this checkout's version is not on npm yet: `nera new` pins the
# site to `^<its own version>`, which no registry install can satisfy before
# the tag's publish run has finished (a release commit, or a bump merged ahead
# of its tag). Then the site installs this checkout's `npm pack` tarball — the
# package that is about to be published — and everything else from npm.
#
# Runs in .github/workflows/smoke.yml.
#
# Usage: scripts/smoke.sh <starter|none>
#   starter   a `--starter` spec, e.g. blank, blog, business or portfolio
#   none      no starter: the base template
set -euo pipefail

if [ $# -ne 1 ]; then
    echo 'Usage: scripts/smoke.sh <starter|none>' >&2
    exit 2
fi
starter=$1

root="$(cd "$(dirname "$0")/.." && pwd)"
nera="$root/bin/nera.js"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "node $(node --version), npm $(npm --version), starter: $starter"

# A failing `npm view` (network, registry) fails the run rather than reading
# as "unpublished".
version=$(node -p "require('$root/package.json').version")
published=$(npm view @nera-static/nera versions --json)
if node -e 'process.exit(JSON.parse(process.argv[1]).includes(process.argv[2]) ? 0 : 1)' \
    "$published" "$version"; then
    tarball=
else
    echo "@nera-static/nera $version is not on npm yet: installing this checkout's tarball"
    # Found by name, not read from stdout: `prepare` (husky) prints there too.
    (cd "$root" && npm pack --silent --pack-destination "$work" > /dev/null)
    tarball="$work/nera-static-nera-$version.tgz"
fi

args=(new site --yes)
if [ "$starter" != none ]; then
    args+=(--starter "$starter")
fi
if [ -n "$tarball" ]; then
    args+=(--no-install)
fi
(cd "$work" && node "$nera" "${args[@]}")

cd "$work/site"
if [ -n "$tarball" ]; then
    npm install "$tarball"
fi
npm run build
npm run validate
echo "✅ smoke ($starter) passed"
