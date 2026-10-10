#!/usr/bin/env bash
# Cold agent test (ROADMAP-ai.md, "Acceptance criteria"): run one agent
# headless in an empty folder outside the workspace, with publishing
# credentials switched off, on the bakery prompt read verbatim from the
# ROADMAP. See README.md next to this file.
#
#   run.sh <claude|codex>              run the session, keep transcript + tree
#   run.sh --check-isolation [agent]   prove the isolation; with an agent,
#                                      also prove its own login still works
set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

# Turn cap for the Claude session. `codex exec` has no turn limit flag.
COLD_MAX_TURNS="${COLD_MAX_TURNS:-60}"
# Model for the session; unset means the CLI default, as a cold user gets.
COLD_MODEL="${COLD_MODEL:-}"
# Codex's own login, kept apart from ~/.codex for good: log in once with
# `CODEX_HOME=<this> codex login`.
COLD_CODEX_HOME="${COLD_CODEX_HOME:-$COLD_REAL_HOME/.cache/nera-cold-agent/codex}"

usage() {
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
}

# A path that is neither in the real ~/.codex (also through a symlink) nor
# in the workspace.
codex_home_allowed() {
    local real_codex
    real_codex="$(cd "$COLD_REAL_HOME/.codex" 2> /dev/null && pwd -P || echo "$(cd "$COLD_REAL_HOME" && pwd -P)/.codex")"
    case "$1/" in
        "$COLD_REAL_HOME/.codex/"* | "$real_codex/"* | "$COLD_WORKSPACE"/*) return 1 ;;
    esac
}

# The dedicated CODEX_HOME: never the real ~/.codex (its AGENTS.md,
# config.toml and history would make the session warm), never inside the
# workspace, reset to its login before each run, and logged in, unless
# OPENAI_API_KEY is set. Nothing is copied into it; Codex keeps its own login
# (auth.json) there across runs, and nothing else.
prepare_codex_home() {
    # Checked before mkdir, so a wrong setting creates nothing in ~/.codex,
    # and again resolved, in case a symlink points back there.
    case "$COLD_CODEX_HOME" in /*) ;; *) COLD_CODEX_HOME="$PWD/$COLD_CODEX_HOME" ;; esac
    if codex_home_allowed "$COLD_CODEX_HOME"; then
        # Called left of ||, where set -e does not reach: a failed mkdir must
        # not leave COLD_CODEX_HOME empty (CODEX_HOME= would pass the checks).
        mkdir -p "$COLD_CODEX_HOME" || return 1
        chmod 700 "$COLD_CODEX_HOME" || return 1
        COLD_CODEX_HOME="$(cd "$COLD_CODEX_HOME" && pwd -P)" || return 1
    fi
    if ! codex_home_allowed "$COLD_CODEX_HOME"; then
        echo "COLD_CODEX_HOME=$COLD_CODEX_HOME must be a dedicated folder outside ~/.codex and the workspace" >&2
        return 1
    fi
    # Everything but the login is reset before each run: an AGENTS.md, a
    # config.toml (instructions, MCP servers) or the sessions and history of
    # an earlier run would all make the session warm.
    local entry cleared=()
    for entry in "$COLD_CODEX_HOME"/* "$COLD_CODEX_HOME"/.[!.]* "$COLD_CODEX_HOME"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        [ "${entry##*/}" = auth.json ] && continue
        rm -rf "$entry" || return 1
        cleared+=("${entry##*/}")
    done
    [ ${#cleared[@]} -eq 0 ] || echo "reset $COLD_CODEX_HOME: removed ${cleared[*]}" >&2
    if [ ! -f "$COLD_CODEX_HOME/auth.json" ] && [ -z "${OPENAI_API_KEY:-}" ]; then
        echo "codex is not logged in for cold runs; log in once with:" >&2
        echo "    CODEX_HOME=$COLD_CODEX_HOME codex login" >&2
        echo "or export OPENAI_API_KEY" >&2
        return 1
    fi
}

# Agent-specific login, passed into the isolated env. Only the agent's own
# credentials, never a publishing one. Sets COLD_EXTRA_ENV and AGENT_CMD.
prepare_agent() {
    local agent="$1"
    COLD_EXTRA_ENV=()
    case "$agent" in
        claude)
            command -v claude > /dev/null || { echo 'claude is not installed' >&2; return 1; }
            COLD_EXTRA_ENV+=('DISABLE_AUTOUPDATER=1')
            # The fake HOME hides ~/.claude (CLAUDE.md, skills, plugins,
            # memory). The login lives in the macOS keychain; if the fake HOME
            # hides that too, export one of these before running.
            [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && COLD_EXTRA_ENV+=("CLAUDE_CODE_OAUTH_TOKEN=$CLAUDE_CODE_OAUTH_TOKEN")
            [ -n "${ANTHROPIC_API_KEY:-}" ] && COLD_EXTRA_ENV+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
            # --max-turns caps a looping session; it is accepted but not
            # listed in `claude --help`.
            AGENT_CMD=(claude -p --dangerously-skip-permissions --output-format stream-json --verbose --max-turns "$COLD_MAX_TURNS")
            if [ -n "$COLD_MODEL" ]; then AGENT_CMD+=(--model "$COLD_MODEL"); fi
            ;;
        codex)
            command -v codex > /dev/null || { echo 'codex is not installed' >&2; return 1; }
            prepare_codex_home || return 1
            COLD_EXTRA_ENV+=("CODEX_HOME=$COLD_CODEX_HOME")
            [ -n "${OPENAI_API_KEY:-}" ] && COLD_EXTRA_ENV+=("OPENAI_API_KEY=$OPENAI_API_KEY")
            AGENT_CMD=(codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox)
            if [ -n "$COLD_MODEL" ]; then AGENT_CMD+=(-m "$COLD_MODEL"); fi
            ;;
        *)
            usage
            ;;
    esac
}

