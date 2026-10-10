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

### Step 3 — Run the Codex baseline and evaluate it — ✅ done

- **Goal:** the same as step 2 for Codex (`codex exec`, sandbox allowing network and writes inside the temp dir), in `test/cold-agent/2026-10-10-baseline/codex/`. Precondition: the user has installed Codex and logged in (`! npm i -g @openai/codex && codex login`).
- **Files:** `test/cold-agent/2026-10-10-baseline/codex/{transcript.md,tree.txt,evaluation.txt,meta.md}`
- **Verify:** `bash test/cold-agent/evaluate.sh <run dir>` runs to completion and its output is saved. `npx vitest run && npm run lint` is still green.
- **Review hardest:** Codex's sandbox must not hide failures the real user would hit. Network must be on, or "the agent couldn't fetch nera.js.org" is an artefact of the harness, not a finding.
- **Risks:** a Codex login or sandbox flag differs from what step 1 assumed, so adjust `run.sh` in this step.
- **Walkthrough:** none

### Step 4 — Record the findings in the ROADMAP under slice 0 — ✅ done

- **Goal:** `ROADMAP-ai.md` slice 0 carries a dated "Done" record. It has a criteria × agent table (pass/fail with one-line evidence), a numbered list of every misstep with its source in the transcripts, and the derived "`AGENTS.md` must say …" list as the input for slice 1. The status block at the top now reads "Next: slice 1".
- **Files:** `ROADMAP-ai.md`, `test/cold-agent/README.md` (link to the record)
- **Verify:** `npx vitest run && npm run lint`. Also `grep -n "Slice 0\|slice 0" ROADMAP-ai.md`, which must show the record and the updated status.
- **Review hardest:** every claim in the record traces to a line in a committed transcript or evaluation. No finding is invented or generalised beyond what was observed, and every `AGENTS.md` input is a true statement about core as of today (check against `../generator`).
- **Risks:** the record grows into a second spec. Keep it to observations and the slice-1 inputs, and link to the transcripts instead of quoting them at length.
- **Walkthrough:** none

### Step 5 — Harness fixes: no shared Codex login, `site/` in its own temp folder, `COLD_MODEL` passthrough — ✅ done

- **Goal:** fixes triage items 1–3. (1) `run.sh` never copies `~/.codex/auth.json`. Codex uses a persistent, dedicated `CODEX_HOME` (`COLD_CODEX_HOME`, default under `~/.cache/nera-cold-agent/codex`, logged in once with `CODEX_HOME=… codex login`) or `OPENAI_API_KEY`, and fails with that instruction when it has neither. The `cleanup` trap that deletes the copied login goes. (2) `site/` is created by its own `mktemp -d`, so the transcript (`out/`), the fake HOME and scratch are not reachable as its siblings. Both roots are checked against the workspace, and evaluation still finds the site. (3) A `COLD_MODEL` env var is passed as `--model` (Claude) / `-m` (Codex) when it is set. Unset means the CLI default, which is what a cold user gets.
- **Files:** `test/cold-agent/run.sh`, `test/cold-agent/lib.sh`, `test/cold-agent/evaluate.sh` (if it derives the site path from the root), `test/cold-agent/README.md`
- **Verify:** `bash -n` and `shellcheck` (if installed) on the three scripts. `bash test/cold-agent/run.sh --check-isolation` passes and prints a site path outside the run root. `grep -n 'auth.json' test/cold-agent/*.sh` finds no copy. With `COLD_CODEX_HOME` pointing at an empty folder and no `OPENAI_API_KEY`, `run.sh --check-isolation codex` fails with the login instruction. `npx vitest run && npm run lint`.
- **Review hardest:** no path writes into or reads from the real `~/.codex`, the dedicated `CODEX_HOME` is outside the workspace, and `env -i` still passes nothing beyond the listed variables. The site root's parent no longer holds `out/` or `home/`.
- **Risks:** `evaluate.sh` or the README still assume `<root>/site`. Grep for `COLD_SITE` and `/site` and update every use.
- **Walkthrough:** none

### Step 6 — `nera new .` scaffolds into the current folder — ⬜ todo

- **Goal:** fixes triage item 4 (finding 2 in the ROADMAP record). `nera new .` scaffolds into the current working directory when it is empty, ignoring dotfiles such as `.git`. It refuses with a clear message when the folder holds anything else. The package name comes from the folder's basename, normalised to the same rule as `validateProjectName` (lower-case, invalid characters → `-`). The final "Next steps" leave out `cd`. `nera new <name>` behaves as before. README usage and the CLI usage text mention `.`. A minor bump with a CHANGELOG entry.
- **Files:** `src/scaffold.js`, `bin/nera.js` (usage text), `test/scaffold.test.js`, `README.md`, `CHANGELOG.md`, `package.json`/`package-lock.json` (via `npm version minor --no-git-tag-version`)
- **Verify:** new tests in `test/scaffold.test.js`: `.` in an empty temp dir scaffolds and sets `package.json` `name` from the basename. `.` in a dir holding only `.git` works. `.` in a non-empty dir throws and writes nothing. A basename like `My Site` becomes `my-site`. `npx vitest run && npm run lint`.
- **Review hardest:** the non-empty check happens before any write. `.`/`./` are the only new accepted spellings, with no `..` or absolute paths. Existing name validation is unchanged for every other input.
- **Risks:** the `.gitignore` written from `_gitignore` collides with an existing `.gitignore` in the folder. Default: keep the user's file and print one line saying so. Test it.
- **Walkthrough:** none

### Step 7 — Core: `HTML created` names the page, dotenv runs quiet — ⬜ todo

- **Goal:** fixes triage items 5–6, in `../generator` (`@nera-static/core`). The build log prints the page's output path (`HTML created: /about.html`, `/de/index.html`) instead of `meta.dirname`. `dotenv.config({ quiet: true })` stops the `◇ injected env (0) from .env` banner, while `.env` values are still loaded. Patch bump in core with a CHANGELOG entry (`npm version patch --no-git-tag-version`). Tagging and the CI release need the user's go and are not part of this step.
- **Files:** `../generator/src/render.js`, a test under `../generator/test/` (log line + `.env` still loaded), `../generator/CHANGELOG.md`, `../generator/package.json`/`package-lock.json`
- **Verify:** in `../generator`: `npx vitest run && npm run lint`. One test asserts the logged line for a root page and a nested page, and that no `injected env` banner is printed. `npm run render` in `../generator` shows one distinct path per page.
- **Review hardest:** the logged path matches the file actually written (its path under `public/`, not a `base_path`-prefixed URL), and `quiet` does not drop `.env` loading. The patch is semver-correct (log text only, no contract change).
- **Risks:** a test or downstream tool greps the old `HTML created:` text. Grep `../generator`, `nera-cli` and `nera-validate` for it before changing.
- **Walkthrough:** none
