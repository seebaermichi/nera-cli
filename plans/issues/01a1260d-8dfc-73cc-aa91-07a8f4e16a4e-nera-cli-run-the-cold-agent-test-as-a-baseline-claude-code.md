# Plan: [nera-cli] Run the cold agent test as a baseline (Claude Code, Codex)

- **Issue:** `01a1260d-8dfc-73cc-aa91-07a8f4e16a4e`
- **Type:** feature
- **Plan written:** 2026-10-10

## Context

Slice 0 of `ROADMAP-ai.md`: before any AI-facing change lands, run the cold agent
test (ROADMAP "Acceptance criteria") with Claude Code and with Codex and record
every point where the agent goes wrong. The test uses an empty folder, a fresh
session with no Nera context, and the bakery prompt. Those failures decide what the
site `AGENTS.md` (slice 1) must say. No production code changes. The work lands as a
reusable harness and a committed baseline record under `test/cold-agent/`, which
is outside the npm `files`, so slice 7 can re-run and diff it. The findings go into
the ROADMAP under slice 0. Today no `nera publish` exists and nera.js.org has no
`llms.txt`, so "get it online" is expected to fail. The test records what the agent
*tries*.

## Design decisions

**D1 — Both sessions run headless from a script.** `claude -p` and `codex exec`,
started by a committed `test/cold-agent/run.sh` with full transcripts captured.
The user installs Codex and logs in once, before step 3.

**D2 — Publishing credentials are hidden, so nothing leaves the machine.** The run
uses an empty `GH_CONFIG_DIR`, unsets `GH_TOKEN`/`GITHUB_TOKEN`, uses an empty
global git config (no credential helper), sets `GIT_TERMINAL_PROMPT=0` and an empty
npm userconfig. Reads from nera.js.org and the npm registry stay allowed. Whatever
the agent attempts in order to publish is a finding.

**D3 — The session runs in a temp folder outside `~/workspace/nera`**, so no
workspace `CLAUDE.md`, project memory or Snagio skill can leak Nera knowledge in.
User-level config that could still leak is checked and neutralised in step 1.

**D4 — Trimmed transcripts and the final file trees are committed** to
`test/cold-agent/2026-10-10-baseline/<agent>/`. The findings live in the ROADMAP,
and the raw material lives next to the harness.

**D5 — No version bump, no CHANGELOG entry.** Nothing shipped changes: `test/` and
`ROADMAP-ai.md` are not in the package `files`.

## Acceptance criteria

- [ ] Cold agent test run with Claude Code in an empty temp folder, fresh session, no Nera context, the ROADMAP's bakery prompt
- [ ] Same run with Codex
- [ ] Every point where an agent goes wrong (wrong generator, invented config, files in `public/`, pages without `layout`, …) recorded in `ROADMAP-ai.md` under slice 0
- [ ] Each ROADMAP pass criterion assessed per agent (build, `nera validate`/`nera check`, pages rendered, `public/` untouched, contact-form plugin, live URL, no generator confusion)
- [ ] The record names the concrete inputs for `AGENTS.md` (slice 1)

## Steps

### Step 1 — Harness that runs a cold, credential-isolated agent session and evaluates its folder — ✅ done

