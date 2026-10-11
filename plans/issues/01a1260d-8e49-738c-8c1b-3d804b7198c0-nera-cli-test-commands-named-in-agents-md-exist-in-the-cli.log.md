# Work log — 01a1260d-8e49-738c-8c1b-3d804b7198c0-nera-cli-test-commands-named-in-agents-md-exist-in-the-cli

- **Issue:** `01a1260d-8e49-738c-8c1b-3d804b7198c0`

## Issue snapshot (2026-10-11)

- **Id:** `01a1260d-8e49-738c-8c1b-3d804b7198c0`
- **Type:** improvement
- **Group:** S1 Agent instructions
- **Status:** in_progress
- **Title:** [nera-cli] Test: commands named in AGENTS.md exist in the CLI usage

Spec: `nera-cli/ROADMAP-ai.md` — L1.

A vitest that extracts every `nera <command>` from `template/AGENTS.md` and asserts it appears in the usage text of `bin/nera.js`.

## Decision (2026-10-11)

**D1 — Read the usage by running `node bin/nera.js` with no arguments.** Alternative: move the `usage` const into `src/usage.js` and import it from bin and test. Lost because it changes production code for a test, and an in-process import checks a string, not what the binary prints. Cost: one child process (~100 ms); the no-command path exits 0 and imports no heavy deps.

**D2 — Extract `nera <command>` plus a directly following `--flag` from the whole file, case-sensitive.** Restricting to code spans would miss prose mentions such as "`nera validate` names the file…" only if formatting changed; whole-file is simpler and catches the marker comment's `nera update` too. Flags are included because `nera build --check` is the instruction agents follow; dropping `--check` from the CLI would otherwise stay green. `npx nera-<plugin>` binaries are plugin bins, not CLI commands, and are excluded by requiring a space. `npm run dev`/`build` vs. the template's `package.json` scripts is the same kind of drift but outside this issue — carry-forward candidate.

**D3 — Non-vacuous by construction.** A regex that matches nothing passes trivially; the test asserts the known command set is found and that a fixture naming `nera publish` is reported missing.

**D4 — No release.** `package.json` `files` is `bin`, `src`, `template`; `test/` never reaches consumers, so a version bump would publish an identical tarball. Workspace CLAUDE.md lists test-only changes under patch, but its "no release at all" rule (nothing consumers receive) is the one that fits.

## Carry forward (2026-10-11)

- debt · S · nera-cli/test — assert the `npm run <script>` names in `template/AGENTS.md` exist in `template/package.json` scripts — same drift class, outside this issue's scope

## Step 1 — started (2026-10-11)

base_sha: c31931be06cd5f74d6a7c3e9f4cc7fdbade765c8
mode: fresh

## Step 1 — implemented (2026-10-11)

base_sha: c31931b

### Changed
- `test/agents-commands.test.js` — new: runs `node bin/nera.js` (path from `import.meta.url`, cwd `os.tmpdir()`), extracts `nera <command>` [+ `--flag`] from `template/AGENTS.md` via `templateDir()`, asserts each command is a `  nera <command>` usage line and each flag occurs in the usage; helper tests for the regex (positive and negative cases) and a `nera publish` / `nera build --watch` fixture reported missing.

### Fixed alongside
- none

### Carry forward
- none

### Verification
```
npx vitest run → Test Files  8 passed (8) / Tests  99 passed (99)
npm run lint → eslint . (no output, exit 0)
npx eslint test/agents-commands.test.js → exit 0
```
The 6 new tests, verbose: all ✓ (extractCommands ×3, findMissing ×2, template AGENTS.md ×1).