CHECK_FAILED=0

check() {
    local label="$1"
    shift
    if "$@"; then
        echo "ok    $label"
    else
        echo "FAIL  $label"
        CHECK_FAILED=1
    fi
}

# Every check runs inside the isolated env, as the agent would.
in_env() {
    cold_exec bash -c "$1" > /dev/null 2>&1
}

check_isolation() {
    local agent="${1:-}"
    # Fail before anything is created if the agent cannot run at all. Its
    # login stays out of the isolation checks and is added back for the ping.
    if [ -n "$agent" ]; then
        prepare_agent "$agent"
        COLD_EXTRA_ENV=()
    fi
    cold_make_root
    trap 'rm -rf "$COLD_ROOT" "$COLD_SITE"' EXIT
    echo "run root: $COLD_ROOT"
    echo "site:     $COLD_SITE"

    check 'site folder is outside the workspace' \
        in_env "case \"\$(pwd -P)/\" in '$COLD_WORKSPACE'/*) exit 1;; esac"
    check 'site folder is not inside the run root' \
        in_env "case \"\$(pwd -P)/\" in '$COLD_ROOT'/*) exit 1;; esac; [ ! -e ../out ] && [ ! -e ../home ]"
    check 'HOME is the fake one' \
        in_env "[ \"\$HOME\" = '$COLD_HOME' ] && [ ! -e \"\$HOME/.claude\" ] && [ ! -e \"\$HOME/.codex\" ]"
    check 'no CLAUDE.md or AGENTS.md walking up from the site folder' \
        in_env 'd=$(pwd -P); while :; do [ -e "$d/CLAUDE.md" ] || [ -e "$d/AGENTS.md" ] || [ -e "$d/.claude" ] && exit 1; [ "$d" = / ] && break; d=$(dirname "$d"); done'
    check 'no global Nera command on PATH' \
        in_env '! command -v nera && ! compgen -c nera-'
    check 'no token variables in the environment' \
        in_env '! env | grep -qiE "token|secret|_key=|ssh_auth_sock|npm_config__auth"'
    if command -v gh > /dev/null; then
        check 'gh is not logged in' in_env '! gh auth status'
    else
        echo 'skip  gh is not installed'
    fi
    check 'git has no credential helper' \
        in_env '[ -z "$(git config --get-all credential.helper)" ]'
    check 'git can read github.com anonymously' \
        in_env 'git ls-remote https://github.com/seebaermichi/nera-cli HEAD'
    check 'git finds no credential for github.com (a push would fail)' \
        in_env '! printf "protocol=https\nhost=github.com\n\n" | git credential fill'
    check 'git over ssh authenticates as nobody' \
        in_env 'out=$($GIT_SSH_COMMAND -T git@github.com 2>&1); ! printf "%s" "$out" | grep -q "successfully authenticated"'
    check 'npm is not logged in' in_env '! npm whoami'
    check 'npm can read the registry' in_env 'npm view @nera-static/nera version'

    if [ -n "$agent" ]; then
        prepare_agent "$agent"
        local reply
        reply="$(cold_exec "${AGENT_CMD[@]}" 'Reply with the single word OK and nothing else.' 2>&1 || true)"
        # Both agents' JSON output carries the answer as a quoted string.
        if ! grep -q '"OK"' <<< "$reply"; then
            grep -oE '"(result|message)":"[^"]{0,160}' <<< "$reply" | head -n 3 | sed 's/^/      /'
            case "$agent" in
                claude) echo '      the fake HOME hides the keychain login: run `claude setup-token` and export CLAUDE_CODE_OAUTH_TOKEN' ;;
                codex) echo "      log in once with \`CODEX_HOME=$COLD_CODEX_HOME codex login\`" ;;
            esac
        fi
        check "$agent is still logged in" grep -q '"OK"' <<< "$reply"
    fi

    [ "$CHECK_FAILED" = 0 ] && echo 'isolation: ok' || echo 'isolation: FAILED'
    return "$CHECK_FAILED"
}

run_agent() {
    local agent="$1"
    local prompt out status
    prompt="$(cold_prompt)"
    [ -n "$prompt" ] || { echo 'bakery prompt not found in ROADMAP-ai.md' >&2; return 1; }

    prepare_agent "$agent"
    cold_make_root
    out="$COLD_ROOT/out"
    mkdir -p "$out"
    printf '%s\n' "$prompt" > "$out/prompt.txt"
    {
        echo "agent: $agent"
        echo "version: $("$agent" --version 2>&1 | head -n 1)"
        echo "model: ${COLD_MODEL:-(CLI default)}"
        echo "command: ${AGENT_CMD[*]}"
        echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "site: $COLD_SITE"
    } > "$out/meta.txt"

    echo "running $agent in $COLD_SITE (transcript: $out/transcript.jsonl)" >&2
    status=0
    cold_exec "${AGENT_CMD[@]}" "$prompt" \
        > "$out/transcript.jsonl" 2> "$out/stderr.log" < /dev/null || status=$?

    {
        echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "exit: $status"
    } >> "$out/meta.txt"
    (cd "$COLD_SITE" && find . -path ./node_modules -prune -o -path '*/node_modules' -prune -o -print | sort) > "$out/tree.txt"

    echo "$COLD_ROOT"
    echo "site: $COLD_SITE" >&2
    echo "next: bash $(dirname "$0")/evaluate.sh $COLD_SITE" >&2
}

case "${1:-}" in
    --check-isolation) check_isolation "${2:-}" ;;
    claude | codex) run_agent "$1" ;;
    *) usage ;;
esac