- **Goal:** `test/cold-agent/run.sh <claude|codex>` creates an empty temp dir outside the workspace with isolated credentials (D2, D3), runs the agent headless with the bakery prompt read verbatim from `ROADMAP-ai.md`, and writes the transcript and a file tree. `test/cold-agent/evaluate.sh <dir>` checks the ROADMAP criteria mechanically: install, `nera build`, `nera validate`, `nera check`, pages without `layout`, files authored under `public/`, use of `plugin-contact-form`, foreign generator traces (hugo/eleventy/astro/jekyll configs).
- **Files:** `test/cold-agent/run.sh`, `test/cold-agent/evaluate.sh`, `test/cold-agent/README.md` (how to run, what is isolated, how to trim transcripts)
- **Verify:** `bash test/cold-agent/run.sh --check-isolation` — inside the isolated env, `gh auth status` fails, `git ls-remote https://github.com/seebaermichi/nera-cli` works but a push would have no credentials, `npm whoami` fails, `pwd` is outside `~/workspace/nera`, and no `CLAUDE.md`/`AGENTS.md` is found walking up. Also `npx vitest run && npm run lint`, which must stay green with the new folder.
- **Review hardest:** the isolation. Make sure no credential path is missed (macOS keyring via `gh`, git's osxkeychain helper from the system gitconfig, `~/.npmrc`), and that the isolation does not also break the agent's own login (Claude in the keychain, Codex in `~/.codex`).
- **Risks:** a leaked credential publishes for real. User-level `~/.claude/CLAUDE.md`, skills or plugins that mention Nera would make the test un-cold, so check them and disable them for the run if needed.
- **Walkthrough:** none

### Step 2 — Run the Claude Code baseline and evaluate it — ✅ done

- **Goal:** one complete Claude Code session is recorded. The trimmed transcript (tool calls, commands, fetched URLs, final message), the final file tree and the `evaluate.sh` output are in `test/cold-agent/2026-10-10-baseline/claude/`, together with the exact `claude --version`, model, date and node version.
- **Files:** `test/cold-agent/2026-10-10-baseline/claude/{transcript.md,tree.txt,evaluation.txt,meta.md}`
- **Verify:** `bash test/cold-agent/evaluate.sh <run dir>` runs to completion and its output is saved. `npx vitest run && npm run lint` is still green.
- **Review hardest:** the transcript is trimmed, not edited. Every misstep stays in, including dead ends the agent recovered from, and no secret or home path beyond the temp dir is committed.
- **Risks:** a long or looping session. Cap it with `--max-turns` and record the cap.
- **Walkthrough:** none

### Step 3 — Run the Codex baseline and evaluate it — ⬜ todo

- **Goal:** the same as step 2 for Codex (`codex exec`, sandbox allowing network and writes inside the temp dir), in `test/cold-agent/2026-10-10-baseline/codex/`. Precondition: the user has installed Codex and logged in (`! npm i -g @openai/codex && codex login`).
- **Files:** `test/cold-agent/2026-10-10-baseline/codex/{transcript.md,tree.txt,evaluation.txt,meta.md}`
- **Verify:** `bash test/cold-agent/evaluate.sh <run dir>` runs to completion and its output is saved. `npx vitest run && npm run lint` is still green.
- **Review hardest:** Codex's sandbox must not hide failures the real user would hit. Network must be on, or "the agent couldn't fetch nera.js.org" is an artefact of the harness, not a finding.
- **Risks:** a Codex login or sandbox flag differs from what step 1 assumed, so adjust `run.sh` in this step.
- **Walkthrough:** none

### Step 4 — Record the findings in the ROADMAP under slice 0 — ⬜ todo

- **Goal:** `ROADMAP-ai.md` slice 0 carries a dated "Done" record. It has a criteria × agent table (pass/fail with one-line evidence), a numbered list of every misstep with its source in the transcripts, and the derived "`AGENTS.md` must say …" list as the input for slice 1. The status block at the top now reads "Next: slice 1".
- **Files:** `ROADMAP-ai.md`, `test/cold-agent/README.md` (link to the record)
- **Verify:** `npx vitest run && npm run lint`. Also `grep -n "Slice 0\|slice 0" ROADMAP-ai.md`, which must show the record and the updated status.
- **Review hardest:** every claim in the record traces to a line in a committed transcript or evaluation. No finding is invented or generalised beyond what was observed, and every `AGENTS.md` input is a true statement about core as of today (check against `../generator`).
- **Risks:** the record grows into a second spec. Keep it to observations and the slice-1 inputs, and link to the transcripts instead of quoting them at length.
- **Walkthrough:** none
