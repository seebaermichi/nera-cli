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