### Self-critique
- Helpers live in the test file, not `src/`: D1/D4 say no production change, and nothing else uses them.
- Regex `(?<![\w.-])nera ([a-z][a-z-]*)(?: (--[a-z][a-z-]*))?`: the lookbehind rejects `nera.js.org` and `-nera`, and the required space rejects `nera-navigation` and `pkill -f nera` (followed by a backtick). Command and flag are limited to `[a-z-]`, so building `RegExp` from them cannot inject metacharacters.
- Flags are checked anywhere in the usage, not per command line (as the step goal says). So a flag listed only under another command would pass. That is acceptable today, but looser than it could be.
- Ran the CLI from `os.tmpdir()` so the repo's `.env` (dotenv prints "injected env") does not leak in. The usage text is the same either way.

### Pressure-test questions for the reviewer
1. Does the extraction catch every command form in the template, e.g. the marker comment's `nera update` and `npx nera check` inside parentheses? (The third extractCommands test asserts validate/build/check/update.)
2. Should a flag be tied to its command's usage line rather than to the whole usage text?

## Step 1 — reviewed (2026-10-11)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- `test/agents-commands.test.js:31-41` — `findMissing` now ties a flag to its own command's usage line(s) (any of them, so `nera new`'s two lines both count) instead of the whole usage text; new test "reports a flag listed only under another command" (`nera build --migrate` reported, `nera update --migrate` accepted). +9/−4 lines — `npx vitest run && npm run lint` → 8 files / 100 tests passed, eslint exit 0

### Fixed alongside
- none

### Carry forward
- none

### Checked
goal (extraction from `template/AGENTS.md` via `templateDir()`, usage from `node bin/nera.js` resolved by `import.meta.url`, cwd `os.tmpdir()`; `nera publish` fixture reported; validate/build/check/update asserted) · `npx vitest run` → 99 then 100 passed, `npm run lint` → exit 0 · Non-negotiables (no release per D4, no push), Framework correctness (ESM, eslint style, no production change per D1), Tests & hygiene (vitest from root, no network) · self-critique: lookbehind/space claims verified against the template text (`nera.js.org`, `npx nera-contact-form`, `npx nera-navigation`, `pkill -f nera`, `--force` all unmatched); `[a-z-]` captures cannot inject regex metacharacters · scope: diff is the test file plus the issue's plan/log only · walkthrough n/a (none)

### Answers to the pressure-test questions
1. Yes. Template forms: `npx nera validate` (×2), `npx nera build --check` (×2, flag captured), `npx nera check` inside parentheses (the `(` precedes `npx`, the space before `nera` passes the lookbehind), `` `nera validate` names… `` and the marker comment's `` `nera update` keeps it `` (backtick before `nera` is not `[\w.-]`). The third extractCommands test pins all four names; the first pins the `--check` flag and the `nera update` marker form.
2. Yes — done in review (see Fixed in review). Today every AGENTS.md flag (`--check`) sits on its command's line (`nera build … (--check …)`), so the template test still passes; the stricter check stops a future `nera build --migrate` from passing because `--migrate` is listed under `nera update`.

## Step 1 — approved (2026-10-11)

snagio: ticked
commit: d50221c

## Step 2 — started (2026-10-11)

base_sha: d50221c25f3f1ef7acce6cdaa77b803c5448c766
mode: fresh

## Step 2 — implemented (2026-10-11)

base_sha: d50221c

### Changed
- `ROADMAP-ai.md` status header — slice 1 done 2026-10-11 (scaffold 1.6.0, update 1.7.0, consistency test), "Next is slice 2"; the "still open" clause removed
- `ROADMAP-ai.md` L1 section — names `test/agents-commands.test.js` and that a `--flag` written right after the command is checked too
- `ROADMAP-ai.md` "Slice plan" item 1 — "consistency test done 2026-10-11 (test-only, no release). Slice 1 is complete"
- `ROADMAP-ai.md` "Slice 1 — progress" — "Still open" paragraph replaced by a "Done 2026-10-11 (no release)" entry: how the test reads the usage, what it matches, why no release (D4), the two settled points (D2 matching, D3 non-vacuous), and "Slice 1 is complete."

### Fixed alongside
- none

