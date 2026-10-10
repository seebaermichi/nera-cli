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
commit: c0fafc8

## Step 2 — started (2026-10-10)

base_sha: 93409c63fb687f1167dc7bf1608c42f6853e7bb7
mode: fresh

## Step 2 — implemented (2026-10-10)

base_sha: 93409c63fb687f1167dc7bf1608c42f6853e7bb7

### Changed
- `test/cold-agent/2026-10-10-baseline/claude/transcript.md` — trimmed transcript of the Claude Code run: every agent message and tool call in order, results cut to 15 lines, commands cut at 700 chars, run root → `<root>`, `$TMPDIR` → `<tmp>`; nothing reworded. Generated by a jq filter (not committed), so the trim is mechanical.
- `test/cold-agent/2026-10-10-baseline/claude/meta.md` — version, model (`claude-sonnet-5-5`, CLI default), command incl. `--max-turns 60`, turns used (11), duration/cost (87 s / $0.16), node/npm, resolved `@nera-static/nera` 1.4.1 / core 4.15.0, the discarded first run and why, what the agent did outside its folder.
- `test/cold-agent/2026-10-10-baseline/claude/{evaluation.txt,tree.txt,prompt.txt}` — `evaluate.sh` output (exit 1), the site tree, the prompt as sent.
- `test/cold-agent/run.sh` — `--max-turns "$COLD_MAX_TURNS"` (default 60) on the Claude command (the plan's "Risks: cap it"); `meta.txt` records the full agent command so the cap is in the record.
- `test/cold-agent/README.md` — documents the turn cap and that a committed run carries `meta.md` (not `meta.txt`).

### Fixed alongside
- `test/cold-agent/lib.sh:41` — the private npm prefix was created without `lib/`, so every `npx` in the isolated env failed with `ENOENT … npm-global/lib` (it hit the first run's agent) — +2/−1 lines — in-env `npx -y @nera-static/nera --version`: with `lib/` the CLI starts; after `mv lib x` → `ENOENT` ×2.

### Carry forward
- none (the Nera findings below are this step's result, for step 4 to write into the ROADMAP)

### Findings (Claude Code baseline, input for step 4)
Pass criteria: build ok · `nera validate` ok · `nera check` ok (no warnings) · all 6 requested pages exist and render (6 md → 6 html) · `public/` untouched by hand ok · **contact-form plugin FAIL** · **live URL FAIL** · no generator confusion ok (no foreign files/deps, used `npx @nera-static/nera new` straight from the homepage).
Where it went wrong / what AGENTS.md (slice 1) must say:
1. **Contact form hand-written**: raw `<form>` in `pages/kontakt.md` posting to Formspree (`FORM_ID_EINTRAGEN`); never learned `@nera-static/plugin-contact-form` exists. The nera.js.org summary said "The provided content doesn't cover forms."
2. **Not online**: probed `~/.config`, `which netlify vercel wrangler gh surge`, `gh auth status`; stopped and asked for a host/login. Expected (no `nera publish`), and the stop is the correct behaviour.
3. **`nera new` cannot target the given folder**: run 1 tried `nera new .` → "Invalid project name"; run 2 scaffolded into a sibling `<root>/scaffold/` and `cp -R`'d it in — writing outside its folder.
4. **URL shape guessed wrong**: first wrote `/ueber-uns/` links (pretty URLs), found `public/oeffnungszeiten/index.html` missing, sed-rewrote to `.html`.
5. **Hand-written nav** in the layout; navigation plugin unknown. Canonical-links/`app_origin` unknown in run 2 (run 1 knew of it from docs).
6. Only the homepage was fetched in run 2 (run 1 also read docs/index, deployment, writing-content) — docs reach is luck.
7. Noise every agent sees: `◇ injected env (0) from .env` (dotenv banner) and the `glob@10.5.0` deprecation warning on every `npx`; `nera --version` is not a command (prints usage, exit 1).
8. Placeholders: invented hours/address/story, marked "Platzhalter"; imprint/privacy as templates with brackets — reasonable, legal text flagged as not legal advice.

### Verification
```
bash test/cold-agent/run.sh --check-isolation claude → 12× ok, "isolation: ok"
CLAUDE_CODE_OAUTH_TOKEN=… bash test/cold-agent/run.sh claude → exit 0; result subtype=success turns=11 duration_ms=87208
bash test/cold-agent/evaluate.sh <root>/site → ran to completion, "evaluate: FAILED" (exit 1): FAIL does not depend on @nera-static/plugin-contact-form; WARN hand-written form markup: pages/kontakt.md; all other checks ok
npx vitest run → Tests  42 passed (42)
npm run lint → eslint . (clean)
bash -n run.sh lib.sh → clean
grep -niE 'token|ghp_|npm_|sk-' baseline/claude/* → no hits; grep '/Users/|/private/var' → no hits
```

### Self-critique
- **Discarded a run.** Run 1 (15:13Z) was distorted by the harness bug, so the committed baseline is run 2. That is a choice the reviewer should check: run 1's one Nera-specific finding (`nera new .` refused) is kept in `meta.md` and above; its transcript is not committed. Rejected: committing both — two baselines for one agent is what slice 7 would diff against ambiguously.
- One sample of a non-deterministic agent. Run 1 vs run 2 already differ (docs pages read, folder handling). The findings that recur in both (hand-written Formspree form, not online, `nera new` vs given folder, `.html` vs pretty URLs) are the solid ones.
- Model is `claude-sonnet-5-5`, the default for the token's account, not pinned. Recorded, not pinned, because "cold" means what a user gets by default; step 3/7 may want `--model` pinned for comparability.
- The transcript keeps the macOS username in an `ls -la` result (also in git author data). It is not a path or a secret, and removing it would be editing.
- The agent could see `<root>/out/` (its own live transcript) as a sibling and wrote `<root>/scaffold/`; the run folder layout is not hidden from it. It did not read `out/`.
- Token incident during setup (not in the diff): listing `~/.config/nera/` printed a file named after the first setup token into this session; the user regenerated the token and deleted that file; revocation of the old one is with the user.

### Pressure-test questions for the reviewer
1. Is discarding run 1 and committing run 2 acceptable, or should the baseline include run 1 too?
2. Does the trimmed transcript drop anything a reviewer would call a misstep? (Compare `transcript.md` against the 46-line JSONL — the long heredoc writing all six pages is cut at 700 chars; its result is kept.)
3. Should the run root put `out/` out of the agent's reach (e.g. `site` in a separate mktemp dir)?
4. Pin `--model` for comparability with slice 7, or keep the default?

## Step 2 — reviewed (2026-10-10)

Verdict: rework

### 🔴 Blocking
- `test/cold-agent/2026-10-10-baseline/claude/transcript.md:178-198` — the trim drops the misstep this step's "Review hardest" says must stay in, plus the evidence for the baseline's headline finding. (1) The heredoc call's result is cut at 15 lines, and the 4 trimmed lines include `ugrep: warning: public/oeffnungszeiten/index.html: No such file or directory`. That is the agent's failed probe for pretty URLs, which finding 4 rests on (verified against `<tmp>/nera-cold-agent.2CYcsl/out/transcript.jsonl`). (2) The 700-char command cut removes the `/ueber-uns/`-style links in `layout.pug` and the pages, the hand-written Formspree `<form>` in `pages/kontakt.md` (finding 1, the one FAIL) and the probe command itself. (3) The replacement text says "final file contents: see tree.txt / the run's site folder", but `tree.txt` lists only names and the run folder is an uncommitted temp dir, so the pointer leads nowhere. Fixed looks like this: a result line that shows an error or warning is never trimmed (or results are capped higher, so this one stays whole); a long command keeps every non-heredoc line, and each heredoc collapses to `cat > <file> <<'EOF' … [N lines]`; the files that carry findings (`pages/kontakt.md`, `theme/views/layouts/layout.pug` as first written) are committed or inlined verbatim; and the jq filter that does the trim is committed (e.g. `test/cold-agent/trim.sh`), so the trim is reproducible rather than "mechanical but unseen". Also update the README "Committing a run" rule "Drop file contents the tree already shows", because the tree shows no contents.

### Fixed in review
- `test/cold-agent/2026-10-10-baseline/claude/meta.md:37-40` — "started `nera serve` or `nera dev`" made exact (`npx nera serve`, per the transcript). It now also records two actions outside the folder that were missing: the log at `/tmp/s.log` and `pkill -f "nera serve"`, which kills any `nera serve` on the machine. `grep -n 'pkill' meta.md` → present. +4/−2

### Fixed alongside
- none

### Carry forward
- infra · S · `test/cold-agent/lib.sh:30-37` — `out/` (the live transcript) and the agent's scratch area are siblings of `site/` inside one mktemp root, so the agent can see and write them (it wrote `<root>/scaffold/`). Why not now: a harness design choice (separate mktemp for `site`), not needed for this baseline because the agent did not read `out/`.
- design · S · `test/cold-agent/run.sh:39` — pin `--model` for slice-7 comparability, or keep the CLI default. Why not now: a decision for step 4/slice 7. Recommendation: keep the default (cold = what a user gets), and pin the slice-7 rerun to `claude-sonnet-5-5` as recorded in `meta.md`.

### Checked
Goal: all 5 files present, the run matches `meta.txt` of `nera-cold-agent.2CYcsl` (15:16:00Z, exit 0, `--max-turns 60`). Verify: `evaluate.sh <tmp>/nera-cold-agent.2CYcsl/site` → exit 1, output identical to `evaluation.txt`; `npx vitest run` → 42 passed; `npm run lint` → clean; `bash -n run.sh lib.sh` → ok. Secrets/paths grep over the committed run files → only `~/.config` inside the agent's own command, no `/Users/`, `/private/` or tokens. Transcript compared call-by-call against the 46-line JSONL: every agent text and tool call is present and in order, and none is reworded. Conventions: Non-negotiables (no publish/push; no secrets), Tests & hygiene. The `lib.sh` fixed-alongside entry is +2/−1, within budget; its proof is a manual in-env check rather than a test, which is acceptable for a shell harness with no suite. Walkthrough n/a.

### Answers to the pressure-test questions
1. Discarding run 1 is acceptable. Its detour (`mkdir -p ../npm-global/lib`) was caused by the harness. Its one Nera finding (`nera new .` → "Invalid project name") is kept in `meta.md` and the log, and its raw run stays in `<tmp>/nera-cold-agent.ELDPb9` until it is cleaned up. A single baseline per agent is the right thing to diff against in slice 7.
2. Yes, see 🔴. The trimmed 4 lines of the heredoc result contain the `oeffnungszeiten/index.html: No such file` probe, and the command cut removes the Formspree form and the pretty-URL links. Everything else (ToolSearch, `ls -la`, WebFetch, scaffold, `cp -R`, `gh auth status`, sed, serve/curl, final grep) is intact.
3. Not required for this baseline (the agent never read `out/`), so it is carried forward. A separate mktemp for `site` would also make "writing outside its folder" easier to detect.
4. Keep the default and record it (done). Pin for the slice-7 rerun. Carried forward.

## Step 2 — reworked (2026-10-10)

base_sha: 93409c63fb687f1167dc7bf1608c42f6853e7bb7

### Changed
- 🔴 "never trim an error/warning line" → new `test/cold-agent/trim.sh`: results keep the first 15 lines **plus every later line matching** `\berr|warn|fail|enoent|no such file|not found|denied|invalid|cannot|unable` (case-insensitive), with `… [N lines trimmed]` markers at each gap. `transcript.md:185` now carries `ugrep: warning: public/oeffnungszeiten/index.html: No such file or directory`.
- 🔴 "keep every non-heredoc command line, collapse heredocs" → `trim.sh` drops the 700-char cut; commands keep every line, each heredoc collapses to `cat > <file> <<'EOF' … [N lines]` with its terminator kept (`transcript.md:143-164`, `:194`). Here-strings (`<<<`) are not mistaken for heredocs.
- 🔴 "commit kontakt.md and the first layout.pug verbatim" → `test/cold-agent/2026-10-10-baseline/claude/files/pages/kontakt.md` (the Formspree `<form>`, final state = after the `.html` rewrite) and `files/theme/views/layouts/layout.first.pug` (extracted byte-for-byte from the heredoc; differs from the final layout only in the 5 `/x/` → `/x.html` links). Both listed in `meta.md` with what each proves.
- 🔴 "commit the trim filter" → `test/cold-agent/trim.sh <run root> > transcript.md`; also strips ANSI colour codes, maps run root → `<root>`, temp dir → `<tmp>` (with and without `/private`), drops thinking blocks and token/rate-limit events, adds session start/end lines. `transcript.md` regenerated from it, not edited.
- 🔴 "fix the README rule" → `test/cold-agent/README.md`: the "drop file contents the tree already shows" rule is replaced by the `trim.sh` rules, a `files/` entry (verbatim evidence; earlier versions named `<name>.first.<ext>`), and `trim.sh` in the file table.

### Fixed alongside
- none

### Carry forward
- infra · S · `test/cold-agent/trim.sh` — handles Claude's stream-json only; Codex's `codex exec --json` needs its own branch — step 3 (unrelated to this rework).

### Verification
```
bash -n test/cold-agent/trim.sh → ok
bash test/cold-agent/trim.sh <run2 root> | diff - claude/transcript.md → identical (rerunnable)
synthetic jsonl: "npm ERR! boom" at line 21 of a 22-line result → kept, gaps marked "… [5 lines trimmed]" / "… [1 line trimmed]"; "cat <<<word" left alone; heredoc → "cat > f <<'EOF' … [2 lines]" + "EOF"
bash test/cold-agent/evaluate.sh <run2 root>/site → exit 1, output identical to evaluation.txt
grep -rniE 'token|ghp_|npm_|sk-' claude/ → no hits; grep -rnE '/Users/|/private/|/var/folders' claude/ → no hits
npx vitest run → Tests  42 passed (42)
npm run lint → eslint . (clean)
```

### Self-critique
- The "notable" pattern is a heuristic: it also keeps the scaffold's `nera validate warns …` comment lines (harmless false positive) and would miss an error worded without any of the keywords. Rejected keeping full results: the scaffold `cat` dump alone is ~75 lines.
- Stripping ANSI codes is a mechanical change to result text, not a rewording; the previous transcript was also stripped, and the header says so.
- `files/pages/kontakt.md` is the final state (its Datenschutz link already `.html`), not the first-written one; the first-written form is identical except that link. I committed the final one because that is what `evaluate.sh` judged; `meta.md` says so.
- `paths` uses `gsub` with the run root as a regex (dots match any char) — cannot over-match in practice since the root is a unique mktemp path.

### Pressure-test questions for the reviewer
1. Compare `transcript.md` line by line against the raw JSONL: is any result line with an error/warning still missing?
2. Is `kontakt.md` in its final state acceptable evidence, or do you want the first-written version as `kontakt.first.md` too?
3. Is the session start/end line acceptable inside a "nothing reworded" transcript (it is generated metadata, clearly marked in italics)?

## Step 2 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- none (the step-3 Codex branch of `trim.sh` is already logged by the implementer; the earlier review's two carries stand)

### Checked
Re-review of the one 🔴 only. (1) The error line is kept: `transcript.md` carries `ugrep: warning: public/oeffnungszeiten/index.html: No such file or directory` with `… [N lines trimmed]` gaps around it. (2) Commands are no longer cut. Every non-heredoc line is present (the sed rewrite, serve/curl/pkill, the build+probe line), and each heredoc collapses to `cat > <file> <<'EOF' … [N lines]` + `EOF`. (3) Evidence is committed: `files/pages/kontakt.md` is byte-identical to `<root>/site/pages/kontakt.md`, and `files/theme/views/layouts/layout.first.pug` is byte-identical to the `layout.pug` heredoc body extracted from `transcript.jsonl` with jq. (4) `trim.sh` is committed and reproducible: `bash test/cold-agent/trim.sh <root> | diff - transcript.md` → identical. (5) The README "Committing a run" rule is replaced with the `trim.sh` rules plus a `files/` entry. Verify: `evaluate.sh <root>/site` → exit 1, output identical to `evaluation.txt`. `npx vitest run` → 42 passed. `npm run lint` → clean. A grep for `/Users/|/private/|/var/folders|ghp_|npm_…|sk-` over `2026-10-10-baseline/` → no hits. No walkthrough (none).

### Answers to the pressure-test questions
1. The rerun of `trim.sh` matches `transcript.md` exactly, and the `notable` pattern covers the one warning the previous review found missing. I did not do another full line-by-line sweep: this is a re-review limited to the 🔴.
2. The final state is acceptable. The first-written version differs only in the Datenschutz link, and that URL-shape finding is already proven by `layout.first.pug` and the sed command in the transcript. `meta.md` states that it is the final state.
3. Yes. The start/end lines are generated, italic and described in the header, and they reword nothing the agent said or ran.

## Step 2 — approved (2026-10-10)

snagio: ticked
gate: `.claude/.ui-paths` narrowed from `\.pug$|\.s?css$` to `^template/.*\.(pug|s?css)$` (user's choice) — the captured evidence `.pug` under `test/cold-agent/` is not rendered UI.
commit: df537aa

## Step 3 — started (2026-10-10)

base_sha: df537aaf5198d20f9ea8652200de5b987448e0f1
mode: fresh

## Step 3 — implemented (2026-10-10)

base_sha: df537aa

### Changed
- `test/cold-agent/2026-10-10-baseline/codex/transcript.md` — trimmed transcript of the Codex run (23 shell commands, 11 file edits, 4 web searches, 6 messages — all present), generated by `trim.sh`.
- `test/cold-agent/2026-10-10-baseline/codex/meta.md` — version, model (`gpt-6-luna`, CLI default), sandbox/approval mode, command, no turn cap, duration/tokens (191 s, 1.56 M input / 15 k output), node/npm, resolved nera 1.4.1 / core 4.15.0, the discarded first run and why, what is missing from the JSON events (policy-rejected `rm -rf`, two failed `apply_patch` edits, `open_page` content).
- `test/cold-agent/2026-10-10-baseline/codex/{evaluation.txt,tree.txt,prompt.txt}` — `evaluate.sh` output (exit 1), site tree, the prompt as sent (identical to the Claude run's).
- `test/cold-agent/2026-10-10-baseline/codex/files/pages/{kontakt.md,ueber-uns.md}` — verbatim evidence: the hand-written mailto form + inline script; a page that is raw HTML inside Markdown.
- `test/cold-agent/trim.sh` — reads Codex's `codex exec --json` too (branch picked from the first event; `item.completed` only, since `item.started` duplicates it). Claude filter unchanged: on both surviving Claude run roots, old and new trim give identical output, and the committed Claude `transcript.md` is reproduced byte for byte.
- `test/cold-agent/lib.sh` — `cold_make_path`: PATH without any global `nera`/`nera-*` (see Fixed alongside).
- `test/cold-agent/run.sh` — isolation check "no global Nera command on PATH"; comment: `codex exec` has no turn limit flag.
- `test/cold-agent/README.md` — trim handles both agents; Codex is uncapped (no flag in codex-cli 0.162.1); the PATH filter documented under "What is isolated".

### Fixed alongside
- `test/cold-agent/lib.sh:51` — the isolated env kept the maintainer's PATH, which holds the deprecated `@nera-static/installer` as `/opt/homebrew/bin/nera` and an old `nera-validate` in the nvm bin; Codex run 1 hit the installer's usage line on `npm run build` — +32/−1 lines (lib.sh, run.sh) — in-env `! command -v nera && ! compgen -c nera-`: with the real PATH → exit 1, with `cold_make_path` → exit 0; `run.sh --check-isolation codex` → 13× ok. The Claude baseline is unaffected (it only ever ran `npx nera` inside an installed site, which resolves the local bin).

### Carry forward
- bug · S · `../generator/src/render.js:515` — the build log prints `HTML created: ${meta.dirname}`, so every root-level page logs `HTML created: /` (6× in both runs); it should name the file/href — different repo (core).

### Findings (Codex baseline, input for step 4)
Pass criteria: build ok · `nera validate` ok · `nera check` ok · all 6 requested pages exist and render (6 md → 6 html) · `public/` untouched by hand ok · **contact-form plugin FAIL** · **live URL FAIL** · no generator confusion ok (only `@nera-static/nera`; but read the *core* README first, which says "you probably don't want this package").
Where it went wrong / what AGENTS.md (slice 1) must say:
1. **`nera new .` refused** ("Invalid project name") — now in 3 of 4 runs (both Codex runs, Claude run 1). Every agent then scaffolds into a subfolder and copies up; Codex's `rm -rf` of the subfolder was blocked by its own command policy, so it fell back to `python3 shutil.rmtree`. Strongest finding: `nera new` should accept `.`/the current empty folder.
2. **Contact form hand-written** again: `<form>` + inline `<script>` building a `mailto:` URL in `pages/kontakt.md`; plugin never discovered.
3. **Not online**: probed `command -v gh vercel netlify`, env vars, `git remote -v`; stopped and said so. Expected; correct stop.
4. **Pages written as raw HTML in `.md`** (all six pages; `index.md` includes an inline SVG). Nothing says pages are Markdown with frontmatter, and the template renders HTML through, so it works — but it defeats the content model (slice 1: "write Markdown; markup goes in views").
5. **Template/layout errors from guessing Pug**: deleted the scaffold's `pages/default.pug` → `ENOENT ./theme/views/pages/default.pug`; then wrote `!{ content }` on its own line → `unexpected text "!{ co"`; then `main#main !{ content }` nested in a layout that already had `<main>` → `nera check` warned `a11y-main` (two `<main>`), which the agent fixed. `nera check` earned its keep here.
6. **Docs reach via GitHub, not nera.js.org**: `open_page` on nera.js.org (content not logged), then `curl` of the GitHub API, the core README (`master` branch), the nera-cli README; guessed a raw path `test/fixtures/site/config/app.yaml` → 404. An `llms.txt` (slice L2) would have been the natural entry.
7. Same noise as Claude: dotenv banner `◇ injected env (0) from .env`, `glob@10.5.0` deprecation on every `npx`/install.
8. Copied the scaffold without `node_modules`; ran `npm install --package-lock-only`, then `npm run build` (in the clean run it ran `npm ci` first, correctly).
9. Placeholders clearly marked ("Beispielzeiten", "Musteradresse – bitte ersetzen", `.example` email); removed an invented "Seit 2018" — good behaviour.

### Verification
```
bash test/cold-agent/run.sh --check-isolation codex → 13× ok (incl. "no global Nera command on PATH", "codex is still logged in"), "isolation: ok"
bash test/cold-agent/run.sh codex → exit 0; 15:56:18Z → 15:59:29Z; task_complete
bash test/cold-agent/evaluate.sh <root>/site → ran to completion, "evaluate: FAILED" (exit 1): FAIL does not depend on @nera-static/plugin-contact-form; WARN hand-written form markup: pages/kontakt.md; all other checks ok (npm ci, nera build, nera validate, nera check, 6 HTML from 6 pages, nothing hand-written in public/)
npx vitest run → Tests  42 passed (42)
npm run lint → eslint . (clean)
bash -n test/cold-agent/*.sh → clean (shellcheck not installed)
trim.sh old vs new on Claude run roots 2CYcsl/ELDPb9 → identical; 2CYcsl vs committed claude/transcript.md → identical
grep -rniE 'token|ghp_|npm_|sk-' baseline/codex → only token counts; grep '/Users/|/private/var' → no hits
ls $TMPDIR/nera-cold-agent.*/codex/auth.json → none (login copies removed)
```

### Self-critique
- **Discarded a run again**, on the Step 2 precedent (harness defect distorted it → fix, re-run, record in `meta.md`). Run 1's transcript is not committed. Its divergence from run 2 was small (one wasted `npm run build`), so the reviewer may judge the re-run unnecessary; I chose a baseline free of maintainer state over saving 4 minutes.
- The PATH mirror is a snapshot at run start: something installed into a mirrored folder *during* the run (e.g. `brew install`) would not be visible. Agents' `npm i -g` goes to the private prefix, which is not mirrored, so that case works. Also, the agent sees odd paths like `<root>/path/1/gh` (visible in the transcript); it did not react to them.
- Only `nera`/`nera-*` are hidden. Other maintainer-specific globals stay visible (`snagio`, `~/.claude/bin`) — none are Nera knowledge, but `~/.claude/bin` on PATH for a Codex run is a small cold-ness leak; left as is.
- One sample of a non-deterministic agent; the findings that recur across both Codex runs and the Claude runs (`nera new .`, hand-written form, not online, docs reach by luck) are the solid ones.
- The Codex JSON stream omits policy rejections and failed patches; I recorded them in `meta.md` from `stderr.log` instead of folding stderr into `transcript.md`, to keep the transcript a pure function of the JSONL.
- Model not pinned (`gpt-6-luna` default), same reasoning as Step 2.

### Pressure-test questions for the reviewer
1. Does network work in the Codex run as a real user would have it? (Evidence: `curl` to nera.js.org, api.github.com and raw.githubusercontent.com all returned content; `npx @nera-static/nera` installed from the registry; sandbox `danger-full-access`.)
2. Is the PATH filter enough to call the run cold — should `~/.claude/bin`/`snagio` be stripped too?
3. Was re-running (discarding run 1) right, or should run 1 have been kept as the baseline with a note?
4. Should `trim.sh` append the `ERROR` lines from `stderr.log` so the transcript shows the rejected `rm -rf`?

## Step 3 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- none (the implementer's `../generator/src/render.js:515` "HTML created: /" item is already in the step's log)

### Checked
Goal: the Codex run is committed in `2026-10-10-baseline/codex/` with transcript/tree/evaluation/meta/prompt and evidence files · Verify: `evaluate.sh <AlmWdg>/site` re-run → exit 1, output byte-identical to the committed `evaluation.txt`; `npx vitest run` → 42 passed; `npm run lint` clean; `bash -n` clean · trim.sh: new trim on run root AlmWdg reproduces the committed Codex `transcript.md`; on 2CYcsl reproduces the committed Claude transcript; old (df537aa) vs new trim on ELDPb9 identical · `prompt.txt` identical to the Claude run's · `files/pages/{kontakt,ueber-uns}.md` identical to the run's site · secret/path scan of `codex/` (`/Users/`, `/private/var`, `ghp_`, `npm_…`, `sk-…`) → no hits; no `auth.json` left in the run's CODEX_HOME · conventions: Non-negotiables (nothing published/pushed, no tokens), Framework correctness (no package code touched), Tests & hygiene (test/vitest green) · scope: only the step's files plus the declared Fixed-alongside PATH filter (+32/−1, lib.sh/run.sh, covered by the new isolation check; no decision needed) · walkthrough n/a (`none`).

### Answers to the pressure-test questions
1. Yes. `run.sh` uses `--dangerously-bypass-approvals-and-sandbox` (meta: sandbox `danger-full-access`); the transcript shows `curl` to api.github.com and raw.githubusercontent.com returning content (lines 62–125), a 404 that is a real 404 of a guessed path, and `npx --yes @nera-static/nera new` installing from the registry. Only Codex's own `rm -rf` command policy interfered, which a real Codex user also hits — recorded in `meta.md`, so it is not a hidden harness artefact. I also checked that the agent's `zsh -lc` login shell cannot undo the PATH filter: `/etc/paths` and `/etc/paths.d/*` hold no `nera`/`nera-*`, and HOME is the private one, so no maintainer `.zprofile` runs.
2. It is enough. `~/.claude/bin` is on the maintainer's PATH but the folder does not exist (`ls` → missing), so nothing leaks through it; a stray `snagio` carries no Nera knowledge. Strip it later only if a future run shows the agent reacting to it.
3. Re-running was right. With a global installer `nera` on PATH, run 1's `npm run build` measured the maintainer's machine, not a cold one. That follows the Step 2 precedent, and `meta.md` records the discarded run and how it differed.
4. No. Keeping `transcript.md` a pure function of the JSONL is what makes it reproducible (verified above). `meta.md` already quotes the three `ERROR` lines, which I confirmed in `stderr.log` (rsync+rm rejection, two failed `apply_patch`).

## Step 3 — approved (2026-10-10)

snagio: ticked
commit: 6df1ab5

## Step 4 — started (2026-10-10)

base_sha: 6df1ab5fa497aae7b3bcb18ab4e1be53310eff01
mode: fresh

## Decision (2026-10-10)

Which model the slice-7 rerun uses → pinned to the baseline models (`claude -p --model claude-sonnet-5-5`, `codex exec --model gpt-6-luna`), plus an optional extra run on the then-default model. A difference then comes from Nera, not the model. Written into ROADMAP-ai.md slice 0 record.

## Step 4 — implemented (2026-10-10)

base_sha: 6df1ab5

### Changed
- `ROADMAP-ai.md` — status block: slice 0 done, D1–D12, "Next: slice 1, `AGENTS.md`"; slice-plan item 0 marked done with a pointer to the record.
- `ROADMAP-ai.md` — new `## Slice 0 — baseline record (2026-10-10)`: criteria × agent table, 7 numbered missteps plus a "not agent errors" paragraph (noise, `HTML created: /`, installer `nera` shadowing), and "Inputs for `AGENTS.md` (slice 1)" with 8 lines, each mapped to a finding. Every claim cites `claude:N`/`codex:N` (line of the committed `transcript.md`), `files/…`, `evaluation.txt` or `meta.md`.
- `ROADMAP-ai.md` — Decisions: D12 (slice-7 rerun pins `claude-sonnet-5-5` / `gpt-6-luna`), the user's choice in this step.
- `test/cold-agent/README.md` — links to the record and D12, and notes that `run.sh` does not pass `--model` yet.

### Fixed alongside
- none

### Carry forward
- infra · S · `test/cold-agent/run.sh:39` — add `--model` (or `COLD_MODEL`) passthrough so the slice-7 rerun can pin per D12 — why not now: not needed until slice 7, and this step changes no harness code
- bug · S · `nera-cli/src/scaffold.js:10` — `nera new .` refused ("Invalid project name"); every agent scaffolds elsewhere and copies up — why not now: CLI behaviour change, its own issue (finding 2 in the record)
- debt · S · `../generator/src/render.js:8-11` — `dotenv.config()` prints `◇ injected env (0) from .env` on every command, which every agent reads — why not now: different repo (core)

### Verification
```
npx vitest run → Tests  42 passed (42)
npm run lint → eslint . (no output, exit 0)
grep -n "Slice 0\|slice 0" ROADMAP-ai.md → 4–5 (status), 448 (D12), 466 (slice plan item 0 done), 492 (## Slice 0 — baseline record (2026-10-10))
```
Facts checked against today's code: `.md`→`.html` href (`generator/src/core.js:227-230`, no pretty URLs); page without layout skipped (`render.js:479`); body passed as `content` (`render.js:487-498`); scaffold `main !{ content }` (`template/theme/views/pages/default.pug`); `nera validate` has `layout-missing`/`layout-unresolved` (`nera-validate/index.js:142-161`); `nera build --check` (`src/commands/build.js:11`); serve default port 3000 (`src/commands/serve.js:9`); contact-form is mailto, template via `npx nera-contact-form` → `theme/views/vendor/plugin-contact-form/` (its README:207-226, `package.json` bin); `HTML created` at `render.js:515`.

### Self-critique
- Dropped two step-2 log findings that rest only on the discarded Claude run 1 (it "knew canonical-links/`app_origin`", "read more docs pages"): run 1 is not committed, so they are untraceable. Kept only what `meta.md` records from it (`nera new .`).
- Dropped "`nera --version` is not a command": true (no case in `bin/nera.js`), but no agent tried it in a committed transcript.
- Finding 6's "`nera validate` would have reported `layout-unresolved`" is a claim about the validator, checked in code, not observed in the run. It is worded as "would have".
- The "Getting online" AGENTS input ("say `public/` is the folder to deploy") is a derived recommendation, not an observation. It is tied to the L1 command-consistency test, which forbids naming `nera publish` before slice 6.
- The record is about 120 lines. I kept quotes to a few words and pointed to transcripts, but the reviewer may judge it too long.

### Pressure-test questions for the reviewer
1. Spot-check the line citations (e.g. claude:185 `ugrep: warning`, codex:337 ENOENT, codex:390 `a11y-main`, codex:460–468 raw HTML): does each point at what the record says?
2. Is "Codex's `mailto:` form is close to what the plugin does" fair, or does it understate the finding (no config, no honeypot, no obfuscation)?
3. Does any AGENTS.md input overstate core, especially "a page without `layout` is skipped silently" now that `nera validate` warns?
4. Should the "not agent errors" items (dotenv banner, `HTML created: /`, glob warning) live in the record at all, or only as carry-forwards?

## Step 4 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- `ROADMAP-ai.md` finding 4 — "Codex's `mailto:` form is close to what the plugin does" → "uses the plugin's mechanism, but without its YAML field config, honeypot or recipient obfuscation" (plugin README:8, 28, 56) — `npx vitest run && npm run lint` → 42 passed, lint clean
- `ROADMAP-ai.md` finding 6 — "a second `<main>` in the layout next to the one in `pages/default.pug`" put the extra `<main>` in the layout, which no committed line shows; now "two `<main>` per page … fixed by editing both the layout and `pages/default.pug`" (codex:390, 396) — same verify → pass
- `ROADMAP-ai.md` AGENTS input "Layouts" — "skipped silently" → "not rendered, and the build says nothing; `nera validate` warns (`layout-missing`)" (`nera-validate/index.js:142-151`) — same verify → pass
- `ROADMAP-ai.md` AGENTS input "plugin" — "installed and configured in `config/<name>.yaml`" implied config is required; now "installed; most read optional settings from `config/<name>.yaml`" (getConfig returns `{}` when the file is missing) — same verify → pass
  (4 edits, ~10 lines, 1 file)

### Fixed alongside
- none

### Carry forward
- none (the implementer's three carry-forwards stand: `run.sh` `--model`, `nera new .`, core dotenv banner)

### Checked
goal (table, 7 missteps, AGENTS inputs, status "Next: slice 1", item 0 done, README link) · `npx vitest run` 42 passed, `npm run lint` clean, grep shows lines 4–5, 448, 466, 492 · Non-negotiables (D12 written back to Decisions; no publish/push; no version bump needed, docs/test-only) · Tests & hygiene · every claude:N / codex:N citation opened (claude:30–45, 54, 59–60, 108, 119, 130–135, 164, 171–176, 185, 189–196, 235–249; codex:18–123, 168–179, 233, 273, 303, 336–337, 359–362, 385–390, 396, 428, 460–468, 509) plus both `meta.md` and `evaluation.txt` · core facts (`core.js:227-230`, `render.js:8-11, 479, 515`, `scaffold.js:21`, dev/serve port 3000, template `main !{ content }`, contact-form bin + README:207-226) · scope: only the step's files plus the issue log/plan/marker · walkthrough n/a

### Answers to the pressure-test questions
1. Yes. claude:185 is `ugrep: warning: public/oeffnungszeiten/index.html: No such file`; codex:337 is `ENOENT … ./theme/views/pages/default.pug`; codex:390 is the `a11y-main` warning; codex:460–468 are raw `<section>` pages. Only imprecision: finding 6 attributed the extra `<main>` to the layout — fixed in review.
2. It understated it: same mechanism, but no YAML fields, honeypot, obfuscation or i18n. Reworded (above).
3. "Skipped silently" was true of the build but misleading next to `nera validate`'s `layout-missing` warning (whose own message says "the build skips it silently"). Reworded to name both. "Configured in `config/<name>.yaml`" also overstated; fixed. The other inputs (`.md`→`.html`, `content`, port 3000, `npx nera-contact-form` destination) check out against the code.
4. Keep them. It is one short paragraph of sourced observations that every agent read, and slice 7 diffs against it; the carry-forwards cover the fixes. It does not turn the record into a second spec.

## Step 4 — approved (2026-10-10)

snagio: ticked
commit: abab0e2

## Browser test (2026-10-10)

- **Result:** SKIPPED — no browser surface (CLI test harness + ROADMAP notes)

## Triage (2026-10-10)

| # | item | from | disposition | why |
|---|---|---|---|---|
| 1 | infra · `test/cold-agent/run.sh:41-48` — copied `~/.codex/auth.json` shares a rotating refresh token with the real Codex login | Step 1 — reviewed | fix | default: a persistent dedicated `CODEX_HOME` (`COLD_CODEX_HOME`, logged in once with `codex login`) or `OPENAI_API_KEY`; never copy the real login |
| 2 | infra · `test/cold-agent/lib.sh:30-37` — `out/` and scratch are siblings of `site/` in one root, visible to the agent | Step 2 — reviewed | fix | separate mktemp for `site/`; small harness change |
| 3 | infra · `test/cold-agent/run.sh:39` — no `--model` pin for slice-7 comparability | Step 2 — reviewed + Step 4 — implemented | fix | default: `COLD_MODEL` passthrough, unset = CLI default (cold = what a user gets) |
| 4 | bug · `src/scaffold.js:10` — `nera new .` refused with "Invalid project name"; every agent scaffolded elsewhere and copied up | Step 4 — implemented | fix | default: `nera new .` scaffolds into the current folder when it is empty (dotfiles like `.git` allowed), package name from the folder's basename; minor release |
| 5 | bug · `../generator/src/render.js:515` — `HTML created: ${meta.dirname}` logs `/` for every root page | Step 3 — implemented | fix | one-line fix + test in core; patch release (tag needs your go) |
| 6 | debt · `../generator/src/render.js:11` — `dotenv.config()` prints `◇ injected env (0) from .env` on every command | Step 4 — implemented | fix | `dotenv.config({ quiet: true })`, same core step and patch as #5 |

Already done / elsewhere: 2 fixed by later steps (Claude token passthrough in `run.sh:35-36`; Codex branch in `trim.sh:85-114`).
Planning signal: the plan treated the baseline as record-only and did not reserve steps for fixing what the record itself found in the CLI and core.

## Step 5 — started (2026-10-10)

base_sha: abab0e2e86e48ca4516675ef6f03e231346bb9ad
mode: fresh

## Step 5 — implemented (2026-10-10)

base_sha: abab0e2

### Changed
- `test/cold-agent/lib.sh` — new `cold_mktemp` (mktemp + `pwd -P` + workspace refusal, every step status-checked); `cold_make_root` now creates the site as its own `nera-cold-site.XXXXXX` temp folder, so `..` from the site is `$TMPDIR`, not the run root holding `out/` and `home/`. If the second mktemp fails, the run root is removed.
- `test/cold-agent/run.sh` — Codex no longer copies `~/.codex/auth.json`. It uses a persistent `COLD_CODEX_HOME` (default `~/.cache/nera-cold-agent/codex`). `prepare_codex_home` refuses a path in the real `~/.codex` (checked textually before `mkdir` and again resolved, so it catches symlinks) or in the workspace, refuses one holding `AGENTS.md`/`AGENTS.override.md`, and stops with `CODEX_HOME=<dir> codex login` when there is no `auth.json` and no `OPENAI_API_KEY`. The `cleanup` trap is gone. `COLD_MODEL` is passed as `--model` (claude) / `-m` (codex) and recorded in `meta.txt`. `prepare_agent` now runs before `cold_make_root`, so a missing login creates no temp folders. `--check-isolation` removes both folders through an EXIT trap, prints the site path and gains the check "site folder is not inside the run root" (also `! -e ../out`, `! -e ../home`). The agent env is reset for the isolation checks and added back for the login ping.
- `test/cold-agent/evaluate.sh` — the trap removes both folders; the `rmdir "$COLD_SITE"` before rsync is gone (it is unneeded, since rsync fills the existing empty folder).
- `test/cold-agent/trim.sh` — reads `site:` from `out/meta.txt` and maps it to `<site>` (also the `/private`-less form), and names `<site>` in the header only when it applies. A legacy `<root>/site` is left to the `<root>` rule, so the committed baselines regenerate byte-identically.
- `test/cold-agent/README.md` — `COLD_MODEL` replaces "run.sh does not pass --model yet". Also updated: the run/evaluate commands (`evaluate.sh <site folder>`), the new folder layout, the isolation bullet about the folders, and the Codex login section (the dedicated `CODEX_HOME`, the one-time login command, what is refused).

### Fixed alongside
- none. The `cold_mktemp` hazard found in self-review was in code new to this step, so it is not alongside: a failed `mktemp` gave `cd ""` → current dir → the workspace guard → `rm -rf`. Each step is now status-checked, and the workspace case uses `rmdir`. Proven with `TMPDIR=/nonexistent-cold` and `TMPDIR=<workspace>/.tmp-cold`: both exit 1 and delete nothing.

### Carry forward
- none

### Verification
```
bash -n test/cold-agent/{evaluate,lib,run,trim}.sh → all ok
shellcheck → not installed
bash test/cold-agent/run.sh --check-isolation → "ok    site folder is not inside the run root" … "isolation: ok"; prints run root …/nera-cold-agent.VjBdED and site …/nera-cold-site.J3bbg3 (outside it); afterwards no nera-cold-site.* left in $TMPDIR
grep -n 'auth.json' test/cold-agent/*.sh → run.sh:59 only, the existence test in prepare_codex_home (no copy)
env -u OPENAI_API_KEY COLD_CODEX_HOME=<empty dir> run.sh --check-isolation codex → "codex is not logged in for cold runs; log in once with:  CODEX_HOME=<dir> codex login  or export OPENAI_API_KEY", exit 1, no temp folders created
COLD_CODEX_HOME=~/.codex/cold-test → refused, exit 1, ~/.codex/cold-test not created; COLD_CODEX_HOME=<workspace>/tmp-codex → refused, not created
stub claude/codex on PATH, COLD_MODEL=m-test → args "… --max-turns 60 --model m-test …" and "exec … -m m-test …"; without COLD_MODEL no --model
trim.sh on the two committed baseline run roots (2CYcsl claude, AlmWdg codex) → byte-identical to the committed transcript.md
npx vitest run → Tests  42 passed (42)
npm run lint → clean
```

### Self-critique
- Considered a `<root>/site` symlink to keep the old README workflow. Rejected: it adds a path the README would have to explain, and `meta.txt`/stderr already name the site.
- The site's parent is still `$TMPDIR`, so a determined agent could `ls ../nera-cold-agent.*/out`. The goal ("not reachable as siblings") is met, but the run root is not hidden. Hiding it would need the run root outside `$TMPDIR`.
- The dedicated `CODEX_HOME` persists `sessions/`/`history.jsonl` across cold runs. As far as I know `codex exec` does not load them as context, but I have not verified it. Only `AGENTS*.md` is refused, and `config.toml` (MCP servers) is not checked.
- I did not run the real `--check-isolation claude`/`codex` against live logins (cost, and there is no Codex login in the new home yet). The ping path was proven with stubs only.
- `codex_home_allowed` matches by prefix, so `COLD_CODEX_HOME=~/.codex` itself is refused through the trailing `/` in `"$1/"`. Confirmed only by reading, not by a run.

### Pressure-test questions for the reviewer
1. Does any path still read or write the real `~/.codex`? Check `prepare_codex_home`'s order: the textual check before `mkdir`, the resolved one after.
2. `cold_mktemp` runs in `$(...)` without errexit. Is every failure path explicit, and can nothing reach `rm -rf` with an empty or unexpected path? (`cold_make_root` only `rm -rf`s a `COLD_ROOT` that mktemp returned.)
3. In `check_isolation`, `COLD_EXTRA_ENV=()` after the early `prepare_agent`. Is it certain that `OPENAI_API_KEY`/`CODEX_HOME` cannot reach the "no token variables" check?
4. Should `config.toml` with `[mcp_servers]` in the dedicated `CODEX_HOME` also be refused?

## Step 5 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- `test/cold-agent/run.sh:47-51` — `prepare_codex_home` runs left of `||`, so `set -e` does not reach it: a failed `mkdir` (unwritable parent) left `COLD_CODEX_HOME=""`, which passed `codex_home_allowed` and, with `OPENAI_API_KEY` set, went on as `CODEX_HOME=` (without it: the misleading hint `CODEX_HOME= codex login`). `mkdir`/`chmod`/`cd` now `|| return 1`, with a comment — +4/−3 lines — `OPENAI_API_KEY=fake COLD_CODEX_HOME=<ro dir>/x run.sh --check-isolation codex` → before: `COLD_CODEX_HOME=` traced, run root created; after: `mkdir: … Permission denied`, exit 1, temp folder count 4 → 4
- `test/cold-agent/trim.sh:23` — regression from this step: under `set -euo pipefail` the new `site=$(sed … meta.txt 2> /dev/null | head …)` exits 1 with no message when `out/meta.txt` is missing (the old trim.sh exited 0 on the same run root). Added `|| true` — +1/−1 line — `trim.sh <root without meta.txt>` → before exit 1, after exit 0; both committed baselines still regenerate byte-identically (`cmp` → identical claude, identical codex)

### Carry forward
- design · S · `test/cold-agent/run.sh:56` — the dedicated `CODEX_HOME` is checked for `AGENTS*.md` only; a `config.toml` with `[mcp_servers]`/`instructions` and persisted `sessions/`/`history.jsonl` are not checked or cleared between cold runs — needs a decision (refuse `config.toml`, or wipe everything but `auth.json` per run)

### Checked
goal (1)–(3) against the diff · `bash -n` all four scripts ok · shellcheck not installed · `run.sh --check-isolation` → all 13 ok incl. "site folder is not inside the run root", "isolation: ok", site `…/nera-cold-site.1UDdA0` beside run root `…/nera-cold-agent.qcgfmq`, no `nera-cold-site.*` left · `grep auth.json` → run.sh:59 existence test only · empty `COLD_CODEX_HOME` + no key → login instruction, exit 1, no temp folders · `COLD_CODEX_HOME` = `~/.codex`, `~/.codex/cold-x`, `<workspace>/tmp-codex`, relative `tmp-codex` → all refused, nothing created · trim byte-identity on both baselines · `npx vitest run` → 42 passed · `npm run lint` clean · conventions: Non-negotiables, Framework correctness, Tests & hygiene (no package code touched, nothing ships: folder not in `files`) · scope: only the step's files · README/evaluate no longer assume `<root>/site` (only historical transcripts mention it) · walkthrough n/a

### Answers to the pressure-test questions
1. No. The only real-`~/.codex` access is `cd ~/.codex && pwd -P` in `codex_home_allowed` (a read of its resolved path). The textual check precedes `mkdir`; verified `~/.codex` itself and `~/.codex/cold-x` are refused and `~/.codex/cold-x` is not created. Residual: a path that is a symlink *into* `~/.codex` passes the textual check, so `mkdir -p` could create an empty folder there before the resolved check refuses it — needs a deliberately crafted symlink, not worth more code.
2. `cold_mktemp`: yes, every step is `|| return 1`, the workspace case uses `rmdir`; `cold_make_root` only `rm -rf`s a `COLD_ROOT` that `cold_mktemp` returned successfully. The same errexit hole did exist in `prepare_codex_home` (left of `||`) — fixed alongside above.
3. Yes. `cold_exec` passes only `cold_env` plus `COLD_EXTRA_ENV` under `env -i` (lib.sh:137); `COLD_EXTRA_ENV=()` runs right after the early `prepare_agent` and is refilled only by the second `prepare_agent` after all isolation checks. The run printed "ok no token variables in the environment".
4. Probably yes, but it is a decision (refuse vs. wipe per run, and whether `codex login` itself writes a `config.toml`) — carried forward.

## Step 5 — approved (2026-10-10)

snagio: ticked
commit: e662987

## Step 6 — started (2026-10-10)

base_sha: e6629878b14722fb3c1ac14203e888767095e5fc
mode: fresh

## Step 6 — implemented (2026-10-10)

base_sha: e6629878b14722fb3c1ac14203e888767095e5fc

### Changed
- `src/scaffold.js` — `nera new .`/`./` scaffold in place: `isCurrentDir`, `projectNameFromDir` (basename → accents dropped, lower-case, runs of invalid chars → `-`, leading `._-` and trailing `-` stripped, `nera-site` if empty, result re-checked by `validateProjectName`), `assertEmptyDir` (dotfiles ignored, throws before any write), `copyDir` keeps an existing file and logs `• Kept your existing .gitignore`, "Next steps" drop `cd` in place, empty-name error mentions `nera new .`
- `bin/nera.js` — usage line `nera new .`
- `test/scaffold.test.js` — 8 in-place tests (empty folder + name, `./`, `.git` only, kept `.gitignore` + one log line, non-empty refused and untouched, bad theme writes nothing, `My Site` → `my-site`, `..`/`../`/`.//`/absolute still rejected) + 6 `projectNameFromDir` cases
- `README.md` — Quick start paragraph + command table mention `nera new .`
- `CHANGELOG.md`, `package.json`, `package-lock.json` — 1.5.0 (minor, `npm version minor --no-git-tag-version`)

### Fixed alongside
- none

### Carry forward
- debt · S · `src/scaffold.js` "Next steps" — says `nera dev`, which only works with a global `nera`; `npm run dev` (what the README Quick start shows) would work in every site — pre-existing, outside this step's goal
- debt · S · `src/scaffold.js` — with `--no-install` the "Next steps" omit `npm install` — pre-existing

### Verification
```
npx vitest run test/scaffold.test.js → Tests  33 passed (33)
npx vitest run → Test Files  6 passed (6) / Tests  56 passed (56)
npm run lint → exit 0
node bin/nera.js new . --no-install   (in "My Bakery" with .git/ and .gitignore) → "• Kept your existing .gitignore", "✓ Configured project as "my-bakery"", Next steps: "nera dev" only, exit=0
same command again → "❌ The current folder is not empty (config, package.json, pages, …). Run `nera new .` in an empty folder, or `nera new <name>` to create a new one." exit=1
```

### Self-critique
- Accent folding (NFKD + strip combining marks) goes slightly beyond "same rule as validateProjectName"; added because a German folder name (`Bäckerei`) would otherwise become `b-ckerei`. Non-Latin names (e.g. CJK) fold to `nera-site`.
- The "keep existing file" branch in `copyDir` is unconditional, not gated on in-place mode. In `nera new <name>` the target is fresh so it cannot trigger; gating it would add a flag for no behaviour change.
- Theme spec is validated before the empty check; both happen before any write — order between them does not matter.
- Least sure: whether the fallback `nera-site` should instead be an error asking for `nera new <name>`.

### Pressure-test questions for the reviewer
1. Can any input other than `.`/`./` reach the in-place branch, or any in-place path write before `assertEmptyDir`?
2. Is a dotfile *directory* in the template (none today) able to merge into an existing one silently? (copyDir recurses with `mkdir -p` — only files are guarded.)
3. Is `projectNameFromDir` output always npm-valid (lower-case, ≤ 214 chars not enforced)?

## Step 6 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- debt · S · `ROADMAP-ai.md:523` — finding 2 still reads as open; record under slice 0 that nera 1.5.0 ships `nera new .` (dotfiles ignored, existing `.gitignore` kept, name from the folder, `nera-site` fallback) per the "decisions go back into the ROADMAP" non-negotiable — why not now: outside the step's file list, belongs to the issue's reconcile
- debt · S · `src/scaffold.js:41` — `projectNameFromDir` does not cap at npm's 214 chars nor avoid npm's reserved names (`node_modules`, `favicon.ico`); `ß` folds to `-` (`Straße` → `stra-e`) — why not now: negligible in practice, needs a decision on the fallback

### Checked
Goal met (in place for `.`/`./`, dotfiles ignored, non-empty refused before writes, basename-derived name, no `cd`, usage + README + CHANGELOG 1.5.0 via npm version) · `npx vitest run` → 6 files / 56 tests passed · `npm run lint` → exit 0 · smoke: `nera new . --no-install` in a folder with only `.DS_Store` → exit 0, Next steps `nera dev` only; `nera new ""` → exit 1 with the new usage hint · Non-negotiables, Framework correctness, Tests & hygiene: no new dependency, no process.exit outside bin, temp-dir tests, no prompts · self-critique claims verified (accent folding, unconditional keep-branch harmless for fresh targets, theme check + empty check both precede the first write) · walkthrough n/a

### Answers to the pressure-test questions
1. No. `isCurrentDir` is a two-entry Set (`.`, `./`); every other string goes through `validateProjectName`, whose regex requires a leading alphanumeric, so `..`, `../`, `.//` and absolute paths throw (pinned by the "still rejects" test, which also asserts `workdir` stays empty). In place, the order is `validateThemeSpec` → `assertEmptyDir` → `projectNameFromDir` → `copyDir`; the first write is `copyDir`'s `mkdir`/`copyFile`. `projectNameFromDir` cannot throw after the check: its output is `[a-z0-9][a-z0-9._-]*` or `nera-site`, both of which pass `validateProjectName`.
2. Yes in principle: `copyDir` merges into an existing directory with `mkdir -p`, but each file inside is still guarded by the `existsSync` keep-branch, so nothing is overwritten. The template has no dotfile directory today (`ls -a template` → `_gitignore config package.json pages theme`), so it cannot happen now.
3. Lower-case, URL-safe, no leading `.`/`_`: yes, by construction. Not enforced: the 214-char limit and npm's reserved names (carried forward above); both need an unusual folder name.

## Step 6 — approved (2026-10-10)

snagio: ticked
commit: 8a7e5e3

## Step 7 — started (2026-10-10)

base_sha: 8a7e5e322d0051096eadd2a0e55e74fe467de538
generator_base_sha: 4d9724ed570928a8c200d9e55026eca9f8a3ddb2
mode: fresh

## Step 7 — implemented (2026-10-10)

base_sha: 8a7e5e3 (nera-cli, untouched by this step) · generator_base_sha: 4d9724e — **the diff lives in `../generator`**: review with `git -C ../generator diff 4d9724e`

### Changed
- `../generator/src/render.js` — `dotenv.config({ quiet: true })`: no `◇ injected env` banner, `.env` still populates `process.env` (an explicit `quiet` option overrides `DOTENV_QUIET` in dotenv 18)
- `../generator/src/render.js` — `HTML created:` logs `/` + `path.relative(publicFolder, htmlPath)` with forward slashes, i.e. the file actually written, never `base_path`-prefixed (was `meta.dirname`, so `/` for every root page)
- `../generator/src/test/render.test.js` — two tests: log lines for `/index.html`, `/about.html`, `/de/index.html` under `basePath: '/repo'`; a child-process import of `render.js` in a temp dir with `.env` → value loaded, no `injected env` on stdout/stderr. Both fail on the old `render.js` (checked by stashing it)
- `../generator/CHANGELOG.md` — `[4.15.1]` with two `### Fixed` entries
- `../generator/package.json`, `package-lock.json` — 4.15.0 → 4.15.1 via `npm version patch --no-git-tag-version`

### Fixed alongside
- none

### Carry forward
- debt · S · `../generator/src/watch-assets.js:7` — still calls `dotenv.config()` without `quiet` — dev-only script, not in the package `files`, so no user sees it (unrelated)
- design · S · `ROADMAP-ai.md:556–561` — the slice-0 note still says the banner/`HTML created: /` come from core; it is a dated record "true of core 4.15.0", so I left it; a "fixed in core 4.15.1" note could follow once the release is out (decision)

### Verification
```
Risk grep (`HTML created`, `dotenv`) over ../generator, nera-cli, nera-validate → only render.js, CHANGELOG history and ROADMAP-ai.md prose; no test or tool parses the line
npx vitest run (generator) → Test Files  9 passed (9) / Tests  140 passed (140)
npm run lint (generator) → eslint . — no output (0 problems)
npm run render (generator demo, 1 page) → HTML created: /index.html (no banner)
nera-website copy in scratchpad, installed core 4.15.0 with the new render.js → 105 "HTML created" lines, 0 duplicates, 0 "injected env", every logged path exists under public/ (e.g. /about.html, /de/docs/cli.html, /de/tutorials/tags/advanced.html)
```

### Self-critique
- Derived the log path from `htmlPath` rather than `meta.fullPath`/`href`, so it shows what was really written even if a plugin rewrites `dirname`/`filename` inconsistently with `href`.
- Tests live in `src/test/render.test.js` (where core's tests are), not `test/` as the plan's Files line said — there is no top-level `test/` in core.
- The dotenv test spawns a child process (~250 ms) because `dotenv.config()` runs once at module import; `vi.resetModules` + dynamic import would also work but depends on cwd inside the worker. Least sure whether a reviewer prefers that cheaper variant.
- Patch is right: only log text changes; no hook, config, `app`/`meta` key or markup changes. Tagging/release v4.15.1 needs the user's go (not done).

### Pressure-test questions for the reviewer
1. Does any consumer (nera-cli `--json` work, CI logs, the cold-agent harness evaluation) match on `HTML created: /` literally? My grep found none.
2. With a theme, is `htmlPath` still always under `publicFolder` (no `../` in the relative path)? `dirname` is stripped of leading slashes before the join, so yes, unless a page's `dirname` itself contains `..`.
3. Should the child-process test assert on `stderr` only? I check both streams since dotenv 17 printed to stdout and 18 to stderr.

## Step 7 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- none (the implementer's two carry-forwards — `watch-assets.js:7` dotenv without `quiet`, and the ROADMAP-ai slice-0 "fixed in core 4.15.1" note once released — stand as logged; not re-logged)

### Checked
Goal: diff in `../generator` vs `4d9724e` (render.js, render.test.js, CHANGELOG, package.json/lock 4.15.0 → 4.15.1) makes both triage items true · Verify: `npx vitest run` → 9 files / 140 tests passed; `npm run lint` → clean; `npm run render` → `HTML created: /index.html`, no `injected env` banner · Non-negotiables: patch + CHANGELOG in the same change, Keep a Changelog `### Fixed` with four-space bullets, bumped via `npm version` (lock `version` fields in sync), nothing tagged/pushed · Tests & hygiene: new behaviour pinned in core's own test dir (`src/test/`, there is no top-level `test/` in core — plan's Files line was approximate) · Scope: nera-cli diff is plan/log bookkeeping only; generator diff stays in the step's files · Self-critique claims verified (see answers).

### Answers to the pressure-test questions
1. No consumer matches the text. `grep -rn "HTML created"` over nera-cli, nera-validate, generator (excl. node_modules/.git) → only render.js, the new test, CHANGELOG, `ROADMAP-ai.md:559` (dated prose) and the frozen baseline transcripts under `test/cold-agent/2026-10-10-baseline/` — historical records, no harness script or evaluator parses the line.
2. Yes. `htmlPath = path.join(publicFolder, meta.dirname.replace(/^\/+/, ''), meta.filename)` (render.js:503–507); themes only change view resolution, not this join, so `path.relative(publicFolder, htmlPath)` is always the in-`public/` path. A `..` in `dirname` would escape `public/` for the *write* itself — pre-existing, and the log would then truthfully show it. Not this step's concern. `basePath` is applied only to the HTML content (`rewriteHtmlUrls`), never to `htmlPath`; the test pins this with `basePath: '/repo'`.
3. Both streams is right. dotenv 18.0.4 (installed) prints the banner via `console.error` (stderr), and checks `Object.prototype.hasOwnProperty.call(e, "quiet") ? e.quiet : env.quiet` — so the explicit `quiet: true` wins over `DOTENV_QUIET`, and population (`E.populate(n, l, e)`) runs before and independently of the quiet check, so `.env` values still load (the child-process test proves `NERA_DOTENV_PROBE=loaded`). Checking stdout too guards against a dotenv downgrade to 17 (stdout); cheap, keep it. The child-process variant is the more reliable choice since `dotenv.config()` runs at import time with `process.cwd()`.

## Step 7 — approved (2026-10-10)

snagio: ticked
generator commit: d44caaf
commit: 9cb257d

## Decision (2026-10-10)

- Resolved as 1.5.0 without fixing the four small post-triage carry-forwards: (a) `run.sh:56` CODEX_HOME check covers only `AGENTS*.md`; (b) scaffold "Next steps" `nera dev` vs `npm run dev`, no `npm install` hint with `--no-install`; (c) `projectNameFromDir` no 214-char cap / reserved names / `ß`; (d) `generator/src/watch-assets.js:7` dotenv without `quiet` (dev-only). The user chose "resolve now" when offered.

## Decision (2026-10-10)

- Overrules the previous Decision: all four items (a)–(d) were fixed after all and released — nera 1.5.1 (`edb1fb7`, `776fa2a`), core `147b00a` (dev-only, no release).
