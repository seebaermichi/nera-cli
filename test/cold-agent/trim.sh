#!/usr/bin/env bash
# Trims a Claude Code run's transcript.jsonl into the committed transcript.md.
#
#   bash test/cold-agent/trim.sh <run root> > <date>-<label>/claude/transcript.md
#
# Mechanical, so it can be rerun: every agent message and tool call in order,
# nothing reworded. Commands keep every line except heredoc bodies, which
# collapse to "<opener> … [N lines]". Results keep their first 15 lines plus
# every later line that shows an error or warning. The run root becomes
# <root>, the temp dir <tmp>, and colour codes are stripped. Thinking blocks
# and token/rate-limit events are dropped.
set -euo pipefail

root=${1:?usage: trim.sh <run root>}
root=$(cd "$root" && pwd -P)
jsonl=$root/out/transcript.jsonl
tmp=$(cd "${TMPDIR:-/tmp}" && pwd -P)

# macOS reports the same folders with and without /private.
jq -r --arg root "$root" --arg tmp "$tmp" --argjson head 15 '
def paths:
    gsub($root; "<root>") | gsub($root | ltrimstr("/private"); "<root>")
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
    | (.content | text_of | rtrimstr("\n") | paths) as $r
    | "Result" + (if .is_error then " (error)" else "" end) + ":\n"
      + (if $r == "" then "(empty)" else $r | trim_result end | block)
elif .type == "result" then
    "_Session end: `\(.subtype)`, \(.num_turns) turns, \(.duration_ms) ms._\n"
else empty end
' "$jsonl" | {
    echo '# Cold agent test — Claude Code — transcript (trimmed)'
    echo
    echo 'Generated from `transcript.jsonl` by `test/cold-agent/trim.sh`: every agent message and tool call in order, nothing reworded. Heredoc bodies in commands collapse to `… [N lines]`; results keep their first 15 lines plus every line showing an error or warning. The run root is `<root>`, the temp dir `<tmp>`; colour codes are stripped.'
    echo
    cat
}
