# Cold agent test harness

The **cold agent test** from `ROADMAP-ai.md` ("Acceptance criteria"): an agent
with no Nera context gets the bakery prompt in an empty folder and has to build
the site and get it online. Slice 0 runs it as a baseline before any AI-facing
change lands. Slice 7 re-runs it and diffs the result against that baseline.
This folder is not in the package `files`, so nothing here ships.

The findings of the baseline run (`2026-10-10-baseline/`) are recorded in
`ROADMAP-ai.md` under "Slice 0 — baseline record". Slice 7 reruns it on the
same models (`--model claude-sonnet-5-5`, `--model gpt-6-luna`, decision D12):
set `COLD_MODEL`, which `run.sh` passes as `--model` (Claude) or `-m` (Codex).
Unset, each CLI uses its default, which is what a cold user gets.

| File | Purpose |
|---|---|
| `run.sh` | runs one agent headless in an isolated temp folder and keeps the transcript and file tree |
| `evaluate.sh` | checks the folder the agent left behind against the pass criteria |
| `lib.sh` | the isolated environment, shared by both scripts |
| `trim.sh` | turns a run's `transcript.jsonl` (Claude or Codex) into the committed `transcript.md` |
| `<date>-<label>/<agent>/` | a committed run: trimmed transcript, tree, evaluation |

## Running it

```bash
bash test/cold-agent/run.sh --check-isolation          # must end with "isolation: ok"
bash test/cold-agent/run.sh --check-isolation claude   # also proves claude's own login still works
bash test/cold-agent/run.sh claude                     # or: codex
COLD_MODEL=claude-sonnet-5-5 bash test/cold-agent/run.sh claude
bash test/cold-agent/evaluate.sh <site folder>
```

`run.sh <agent>` prints the run root (`$TMPDIR/nera-cold-agent.XXXXXX`) on
stdout and the site folder (`$TMPDIR/nera-cold-site.XXXXXX`, the agent's
folder, kept for `evaluate.sh`) on stderr; `out/meta.txt` names it too. The
site folder is a temp folder of its own, so the run root (fake `HOME`,
transcript) is not reachable as `..` from it. The run root holds `out/`:
`prompt.txt`, `transcript.jsonl` (`claude -p --output-format stream-json` or
`codex exec --json`), `stderr.log`, `tree.txt` (without `node_modules`) and
`meta.txt` (agent version, model, full command, site folder, start, end,
exit code). Neither folder is deleted automatically.

The Claude session is capped at 60 turns (`--max-turns`); set
`COLD_MAX_TURNS` to change it. The Codex session is not capped: `codex exec`
has no turn limit flag (checked with codex-cli 0.162.1), so watch a Codex run
and stop it by hand if it loops.

The prompt is read verbatim from the ROADMAP's first `text` block after
**Cold agent test**, so editing the ROADMAP changes the test.

The agent runs with all permission prompts off
(`--dangerously-skip-permissions`, `--dangerously-bypass-approvals-and-sandbox`):
a headless run cannot answer prompts, and a sandbox without network could not
install Nera at all. The isolation below is what makes that acceptable.

`evaluate.sh` works on a copy without `node_modules`, so the agent's folder stays
as it was left. It installs and builds inside the same isolated env, because the
`package.json` is the agent's. It checks for foreign generators (files and
dependencies, including the unrelated unscoped `nera` package), the project's
`@nera-static/nera` dependency, pages without `layout`, `npm ci`/`install`,
`nera build`/`validate`/`check`, files in `public/` that a clean build does not
reproduce (hand-written), and `@nera-static/plugin-contact-form` versus
hand-written form markup. Two criteria need the transcript instead: that every
*requested* page exists (the evaluation lists every page with its title) and that
the site went live.

## What is isolated, and why

Nothing may leave the machine. A leaked credential would publish for real.

- **Empty environment.** The session starts from `env -i` with an explicit
  allow-list (`PATH`, `USER`, `LANG`, `TMPDIR`, …). Tokens nobody thought of
  (`GH_TOKEN`, `NPM_TOKEN`, CI secrets, `SSH_AUTH_SOCK`) cannot leak in.
- **Fake `HOME`** inside the run root: no `~/.gitconfig`, `~/.npmrc`,
  `~/.config/gh`, and no `~/.claude` or `~/.codex`. That also keeps the user's
  `CLAUDE.md`, skills, plugins, memory and Codex `AGENTS.md` out, so the
  session stays cold.
