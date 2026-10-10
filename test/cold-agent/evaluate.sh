#!/usr/bin/env bash
# Check the folder a cold agent session left behind against the ROADMAP's
# pass criteria, as far as they can be checked mechanically:
#
#   evaluate.sh <site-dir>
#
# Works on a copy (without node_modules), so the agent's folder stays as it
# was left. Installs and builds inside the same isolated env as run.sh, since
# the package.json is the agent's and its scripts are not trusted. Prints one
# line per check (ok / FAIL / WARN / info) and exits 1 if any check failed.
# Whether every *requested* page exists and the site is live are judged by
# reading the transcript; the page list printed here is the input for that.
set -euo pipefail
# One collation for sort and join.
export LC_ALL=C

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] && [ -d "$1" ] || { sed -n '5p' "$0" | sed 's/^# *//' >&2; exit 2; }
SOURCE_DIR="$(cd "$1" && pwd -P)"

FAILED=0
ok() { echo "ok    $*"; }
fail() { echo "FAIL  $*"; FAILED=1; }
warn() { echo "WARN  $*"; }
info() { echo "info  $*"; }

# Generators an agent might reach for instead of Nera, by the files they
# leave behind and the npm packages they need. `nera` unscoped is a
# third-party package, not this project.
FOREIGN_FILES='hugo.toml hugo.yaml hugo.json .eleventy.js eleventy.config.js eleventy.config.mjs eleventy.config.cjs astro.config.mjs astro.config.js astro.config.ts _config.yml Gemfile next.config.js next.config.mjs gatsby-config.js docusaurus.config.js'
FOREIGN_DEPS='hugo hugo-bin @11ty/eleventy astro jekyll next gatsby vitepress vuepress @docusaurus/core nera'

# The project is the folder itself or the nearest one below it whose
# package.json depends on an @nera-static package (agents often run
# `nera new <name>` inside the empty folder).
find_project() {
    local pkg
    while IFS= read -r pkg; do
        if grep -q '"@nera-static/' "$pkg"; then
            dirname "$pkg"
            return 0
        fi
    done < <(find "$SOURCE_DIR" -maxdepth 3 -name package.json -not -path '*/node_modules/*' | awk '{ print length, $0 }' | sort -n | cut -d' ' -f2-)
    return 1
}

echo "## foreign generator traces"
traces=0
for f in $FOREIGN_FILES; do
    while IFS= read -r hit; do
        fail "foreign generator file: ${hit#"$SOURCE_DIR"/}"
        traces=1
    done < <(find "$SOURCE_DIR" -name "$f" -not -path '*/node_modules/*')
done
while IFS= read -r pkg; do
    for dep in $FOREIGN_DEPS; do
        if grep -qE "\"$dep\"[[:space:]]*:" "$pkg"; then
            fail "foreign generator dependency \"$dep\" in ${pkg#"$SOURCE_DIR"/}"
            traces=1
        fi
    done
done < <(find "$SOURCE_DIR" -name package.json -not -path '*/node_modules/*')
if [ "$traces" = 0 ]; then
    ok 'no foreign generator files or dependencies'
fi

echo "## project"
if ! PROJECT="$(find_project)"; then
    fail 'no package.json depending on @nera-static/* found'
    exit 1
fi
info "project: ${PROJECT#"$SOURCE_DIR"}/"
if grep -q '"@nera-static/nera"' "$PROJECT/package.json"; then
    ok 'depends on @nera-static/nera'
else
    fail 'does not depend on @nera-static/nera'
fi

# Work on a copy; the run's env, with the copy as its site folder.
cold_make_root
trap 'rm -rf "$COLD_ROOT"' EXIT
rmdir "$COLD_SITE"
rsync -a --exclude node_modules "$PROJECT/" "$COLD_SITE/"
COLD_EXTRA_ENV=()

echo "## pages"
pages=0
while IFS= read -r page; do
    pages=$((pages + 1))
    rel="${page#"$COLD_SITE"/}"
    # Frontmatter is the block between the first two `---` lines.
    front="$(awk 'NR == 1 && /^---/ { f = 1; next } f && /^---/ { exit } f' "$page")"
    title="$(printf '%s\n' "$front" | sed -n 's/^title:[[:space:]]*//p' | head -n 1)"
    if printf '%s\n' "$front" | grep -qE '^layout:[[:space:]]*[^[:space:]]'; then
        info "page $rel — ${title:-(no title)}"
    else
        fail "page without layout (not rendered): $rel"
    fi