### Carry forward
- debt · S · `../CLAUDE.md` (workspace root, untracked, outside this repo) — its "Nera for AI assistants" paragraph still says "slice 1 under way … the command-consistency test still open" — not this repo's file; update it when the issue is resolved

### Verification
```
grep -n 'still open\|is open\|consistency test' ROADMAP-ai.md → 473, 475, 629, 692 — none calls the test open (473 = item's scope list, 475 = "done", 629 = slice-0 rationale, 692 = "Done" heading)
npx vitest run → Test Files  8 passed (8) / Tests  100 passed (100)
npm run lint → eslint . (no output, exit 0)
```

### Self-critique
- First draft said naming `--json` in AGENTS.md fails the suite; the test only checks a flag written right after `nera <command>`, so the sentence now says `nera validate --json` and states that a detached flag is not checked.
- Line 629 ("`AGENTS.md` cannot name it, because the command-consistency test (L1) would fail") is slice-0 rationale and stays true, so it was left as is.
- "Next is slice 2" in the header follows the slice-plan order; least sure whether the header should name the next slice at all (the previous header did not).

### Pressure-test questions for the reviewer
1. Does any of the four places still read as if slice 1 or the test were open (header, L1, slice-plan item 1, "Slice 1 — progress")?
2. Does every claim in the new "Done" paragraph match `test/agents-commands.test.js` (usage line `  nera <command>`, flag on that command's lines, run from no-arg `bin/nera.js`, `files` = bin/src/template)?

## Step 2 — reviewed (2026-10-11)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- none (the implementer's `../CLAUDE.md` debt entry is already carried in the Step 2 implemented section; not logged again)

### Checked
goal (all four places: header l.5–9, L1 l.144–146, slice-plan item 1 l.472–476, "Slice 1 — progress" l.692–708) · `grep -n 'still open\|is open\|consistency test' ROADMAP-ai.md` → 473, 475, 629, 692, none calls the test open; extra `grep -i 'slice 1\|under way'` → no stale "under way" · `npx vitest run` → 100 passed · `npm run lint` → exit 0, no output · conventions: Non-negotiables (decision written back into ROADMAP "Done" note ✓, no version bump needed: test-only, `files` = bin/src/template ✓), Framework correctness n/a (doc only), Tests & hygiene ✓ · self-critique claims verified (l.629 still true; `--json` wording now matches the adjacent-flag-only check) · scope: ROADMAP-ai.md plus issue bookkeeping files only · walkthrough n/a (none)

### Answers to the pressure-test questions
1. No. Header says "Slice 1 is done (2026-10-11)" + "Next is slice 2"; L1 names the test file with no open wording; item 1 says "consistency test done 2026-10-11 … Slice 1 is complete"; the progress section's "Still open" paragraph is gone and ends "**Slice 1 is complete.**". "Next is slice 2" matches slice-plan item 2 (L2), so naming it is accurate.
2. Yes, every claim matches `test/agents-commands.test.js`: `execFileSync(process.execPath, [CLI])` with no args (cwd = os.tmpdir()); `findMissing` matches `^ {2}nera <command>(?![\w-])` usage lines and checks the flag only on those lines; `COMMAND_PATTERN` is case-sensitive with lookbehind `(?<![\w.-])` (skips `nera.js.org`, `nera-navigation`); flag captured only when written right after the command; non-vacuity tests: `arrayContaining(['validate','build','check','update'])` and the `nera publish` fixture → `['nera publish']`. `package.json` `files` = `['bin','src','template']`, so `test/` is not shipped, no release is owed.

## Step 2 — approved (2026-10-11)

snagio: ticked
commit: 8840ae6

## Browser test (2026-10-11)

- **Result:** SKIPPED — no browser surface (a vitest and roadmap docs only)

## Triage (2026-10-11)

| # | item | from | disposition | why |
|---|---|---|---|---|
| 1 | debt · `test/agents-commands.test.js` — the `npm run <script>` names in `template/AGENTS.md` are not checked against `template/package.json` scripts | Carry forward | fix | same drift class, file this issue added; one test |
| 2 | debt · `../CLAUDE.md` (workspace root, untracked) — "Nera for AI assistants" still says slice 1 under way, consistency test open | Step 2 — implemented | fix | outside the repo: done in reconciliation, no plan step |

Already done / elsewhere: none
Planning signal: the plan checked `nera` commands only, not every command form AGENTS.md names (`npm run` scripts)

## Step 3 — started (2026-10-11)

base_sha: 8840ae68073745f6902cdd2c8935babd8e374e35
mode: fresh

## Step 3 — implemented (2026-10-11)

base_sha: 8840ae6

### Changed
- `test/agents-commands.test.js` — adds `SCRIPT_PATTERN`, `extractScripts` and `findMissingScripts`; reads `template/package.json` via `templateDir()` (module-relative, not cwd); new describes `extractScripts` (backticks + prose, stops before trailing `.`/backtick, keeps `build:css`; ignores `npm install`/`npm test`/`snpm run`; real AGENTS.md contains `dev` and `build`), `findMissingScripts` (fixture `npm run deploy` reported missing; inherited keys like `toString` are not scripts), and a template-level assertion that AGENTS.md names only scripts `package.json` defines. +54 lines, test-only.

### Fixed alongside
- none

### Carry forward
- none

### Verification
```
npx vitest run → Test Files  8 passed (8) / Tests  106 passed (106)
npm run lint → eslint . (no output, exit 0)
real extraction of template/AGENTS.md → [ 'dev', 'build', 'dev', 'build' ]
```

### Self-critique
- Script names end on a word character, so `npm run build.` yields `build`; a script legitimately ending in `-`/`:` would be cut — no such script exists in npm conventions worth supporting.
- `Object.hasOwn` instead of `in`, otherwise `npm run toString` would pass; covered by its own test.
- `npm start`/`npm test` (no `run`) are deliberately out of scope: the step names `npm run <script>` only, and the template AGENTS.md uses none of them.
- Kept the helpers test-local like `extractCommands`; no production code, so D4 (no release) still holds.

### Pressure-test questions for the reviewer
1. Does the regex stop correctly at the backtick in `` `npm run dev` `` and at the period in prose? (asserted in the first `extractScripts` test)
2. Is `templateDir()` a module-relative path so the read is cwd-independent? (same helper the step-1 test uses for AGENTS.md)

## Step 3 — reviewed (2026-10-11)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- none

### Fixed alongside
- none

### Carry forward
- none

### Checked
goal (extractScripts/findMissingScripts + template-level assertion, fixture `npm run deploy` reported missing, real extraction contains dev+build) · `npx vitest run` → 8 files / 106 tests passed; `npm run lint` → exit 0 · Non-negotiables, Framework correctness, Tests & hygiene (test-only, ESM/eslint style, no release per D4, no new dependency) · self-critique: word-char ending verified against regex `(\w(?:[\w:.-]*\w)?)`; `Object.hasOwn` pinned by the `toString` test; `npm start`/`npm test` out of scope and absent from template AGENTS.md (grep: only `npm run dev`/`npm run build`/`npm install`) · scope: only test/agents-commands.test.js plus plan/log bookkeeping · walkthrough n/a (none)

### Answers to the pressure-test questions
1. Yes. The name group must end on `\w`, so a backtick or period cannot be captured; the test `'- `npm run dev` — serve. Then npm run build. Or npm run build:css, and `npm run lint`'` → `['dev','build','build:css','lint']` passes. Lookbehind `(?<![\w.-])` rejects `snpm run x` (asserted).
2. Yes. `templateDir()` (src/scaffold.js:130) resolves from `fileURLToPath(import.meta.url)` of scaffold.js, so the read of `template/package.json` is cwd-independent; template scripts are `{ dev, build, serve }`, covering both names AGENTS.md uses.

## Step 3 — approved (2026-10-11)

snagio: ticked