- **Folders outside the workspace** (`$TMPDIR`), so no workspace `CLAUDE.md`
  or project memory is found by walking up. `run.sh` refuses a run root or
  site folder inside the workspace. The site folder is not inside the run
  root, so the agent does not see its own transcript or fake `HOME` next to
  it.
- **gh:** an empty `GH_CONFIG_DIR`. Without a `hosts.yml`, gh never asks the
  keyring.
- **git:** `GIT_CONFIG_NOSYSTEM=1` (Apple's git configures the `osxkeychain`
  helper at system level), `credential.helper` reset to empty through
  `GIT_CONFIG_COUNT`, which outranks every config file, and no terminal or
  askpass prompt.
- **ssh:** ssh finds `~/.ssh` through the passwd entry, not `$HOME`, so
  `GIT_SSH_COMMAND` forces no config, no identity files and no agent.
- **npm:** an empty user and global npmrc, and a private `prefix`, so
  `npm i -g` does not touch the real Node install.
- **No global Nera command.** The maintainer's PATH can hold `nera` (the
  deprecated `@nera-static/installer`) or `nera-validate` from an old global
  install. A cold machine has neither, so every PATH folder holding `nera` or
  `nera-*` is replaced by a mirror of symlinks to everything else in it. The
  first Codex run hit the installer's `nera` on `npm run build` before
  `npm install`.

Reading stays allowed: nera.js.org, the npm registry and anonymous
`git ls-remote` all work.

The agent keeps **its own** login. Claude Code's login lives in the macOS
keychain. If the fake `HOME` hides it (`--check-isolation claude` fails), run
`claude setup-token` and export `CLAUDE_CODE_OAUTH_TOKEN`; `run.sh` passes
exactly that variable, or `ANTHROPIC_API_KEY`, through. Codex gets a
dedicated `CODEX_HOME` that is never the real `~/.codex` (whose `AGENTS.md`,
`config.toml` and history would make the session warm): `COLD_CODEX_HOME`,
by default `~/.cache/nera-cold-agent/codex`. Log in there once:

```bash
CODEX_HOME=~/.cache/nera-cold-agent/codex codex login
```

Nothing is copied from `~/.codex`. `OPENAI_API_KEY` is passed through if set
and replaces that login. Without either, `run.sh` stops with the login
command. It also refuses a `COLD_CODEX_HOME` inside `~/.codex` or the
workspace, and one holding an `AGENTS.md`.

**Not covered.** The agent runs as the same macOS user. Something that
deliberately calls `security find-internet-password`, or reads `~/.ssh`
through an absolute path, still could. The isolation stops the agent from
publishing *by accident* with the maintainer's identity. It is not a sandbox
against a hostile agent. Managed (system-wide) Claude Code settings also still
apply. A browser login (`netlify login`, `vercel login`, a device flow) opens
the real browser, where the maintainer may be signed in: it only completes if
someone clicks "Authorize", so watch the screen during a run.

## Committing a run

Commit to `test/cold-agent/<date>-<label>/<agent>/`, for example
`2026-10-10-baseline/claude/`:

- `prompt.txt`, `tree.txt` as written
- `meta.md`: `meta.txt` plus the model, node/npm version, the resolved
  `@nera-static/*` versions, turns used, cost, and notes on the run (a
  discarded run, anything the agent did outside its folder)
- `evaluation.txt`, the output of `evaluate.sh`
- `transcript.md`, generated, never hand-edited:
  `bash test/cold-agent/trim.sh <run root> > transcript.md` (either agent).
  It keeps every agent message and tool call in order. Commands keep every
  line except heredoc bodies, which collapse to
  `cat > <file> <<'EOF' … [N lines]`. Results keep their first 15 lines plus every line that shows an
  error or warning. The run root becomes `<root>`, the temp dir `<tmp>`.
- `files/`, verbatim copies of the site files a finding rests on, since
  `tree.txt` lists names only and the run root is not committed. Name an
  earlier version, recovered from a heredoc, `<name>.first.<ext>`.

Before committing, grep the trimmed files for `token`, `ghp_`, `npm_` and
`sk-`. The isolation should make a hit impossible, so a hit is itself a finding.
