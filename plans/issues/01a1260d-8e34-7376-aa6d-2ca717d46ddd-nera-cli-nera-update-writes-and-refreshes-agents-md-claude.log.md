# Work log — 01a1260d-8e34-7376-aa6d-2ca717d46ddd-nera-cli-nera-update-writes-and-refreshes-agents-md-claude

- **Issue:** `01a1260d-8e34-7376-aa6d-2ca717d46ddd`

## Issue snapshot (2026-10-10)

- **Id:** `01a1260d-8e34-7376-aa6d-2ca717d46ddd`
- **Type:** feature
- **Group:** S1 Agent instructions
- **Status:** in_progress
- **Title:** [nera-cli] nera update writes and refreshes AGENTS.md / CLAUDE.md
- **External ref:** roadmap-ai/s1/update

Spec: `nera-cli/ROADMAP-ai.md` — L1, decision D2.

Plain `nera update` creates the files when missing; replaces only the Nera-owned part above the marker; leaves a marker-less `AGENTS.md` alone with a hint. Temp-dir tests for all three cases.

## Decision (2026-10-10)

**D1 — A separate `src/agent-files.js` module.** Inlining the sync in `update.js` was the alternative. It lost because principle 4 wants the CLI, the future `--json` and the MCP tools on one function. It also keeps the splice logic unit-testable without stubbing npm. Cost: one new file.

**D2 — Split on the first line starting with `<!-- nera:site-notes`; the site keeps its own marker line.** Other options were to refresh the marker line from the template too, or to split on the `## Notes for this site` heading. The heading lost because users may reword or translate it (ROADMAP slice 1 note). Refreshing the marker line lost because the line belongs to what the user already has, and keeping it means the user's part comes through byte for byte. Cost: a later reworded marker text does not spread to old sites, which is harmless because only the prefix is the contract.

**D3 — The Nera part comes from the site's installed `@nera-static/nera` template after `npm update`, falling back to the running CLI's template.** Always using the running CLI's template was the alternative. It lost because `nera update` may run from a global or older binary while `npm update` has just installed a newer package, and the ROADMAP says the instructions follow the *installed* version. Cost: one `existsSync` plus a fallback branch. If the installed package predates 1.6.0, the running CLI's text is used.

**D4 — An existing `CLAUDE.md` is never touched.** The alternative was to rewrite it to `@AGENTS.md` when that line is missing. It lost because `CLAUDE.md` has no marker, so it belongs entirely to the user, and the non-negotiable is that `nera update` never overwrites what the user owns.

**D5 — Write only on change.** Writing every time lost because it is noisy in git and in file watchers (`nera dev`), and an idempotent `nera update` reads as "up to date".

**D6 — Sync after a successful `npm update` and after `--migrate`, never on the guidance path or a failed npm run.** A migrated site is thin afterwards and should get the files right away. On a failed update the installed template is in an unknown state.

**D7 — Minor 1.7.0.** The change is additive. What an existing site notices is the new or refreshed Nera-owned text, which D2 in the ROADMAP explicitly promises.

## Step 1 — started (2026-10-10)

base_sha: 1d1a4a12f5257b128e90b56b37720fb5d5a0f6c6
mode: fresh

## Step 1 — implemented (2026-10-10)

base_sha: 1d1a4a1

### Changed
- `src/agent-files.js` — new: `SITE_NOTES_MARKER` + `syncAgentFiles({ cwd, templateDir })` → `[{ file, action }]`; split on the first line starting with the marker (D2), CLAUDE.md only created (D4), writes only on change (D5), template without marker throws before any write
- `test/agent-files.test.js` — new, 9 temp-dir tests: missing → created (both); marker → only the head replaced, notes byte-identical with a user-edited heading; CRLF + no trailing newline; first-marker split with a marker inline in the old head and a second marker line inside a fence in the notes; marker-less → skipped, content and mtime untouched; existing CLAUDE.md → unchanged; second run → unchanged, mtime kept; marker-less template → throws, nothing written; refresh against the real shipped `template/`

### Fixed alongside
- none

### Carry forward
- none

### Verification
```
npx vitest run → Test Files  7 passed (7) / Tests  82 passed (82)
npx vitest run test/agent-files.test.js → Tests  9 passed (9)
npm run lint → eslint . (no output, exit 0)
```

