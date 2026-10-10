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

usage() {
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//' >&2
    exit 2
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
            ;;
        codex)
            command -v codex > /dev/null || { echo 'codex is not installed' >&2; return 1; }
            # A private CODEX_HOME holding only the login: ~/.codex/AGENTS.md,
            # config.toml (MCP servers) and history stay out.
            mkdir -p "$COLD_ROOT/codex"
            if [ -f "$COLD_REAL_HOME/.codex/auth.json" ]; then
                cp "$COLD_REAL_HOME/.codex/auth.json" "$COLD_ROOT/codex/auth.json"
                chmod 600 "$COLD_ROOT/codex/auth.json"
            fi
            COLD_EXTRA_ENV+=("CODEX_HOME=$COLD_ROOT/codex")
            [ -n "${OPENAI_API_KEY:-}" ] && COLD_EXTRA_ENV+=("OPENAI_API_KEY=$OPENAI_API_KEY")
            AGENT_CMD=(codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox)
            ;;
        *)
            usage
            ;;
    esac
}

# The copied Codex login must not outlive the run.
cleanup() {
    if [ -n "${COLD_ROOT:-}" ]; then
        rm -f "$COLD_ROOT/codex/auth.json"
    fi
}
trap cleanup EXIT

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
    cold_make_root
    echo "run root: $COLD_ROOT"

    check 'site folder is outside the workspace' \
        in_env "case \"\$(pwd -P)/\" in '$COLD_WORKSPACE'/*) exit 1;; esac"
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
                codex) echo '      log in once with `codex login`, so ~/.codex/auth.json exists' ;;
            esac
        fi
        check "$agent is still logged in" grep -q '"OK"' <<< "$reply"
    fi

    rm -rf "$COLD_ROOT"
    [ "$CHECK_FAILED" = 0 ] && echo 'isolation: ok' || echo 'isolation: FAILED'
    return "$CHECK_FAILED"
}

run_agent() {
    local agent="$1"
    local prompt out status
    prompt="$(cold_prompt)"
    [ -n "$prompt" ] || { echo 'bakery prompt not found in ROADMAP-ai.md' >&2; return 1; }

    cold_make_root
    prepare_agent "$agent"
    out="$COLD_ROOT/out"
    mkdir -p "$out"
    printf '%s\n' "$prompt" > "$out/prompt.txt"
    {
        echo "agent: $agent"
        echo "version: $("$agent" --version 2>&1 | head -n 1)"
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
    echo "next: bash $(dirname "$0")/evaluate.sh $COLD_SITE" >&2
}

case "${1:-}" in
    --check-isolation) check_isolation "${2:-}" ;;
    claude | codex) run_agent "$1" ;;
    *) usage ;;
esac
