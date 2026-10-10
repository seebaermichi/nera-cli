#!/usr/bin/env bash
# Trims a run's transcript.jsonl into the committed transcript.md. Reads both
# `claude -p --output-format stream-json` and `codex exec --json`, told apart
# by the first event.
#
#   bash test/cold-agent/trim.sh <run root> > <date>-<label>/<agent>/transcript.md
#
# Mechanical, so it can be rerun: every agent message and tool call in order,
# nothing reworded. Commands keep every line except heredoc bodies, which
# collapse to "<opener> … [N lines]". Results keep their first 15 lines plus
# every later line that shows an error or warning. The run root becomes
# <root>, the site folder <site>, the temp dir <tmp>, and colour codes are
# stripped. Thinking and reasoning blocks, token/rate-limit events and
# Codex's `item.started` duplicates are dropped.
set -euo pipefail

root=${1:?usage: trim.sh <run root>}
root=$(cd "$root" && pwd -P)
jsonl=$root/out/transcript.jsonl
tmp=$(cd "${TMPDIR:-/tmp}" && pwd -P)
# The site folder is a temp folder of its own (meta.txt names it); in runs
# before that it was <root>/site, which the <root> rule already covers.
site=$(sed -n 's/^site: //p' "$root/out/meta.txt" 2> /dev/null | head -n 1 || true)
case "$site/" in "$root"/*) site= ;; esac

# macOS reports the same folders with and without /private.
common='
def paths:
    (if $site == "" then . else gsub($site; "<site>") | gsub($site | ltrimstr("/private"); "<site>") end)
    | gsub($root; "<root>") | gsub($root | ltrimstr("/private"); "<root>")
    | gsub($tmp; "<tmp>") | gsub($tmp | ltrimstr("/private"); "<tmp>")
    | gsub("\u001b\\[[0-9;]*m"; "");

def lines($n): "\($n) line" + (if $n == 1 then "" else "s" end);

def collapse_heredocs:
    split("\n")
    | reduce .[] as $l ({out: [], tag: null, opener: null, n: 0};
        if .tag != null then
            if ($l | ltrimstr("\t")) == .tag
            then .out += [.opener + " … [" + lines(.n) + "]", $l] | .tag = null
            else .n += 1 end
        else
            ($l | capture("(?<!<)<<(?!<)-?\\s*[\"\\x27]?(?<t>[A-Za-z_][A-Za-z0-9_]*)[\"\\x27]?")? // null) as $m
            | if $m then .tag = $m.t | .opener = $l | .n = 0
              else .out += [$l] end
        end)
    | .out + (if .tag != null then [.opener + " … [" + lines(.n) + ", unterminated]"] else [] end)
    | join("\n");

def notable: test("\\berr|warn|fail|enoent|no such file|not found|denied|invalid|cannot|unable"; "i");

def trim_result:
    split("\n") as $lines
    | [range(0; $lines | length) | select(. < $head or ($lines[.] | notable))] as $keep
    | reduce $keep[] as $i ({out: [], last: -1};
        (if $i > .last + 1 then .out += ["… [" + lines($i - .last - 1) + " trimmed]"] else . end)
        | .out += [$lines[$i]] | .last = $i)
    | .out + (if ($lines | length) > .last + 1 then ["… [" + lines(($lines | length) - .last - 1) + " trimmed]"] else [] end)
    | join("\n");

def block: "````text\n" + . + "\n````\n";

def result_block: rtrimstr("\n") | paths | if . == "" then "(empty)" else trim_result end | block;
'

claude='
def text_of: if type == "string" then . else map(select(.type == "text") | .text) | join("\n") end;

if .type == "system" and .subtype == "init" then
    "_Session start: model `\(.model)`, \(.tools | length) tools, \(.mcp_servers | length) MCP servers._\n"
elif .type == "assistant" then
    .message.content[]
    | if .type == "text" then "**Agent:** " + (.text | paths) + "\n"
      elif .type == "tool_use" then
          if .name == "Bash" then "**Tool `Bash`:**\n" + (.input.command | paths | collapse_heredocs | block)
          elif .name == "WebFetch" then "**Tool `WebFetch`:** \(.input.url) — prompt: \(.input.prompt)\n"
          else "**Tool `\(.name)`:** `" + (.input | tostring | paths) + "`\n" end
      else empty end
elif .type == "user" then
    .message.content[]
    | select(.type == "tool_result")
    | "Result" + (if .is_error then " (error)" else "" end) + ":\n"
      + (.content | text_of | result_block)
elif .type == "result" then
    "_Session end: `\(.subtype)`, \(.num_turns) turns, \(.duration_ms) ms._\n"
else empty end
'

# Codex emits every item twice (started, completed); only the completed one
# carries the output.
codex='
if .type == "thread.started" then
    "_Session start: thread `\(.thread_id)`._\n"
elif .type == "item.completed" then
    .item
    | if .type == "agent_message" then "**Agent:** " + (.text | paths) + "\n"
      elif .type == "command_execution" then
          "**Tool `shell`:**\n" + (.command | paths | collapse_heredocs | block)
          + "Result (exit \(.exit_code // "none"), \(.status)):\n" + (.aggregated_output // "" | result_block)
      elif .type == "web_search" then
          "**Tool `web_search`:** " + ((.action // {}) | tojson | paths) + "\n"
      elif .type == "file_change" then
          "**Tool `file_change` (\(.status)):** " + ([.changes[] | "\(.kind) \(.path | paths)"] | join(", ")) + "\n"
      elif .type == "mcp_tool_call" then
          "**Tool `\(.server).\(.tool)` (\(.status)):** `" + (.arguments | tojson | paths) + "`\n"
      elif .type == "todo_list" then
          "**Plan:**\n" + ([.items[] | "- [" + (if .completed then "x" else " " end) + "] " + .text] | join("\n")) + "\n"
      elif .type == "error" then "**Error:** " + (.message | paths) + "\n"
      else empty end
elif .type == "turn.completed" then
    "_Turn end: \(.usage.input_tokens // 0) input / \(.usage.output_tokens // 0) output tokens._\n"
elif .type == "turn.failed" then "**Turn failed:** " + (.error.message | paths) + "\n"
elif .type == "error" then "**Error:** " + (.message | paths) + "\n"
else empty end
'

if [ "$(head -n 1 "$jsonl" | jq -r .type)" = thread.started ]; then
    title='Codex' filter=$codex
else
    title='Claude Code' filter=$claude
fi

jq -r --arg root "$root" --arg site "$site" --arg tmp "$tmp" --argjson head 15 "$common$filter" "$jsonl" | {
    echo "# Cold agent test — $title — transcript (trimmed)"
    echo
    echo 'Generated from `transcript.jsonl` by `test/cold-agent/trim.sh`: every agent message and tool call in order, nothing reworded. Heredoc bodies in commands collapse to `… [N lines]`; results keep their first 15 lines plus every line showing an error or warning. The run root is `<root>`'"${site:+, the site folder \`<site>\`}"', the temp dir `<tmp>`; colour codes are stripped.'
    echo
    cat
}