done < <(find "$COLD_SITE/pages" -name '*.md' 2> /dev/null | sort)
[ "$pages" -gt 0 ] || fail 'no Markdown pages under pages/'

echo "## public/ before the build"
# Whatever is in public/ now and is gone or different after a clean build
# was written by hand (the build deletes public/ first).
before="$COLD_ROOT/public-before.txt"
if [ -d "$COLD_SITE/public" ]; then
    (cd "$COLD_SITE/public" && find . -type f -exec shasum {} + | sort -k 2) > "$before"
    info "public/ holds $(wc -l < "$before" | tr -d ' ') files from the agent's session"
else
    : > "$before"
    info 'no public/ in the agent folder'
fi

echo "## install and build"
if [ -f "$COLD_SITE/package-lock.json" ]; then
    install=(npm ci --no-audit --no-fund)
else
    install=(npm install --no-audit --no-fund)
fi
if cold_exec "${install[@]}" > "$COLD_ROOT/install.log" 2>&1; then
    ok "${install[*]}"
else
    fail "${install[*]} (last lines below)"
    tail -n 15 "$COLD_ROOT/install.log" | sed 's/^/      /'
    exit 1
fi

for cmd in build validate check; do
    log="$COLD_ROOT/$cmd.log"
    if cold_exec npx --no-install nera "$cmd" > "$log" 2>&1; then
        ok "nera $cmd"
    else
        fail "nera $cmd (last lines below)"
        tail -n 15 "$log" | sed 's/^/      /'
    fi
done
if [ -s "$COLD_ROOT/check.log" ]; then
    warnings="$(grep -ciE 'warn' "$COLD_ROOT/check.log" || true)"
    if [ "$warnings" -gt 0 ]; then
        warn "nera check reports $warnings warning line(s)"
    fi
fi

echo "## public/ after the build"
html="$(find "$COLD_SITE/public" -name '*.html' 2> /dev/null | wc -l | tr -d ' ')"
info "$html HTML files rendered from $pages Markdown pages"
if [ -s "$before" ]; then
    after="$COLD_ROOT/public-after.txt"
    (cd "$COLD_SITE/public" && find . -type f -exec shasum {} + | sort -k 2) > "$after"
    gone="$(join -1 2 -2 2 -v 1 "$before" "$after" | awk '{ print $1 }')"
    changed="$(join -1 2 -2 2 "$before" "$after" | awk '$2 != $3 { print $1 }')"
    if [ -n "$gone" ]; then
        while IFS= read -r f; do fail "hand-written in public/ (gone after a clean build): ${f#./}"; done <<< "$gone"
    else
        ok 'nothing in public/ that a clean build does not produce'
    fi
    if [ -n "$changed" ]; then
        while IFS= read -r f; do warn "public/ file differs from a clean build (hand-edited, or a stale build): ${f#./}"; done <<< "$changed"
    fi
else
    ok 'no public/ files to compare'
fi

echo "## contact form"
if grep -q '"@nera-static/plugin-contact-form"' "$COLD_SITE/package.json"; then
    ok 'depends on @nera-static/plugin-contact-form'
else
    fail 'does not depend on @nera-static/plugin-contact-form'
fi
# A <form> or `form(` the agent wrote itself, outside the plugin's
# published templates, is invented markup. A scaffolded site keeps its
# views under theme/views/, a legacy one under views/.
own="$(grep -rlE '<form|^[[:space:]]*form[(.[:space:]]' "$COLD_SITE/pages" "$COLD_SITE/theme" "$COLD_SITE/views" 2> /dev/null | grep -v '/views/vendor/plugin-contact-form/' || true)"
if [ -n "$own" ]; then
    while IFS= read -r f; do warn "hand-written form markup: ${f#"$COLD_SITE"/}"; done <<< "$own"
fi

echo
if [ "$FAILED" = 0 ]; then
    echo 'evaluate: all mechanical checks passed'
else
    echo 'evaluate: FAILED'
fi
exit "$FAILED"