### Self-critique
- Not in the plan: when the site's head (above the marker) uses CRLF, the template's head is converted to CRLF before splicing, so a Windows/autocrlf checkout never ends up with mixed line endings. The user's part is still byte for byte. Rejected the alternative (template head verbatim, always LF) because it would make every `nera update` on such a site produce a mixed-EOL file.
- The marker check on the template runs always, even when AGENTS.md ends up skipped or created — a broken template is a packaging bug and should fail loudly regardless of the site's state.
- Marker match is `startsWith` at offset 0 or after `\n` — a marker preceded by leading spaces does not count (deliberate: strict "line starts with").
- Least sure: a stray marker line *inside* the Nera part of the template (e.g. a fenced example) would cut there — guarded only by the template author; the real-template test would show it as a wrong head only if the expected head were computed differently, which it is not (it uses the same first-occurrence rule).

### Pressure-test questions for the reviewer
1. Is the user part (`siteText.slice(at)`) byte-identical in every case, incl. CRLF and a missing trailing newline — and is the CRLF conversion of the Nera part acceptable, or should it be logged as a decision?
2. Does any read/write path touch the site before the template's marker check throws?
3. `existing CLAUDE.md → unchanged` vs. D5's `skipped` wording — is `unchanged` the right action name for step 2's output?

## Step 1 — reviewed (2026-10-11)

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
Goal (exports `SITE_NOTES_MARKER` + `syncAgentFiles`, created/updated/unchanged/skipped, write-on-change) · `npx vitest run` → 7 files / 82 tests passed · `npm run lint` → exit 0 · conventions Non-negotiables (user part below marker and marker-less AGENTS.md never written), Framework correctness (ESM, no new dependency, no process.exit, pure function returning results for future --json/MCP), Tests & hygiene (temp-dir tests, no network) · scope: only `src/agent-files.js`, `test/agent-files.test.js` + plan/log/active-issue bookkeeping · shipped `template/AGENTS.md` has exactly one marker line (114) and no code fences, so the "marker inside a fence in the Nera part" risk does not apply to the real template · self-critique claims verified against the source · walkthrough n/a (`none`)

