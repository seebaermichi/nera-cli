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
