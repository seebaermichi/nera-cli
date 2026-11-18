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
# After the build, `nera update` runs on the site (it updates the site's Nera
# packages within their ranges and refreshes `AGENTS.md`/`CLAUDE.md`), and the
# updated site builds again. On the tarball path the site's dependency is a
# `file:` spec, so `npm update` reinstalls the tarball and never asks the
# registry for the unpublished version.
#
# Runs in .github/workflows/smoke.yml, on Linux and on Windows (Git Bash).
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
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# Git Bash on Windows: `/d/a/...` and `/tmp/...` mean nothing to node and npm,
# and Git Bash converts a path only when it is a whole argument. The mixed form
# (`D:/a/...`) works in bash and in node alike.
if command -v cygpath > /dev/null; then
    root=$(cygpath -m "$root")
    work=$(cygpath -m "$work")
fi
nera="$root/bin/nera.js"

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
npx nera update
npm run build
echo "✅ smoke ($starter) passed"