### Answers to the pressure-test questions
1. Yes. `spliceAgents` returns `templateHead.replace(...) + siteText.slice(at)`; the user part is a raw slice from the marker line's first byte to EOF, never transformed. Tests pin it with `toBe` for LF notes, a user-edited heading, CRLF notes without a trailing newline, and an inline marker in the old head plus a second fenced marker line in the notes. Converting the Nera head to the site head's EOL is acceptable and only touches Nera-owned text; it avoids mixed EOL on autocrlf checkouts. It needs no user decision, but step 3 should record it in the ROADMAP next to the split rule (D2), since the ROADMAP is the place for decisions.
2. No. `syncAgentFiles` reads the template and throws on a missing marker before it reads, stats or writes anything under `cwd`. The test `throws on a template without a marker, before writing anything` asserts that neither file exists afterwards. (A template that has AGENTS.md but lacks CLAUDE.md would throw from `copyFile` after AGENTS.md was written. That is a packaging bug outside this step's contract and is not worth a guard.)
3. `unchanged` is right. `skipped` means "the file is yours and you could opt in" (it triggers step 2's marker hint). An existing CLAUDE.md has no opt-in: per D4, creating it when missing is all Nera does, so nothing is pending. Step 2 should word the CLAUDE.md `unchanged` line neutrally (e.g. "CLAUDE.md kept"), not as "up to date", because the file may be the user's own.

## Step 1 — approved (2026-10-11)

snagio: ticked
commit: aea9c1f

## Step 2 — started (2026-10-11)

base_sha: aea9c1f71797c8bd4c32b98172c72a9a1de7aa5a
mode: fresh

## Step 2 — implemented (2026-10-11)

base_sha: aea9c1f

### Changed
- `src/commands/update.js` — `agentTemplateDir(cwd, fallbackDir)` (exported) prefers `node_modules/@nera-static/nera/template` when it has `AGENTS.md`, else the fallback; `syncAndReportAgentFiles` runs `syncAgentFiles` and prints one line per file plus the marker hint for `skipped`; called after `runNpm(['update', …])` (thin) and after `runNpm(['install'])` in `migrateLegacy`; new injectable `templateDir` option (default: the package's `templateDir()`), threaded into `migrateLegacy`
- `test/update.test.js` — `agentTemplateDir` (installed preferred / nothing installed / pre-1.6.0 install without AGENTS.md) and `runUpdate agent files`: both created on a bare thin site; Nera part refreshed from a template that only appears *during* the fake `npm update` (proves lookup happens after npm), site notes + own CLAUDE.md byte-identical; marker-less AGENTS.md untouched + hint names the template path; legacy without `--migrate` → no files; `--migrate` → both files; runNpm throws → no files; default templateDir = package template

### Fixed alongside
- none

### Carry forward
- none

### Verification
```
npx vitest run → Test Files  7 passed (7) / Tests  92 passed (92)
npm run lint → eslint . (no output, exit 0)
```

### Self-critique
- The `unchanged` line reads "✓ <file> unchanged" rather than the plan's "up to date": an existing CLAUDE.md is never compared (D4), so "up to date" would claim something the code does not check. For AGENTS.md "unchanged" is still true.
- Installed-template lookup checks only `AGENTS.md`; `CLAUDE.md` is copied from the same dir. Every published version with AGENTS.md (≥ 1.6.0) also ships CLAUDE.md, so I did not add a second existence check.
- Path is joined directly (`cwd/node_modules/@nera-static/nera/template`) rather than resolved via `createRequire` — the package has no `exports` map to honour for a data file, and a hoisted install always lands there; a non-hoisted/pnpm layout would simply fall back to the running CLI's template.
- Hint copies by reference ("copy the line from <path>") rather than printing the full marker line, to avoid a second marker parser in update.js.
- `--json` is not in scope here; `syncAgentFiles` returns data so it can be added later without touching the sync.

### Pressure-test questions for the reviewer
1. Is the sync strictly after npm in both paths, and is nothing written when `runNpm` throws or on the legacy guidance path (tests 'writes nothing…')?
2. Does the fallback hold when the installed `@nera-static/nera` predates 1.6.0 (template dir exists, no AGENTS.md)?
3. Is the skipped-hint wording accurate about what happens once the user adds the marker (everything above is replaced)?

## Step 2 — reviewed (2026-10-11)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- `src/commands/update.js:76` — the skipped-hint named the template via `path.relative(cwd, …)` even when it lives outside the site (global or npx-cached `nera`, where the fallback applies), printing a long `../../..` path; it now prints the relative path inside the site and the absolute path otherwise (+5/−1). New test `names a template outside the site by its absolute path` in `test/update.test.js` — `npx vitest run && npm run lint` → 93 passed, eslint clean

### Fixed alongside
- none

### Carry forward
- none

### Checked
goal (sync after `npm update` in the thin path and after `npm install` in `--migrate`, installed template preferred, one line per file + hint for skipped, legacy guidance and npm failure write nothing) · `npx vitest run` → 92 passed before, 93 after the fix; `npm run lint` → clean · Non-negotiables (marker-less AGENTS.md and existing CLAUDE.md never written, no publish/push), Framework correctness (ESM, no new dependency, no `process.exit`, no duplicated logic: sync lives in `agent-files.js`), Tests & hygiene (temp-dir sites, no network) · self-critique: "unchanged" instead of "up to date" is correct, since CLAUDE.md is never compared; the AGENTS.md-only existence check holds because `files` ships the whole `template/` and both files arrived together in 1.6.0; the direct `node_modules` join falls back safely on non-hoisted layouts; the hint copies by reference · walkthrough n/a (none)

### Answers to the pressure-test questions
1. Yes. `syncAndReportAgentFiles` is awaited on the line after `runNpm(['update', …])` (thin) and after `runNpm(['install'])` (migrate). `execFileSync` throws on a non-zero exit, so a failed npm run never reaches it. `printLegacyGuidance` returns without syncing. Pinned by 'writes nothing for a legacy site without --migrate' and 'writes nothing when npm update fails', and the refresh test creates the installed template only inside the fake `runNpm`, which proves the lookup happens after npm.
2. Yes. `agentTemplateDir` checks for `template/AGENTS.md`, not for the directory, so a 1.5.x install (template present, no AGENTS.md) falls back. Pinned by 'falls back when the installed version predates AGENTS.md'.
3. Yes. `spliceAgents` replaces `siteText.slice(0, at)` with the template head and keeps `siteText.slice(at)`, i.e. the marker line and everything below it, unchanged. That matches "Everything above that line is then Nera's and is replaced on update; the line and everything below it stay yours". It also warns honestly that the user's own text above the line would be lost.

## Step 2 — approved (2026-10-11)

snagio: ticked
