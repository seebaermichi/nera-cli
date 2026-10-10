# Shared by run.sh and evaluate.sh: the isolated environment a cold agent
# session (and the evaluation of what it left behind) runs in. Sourced, not
# executed.
#
# The isolation is built from an EMPTY environment (env -i) rather than by
# unsetting known variables, so a token we did not think of (GH_TOKEN,
# NPM_TOKEN, a CI secret, SSH_AUTH_SOCK, ...) cannot leak through. What is
# passed back in is listed explicitly below.

COLD_REAL_HOME="$HOME"
COLD_WORKSPACE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# The bakery prompt, read verbatim from the ROADMAP's "Acceptance criteria":
# the first ```text block after the "**Cold agent test**" line.
cold_prompt() {
    local roadmap
    roadmap="$(dirname "${BASH_SOURCE[0]}")/../../ROADMAP-ai.md"
    awk '
        /^\*\*Cold agent test\*\*/ { seen = 1; next }
        seen && /^```text$/ { inblock = 1; next }
        inblock && /^```$/ { exit }
        inblock { print }
    ' "$roadmap"
}

# Create the run root under $TMPDIR (outside the workspace, so no workspace
# CLAUDE.md, project memory or skill is found by walking up) and its
# subfolders. Sets COLD_ROOT, COLD_HOME, COLD_SITE.
cold_make_root() {
    COLD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/nera-cold-agent.XXXXXX")"
    COLD_ROOT="$(cd "$COLD_ROOT" && pwd -P)"
    case "$COLD_ROOT/" in
        "$COLD_WORKSPACE"/*)
            echo "run root $COLD_ROOT is inside the workspace; set TMPDIR elsewhere" >&2
            return 1
            ;;
    esac
    COLD_HOME="$COLD_ROOT/home"
    COLD_SITE="$COLD_ROOT/site"
    mkdir -p "$COLD_HOME" "$COLD_SITE" "$COLD_ROOT/gh" "$COLD_ROOT/npm-global"
    : > "$COLD_ROOT/npmrc-global"
}

# Print the environment as NAME=value lines for `env -i`. Credentials are
# switched off on every path a publish could take:
#   gh   — empty GH_CONFIG_DIR, so gh finds no hosts.yml and never asks the
#          keyring; GH_TOKEN/GITHUB_TOKEN are gone with env -i
#   git  — no system config (Apple's git ships credential.helper=osxkeychain
#          there), a fake HOME for the global one, and credential.helper reset
#          to empty at command-line level, which outranks every config file;
#          no terminal or askpass prompt
#   ssh  — ssh reads ~/.ssh from the passwd entry, not $HOME, so git's ssh is
#          forced to no config, no identity files and no agent
#   npm  — fake HOME for ~/.npmrc, an empty global npmrc (the node prefix's
#          could hold a token), and a private prefix so `npm i -g` does not
#          touch the real node install
cold_env() {
    printf '%s\n' \
        "HOME=$COLD_HOME" \
        "PATH=$COLD_ROOT/npm-global/bin:$PATH" \
        "TMPDIR=${TMPDIR:-/tmp}" \
        "USER=${USER:-}" \
        "LOGNAME=${LOGNAME:-}" \
        "SHELL=/bin/bash" \
        "LANG=${LANG:-en_US.UTF-8}" \
        "TERM=dumb" \
        "GH_CONFIG_DIR=$COLD_ROOT/gh" \
        "GH_PROMPT_DISABLED=1" \
        "GIT_CONFIG_NOSYSTEM=1" \
        "GIT_CONFIG_COUNT=1" \
        "GIT_CONFIG_KEY_0=credential.helper" \
        "GIT_CONFIG_VALUE_0=" \
        "GIT_TERMINAL_PROMPT=0" \
        "GIT_ASKPASS=/usr/bin/false" \
        "SSH_ASKPASS=/usr/bin/false" \
        "GIT_SSH_COMMAND=ssh -F /dev/null -o IdentityFile=none -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o UserKnownHostsFile=$COLD_HOME/.ssh-known-hosts -o StrictHostKeyChecking=accept-new" \
        "npm_config_userconfig=$COLD_HOME/.npmrc" \
        "npm_config_globalconfig=$COLD_ROOT/npmrc-global" \
        "npm_config_prefix=$COLD_ROOT/npm-global" \
        "npm_config_update_notifier=false"
}

# Run a command inside the isolated environment, from the site folder.
# Extra NAME=value pairs can be given in the COLD_EXTRA_ENV array (the
# `${a[@]+...}` form keeps an empty array safe under `set -u` in bash 3.2).
cold_exec() {
    local -a envs
    local line
    while IFS= read -r line; do
        envs+=("$line")
    done < <(cold_env)
    (cd "$COLD_SITE" && env -i "${envs[@]}" ${COLD_EXTRA_ENV[@]+"${COLD_EXTRA_ENV[@]}"} "$@")
}
