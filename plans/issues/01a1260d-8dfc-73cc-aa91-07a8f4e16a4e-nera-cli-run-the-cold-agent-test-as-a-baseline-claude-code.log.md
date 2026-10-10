# Work log — 01a1260d-8dfc-73cc-aa91-07a8f4e16a4e-nera-cli-run-the-cold-agent-test-as-a-baseline-claude-code

- **Issue:** `01a1260d-8dfc-73cc-aa91-07a8f4e16a4e`

## Issue snapshot (2026-10-10)

- **Id:** `01a1260d-8dfc-73cc-aa91-07a8f4e16a4e`
- **Type:** feature
- **Group:** S0 Baseline
- **Status:** in_progress
- **Title:** [nera-cli] Run the cold agent test as a baseline (Claude Code, Codex)

Spec: `nera-cli/ROADMAP-ai.md` — Slice plan, slice 0; Acceptance criteria.

Before any change: an empty temp folder, fresh session, no Nera context, the bakery prompt from the ROADMAP. Run with Claude Code and with Codex. Record every point where the agent goes wrong (wrong generator, invented config, files in `public/`, pages without `layout`, …) in the ROADMAP under slice 0. These failures are the input for `AGENTS.md` (S1).

## Decision (2026-10-10)

**D1 — Both sessions run headless from a committed script (user's choice).** The alternatives were for the user to run Codex, or both sessions, by hand. Those runs are closer to a real user but harder to reproduce in slice 7 and give no full transcript. The cost: the user installs Codex and logs in once before step 3, and headless mode cannot show interactive-only behaviour.

**D2 — Publishing credentials are hidden (user's choice).** `gh` is logged in as seebaermichi, and a cold agent told to "get it online" may run `gh repo create --public`. The alternatives were a throwaway GitHub account, which would really test "live URL" but needs an account and leaves public litter, and cutting the agent off before publishing, which loses the attempt itself as data. The cost: the "live URL" criterion cannot pass in the baseline. It could not pass anyway, because `nera publish` does not exist yet.

**D3 — The temp folder is outside the workspace.** The workspace-root `CLAUDE.md` and the project memory would otherwise give the agent exactly the knowledge the test must exclude.

**D4 — Trimmed transcripts and trees are committed under `test/cold-agent/` (user's choice).** The alternative was ROADMAP only, which loses the evidence slice 7 needs for a before/after comparison. `test/` is outside the npm `files`, so nothing ships.

**D5 — No version bump.** `ROADMAP-ai.md` and `test/` are not in the tarball, so per the release rules this is a "no release" change.

## Step 1 — started (2026-10-10)

base_sha: 062a36760c2a1d5e3ce3a5ffe876222c66ab3a1b
mode: fresh

## Step 1 — implemented (2026-10-10)

base_sha: 062a36760c2a1d5e3ce3a5ffe876222c66ab3a1b

### Changed
- `test/cold-agent/lib.sh` — the shared isolated env: run root under `$TMPDIR` (refused inside the workspace), `env -i` with an explicit allow-list, fake `HOME`, empty `GH_CONFIG_DIR`, `GIT_CONFIG_NOSYSTEM` + `credential.helper` reset via `GIT_CONFIG_COUNT`, no prompts/askpass, ssh forced to no config/identities/agent, empty user+global npmrc and a private npm prefix; `cold_prompt` reads the bakery prompt verbatim from `ROADMAP-ai.md`. Added beyond the plan's file list so `evaluate.sh` installs the agent's (untrusted) `package.json` in the same env without duplicating it.
- `test/cold-agent/run.sh` — `run.sh <claude|codex>` runs the agent headless with permissions off (`claude -p --dangerously-skip-permissions --output-format stream-json --verbose`, `codex exec --json --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox`) and writes `out/{prompt.txt,transcript.jsonl,stderr.log,tree.txt,meta.txt}`; passes in only the agent's own login (`CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`; Codex: only `~/.codex/auth.json` copied into a private `CODEX_HOME`, deleted on exit). `--check-isolation [agent]` runs 11 checks inside the env plus an optional login probe that prints a hint when it fails.
- `test/cold-agent/evaluate.sh` — on a copy without `node_modules`: foreign generator files/deps (incl. unscoped `nera`), `@nera-static/nera` dependency, pages without `layout` (+ page list with titles for the transcript judgement), `npm ci|install`, `nera build/validate/check`, hand-written `public/` files (shasum before vs after a clean build: gone → FAIL, differs → WARN), `plugin-contact-form` dependency and hand-written form markup. Exit 1 on any FAIL.
- `test/cold-agent/README.md` — how to run, the output files, what is isolated and why, what is not covered, how to trim and commit a run.

### Fixed alongside
- none

### Carry forward
- infra · S · `test/cold-agent/run.sh` — **Claude's login does not survive the fake HOME** (probe: `"result":"Not logged in · Please run /login"`). Before step 2, the user has to run `claude setup-token` once and export `CLAUDE_CODE_OAUTH_TOKEN`; `run.sh` passes that through. That is an interactive login, so it is the user's step, not something the session can do (same as Codex's install + login before step 3, D1).

### Verification
```
bash test/cold-agent/run.sh --check-isolation → 11× ok, "isolation: ok", exit 0
  (site folder outside workspace; HOME fake; no CLAUDE.md/AGENTS.md/.claude walking up; no token vars; gh not logged in; git no credential helper; git ls-remote github.com works; git credential fill finds nothing; ssh authenticates as nobody; npm whoami fails; npm view works)
bash test/cold-agent/run.sh --check-isolation claude → FAIL  claude is still logged in ("Not logged in · Please run /login") — see Carry forward
npx vitest run → Tests  42 passed (42)
npm run lint → eslint . (clean)
evaluate.sh smoke test on a fresh `nera new bakery` with a planted public/hand.html and a layout-less page → FAIL page without layout (not rendered): pages/nolayout.md; FAIL hand-written in public/ (gone after a clean build): hand.html; FAIL does not depend on @nera-static/plugin-contact-form; ok npm ci / nera build / validate / check; exit 1
```
`bash -n` is clean on all three scripts. shellcheck is not installed.

### Self-critique
- Rejected: unsetting a known list of token variables. `env -i` plus an allow-list is robust against variables nobody thought of.
- Rejected: the Codex/Claude sandboxes. Without network they cannot `npm install` Nera, so the run would test the sandbox, not Nera.
- The negative checks (`gh auth status` fails, `npm whoami` fails, ssh not authenticated) are not shown to be *discriminating*: I did not run them in the real env as a control, because the auto-mode classifier blocked my credential survey of the real env. They would also pass if gh/npm/ssh failed for an unrelated reason (e.g. no network). The positive reads (`ls-remote`, `npm view`) show the network was up.
- Not a sandbox: the agent runs as the same macOS user and could deliberately use `security` or an absolute `~/.ssh` path. Documented in the README as "not covered". The goal is no publishing *by accident*.
- The agent's own token (`CLAUDE_CODE_OAUTH_TOKEN`) is visible inside the session and in `ps` argv. It is not a publishing credential, but it could land in a transcript if the agent dumps `env`. The README's pre-commit grep covers it.
- Least sure: the exact `codex exec` flags (`--json`, `--skip-git-repo-check`, `--dangerously-bypass-approvals-and-sandbox`) are from knowledge. Codex is not installed yet, so they get proven in step 3. The `"OK"` login-probe match assumes both JSON formats quote the answer.
- `evaluate.sh`'s "nera check reports N warning line(s)" is a grep heuristic. The real check output is in the log for step 2/3 to read.

### Pressure-test questions for the reviewer
1. Is there any publish path left open: a credential source not reached by `env -i` + fake HOME + `GIT_CONFIG_NOSYSTEM` + `credential.helper=` + `GIT_SSH_COMMAND` + empty npmrcs (e.g. Homebrew git's own system config path, an npm token in a project-level `.npmrc` the agent writes, the gh keyring)?
2. Does `GIT_CONFIG_VALUE_0=` (empty) really reset the helper list when a higher-precedence file is absent but Apple's Xcode gitconfig is present? The in-env `git config --get-all credential.helper` returning empty says yes on this machine.
3. Is copying `~/.codex/auth.json` into `$TMPDIR` (mode 600, removed by the EXIT trap) acceptable, or should Codex get its own `codex login` inside the fake `CODEX_HOME`?
4. Is `lib.sh` as a fourth file (not in the plan's file list) acceptable?

## Step 1 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- `test/cold-agent/README.md:94` — "Not covered" now names browser logins (`netlify login`, `vercel login`, device flows): they open the maintainer's real browser and complete only if someone clicks "Authorize" — `bash test/cold-agent/run.sh --check-isolation` → isolation: ok

### Fixed alongside
- `test/cold-agent/evaluate.sh:174` — the hand-written-form check grepped only `pages/` and `views/`, but `nera new` scaffolds views under `theme/views/` (template/theme/views), so a form an agent writes into the scaffolded layout/page went undetected; now also scans `theme/` (the `vendor/plugin-contact-form/` exclusion already matches there) — +3/−2 lines — smoke test: `nera new bakery` + planted `theme/views/pages/contact.pug` with `form(action="mailto:…")`: before → no WARN; after → `WARN  hand-written form markup: theme/views/pages/contact.pug`; without the plant → no WARN

### Carry forward
- infra · S · `test/cold-agent/run.sh:41` — copying `~/.codex/auth.json` shares a ChatGPT-login refresh token between the real Codex and the run; if Codex rotates it during the run, the copy is deleted and the real login may be left with a used refresh token (logged out) — prefer a separate `codex login` into a persistent dedicated `CODEX_HOME` outside the fake HOME, or `OPENAI_API_KEY` — not now: Codex is not installed, decide and prove in step 3

### Checked
goal (run.sh/evaluate.sh/lib.sh/README match the step; prompt extracted verbatim from ROADMAP-ai.md) · `run.sh --check-isolation` → 11× ok, isolation: ok, exit 0 · `npx vitest run` → 42 passed · `npm run lint` clean · `test/` not in package `files` · Non-negotiables, Framework correctness, Tests & hygiene (no publish/push; secrets: agent token only, documented) · self-critique claims verified with real-env controls · pressure-test questions answered below · walkthrough n/a

### Answers to the pressure-test questions
1. No accidental publish path found. Controls in the **real** env make the negative checks discriminating: gh real = logged in (isolated: not), ssh real = "successfully authenticated" (isolated: not), git real = `file:/opt/homebrew/etc/gitconfig osxkeychain` (isolated: only `command line: credential.helper=`). npm whoami fails in the real env too, so that check is not discriminating — but it also means there is no npm token to leak. Homebrew's `/opt/homebrew/etc/gitconfig` and Apple's `/Library/Developer/CommandLineTools/usr/share/git-core/gitconfig` both exist; neither contributes a helper inside the env. A project `.npmrc` the agent writes would need a token it does not have. Netlify/Vercel/Wrangler/Firebase CLIs keep their logins under `os.homedir()`, which follows the fake `HOME`. Remaining hole is browser-based login (documented in review, above).
2. Yes. `/usr/bin/git` (Apple, reads the Xcode gitconfig) inside the env: `git config --show-origin --get-all credential.helper` → `command line:` (empty), and `git credential fill` for github.com → `terminal prompts disabled`, rc 128. Same for Homebrew git.
3. Acceptable for isolation (it is the agent's own login, mode 600, removed on exit), but see the carry forward: refresh-token rotation can invalidate the real login. Settle in step 3.
4. Yes. It removes duplication between run.sh and evaluate.sh, sits in the step's folder, and is documented in the README's file table.

## Step 1 — approved (2026-10-10)

snagio: ticked
