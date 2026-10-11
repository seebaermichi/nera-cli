# Plan: [nera-cli] nera update writes and refreshes AGENTS.md / CLAUDE.md

- **Issue:** `01a1260d-8e34-7376-aa6d-2ca717d46ddd`
- **Type:** feature
- **Plan written:** 2026-10-10

## Context

ROADMAP-ai.md L1 / D2: existing sites get `AGENTS.md` and `CLAUDE.md` through
plain `nera update`, with no extra flag. Since 1.6.0 the scaffold template ships
both files, and `AGENTS.md` carries the ownership marker line
(`<!-- nera:site-notes …`, one line, directly above `## Notes for this site`).
`nera update` (`src/commands/update.js`, `runUpdate`) today only runs
`npm update` on the `@nera-static/*` packages, or migrates a legacy clone. This
issue adds the file sync: create both files when they are missing, replace only
the Nera-owned part above the marker in an existing `AGENTS.md`, and leave a
marker-less `AGENTS.md` alone with a hint. Temp-dir tests cover all three cases.

## Design decisions

**D1 — The sync lives in its own module, `src/agent-files.js`, as `syncAgentFiles({ cwd, templateDir })`, which returns one `{ file, action }` per file.** `runUpdate` only prints the result, so future `--json` and MCP callers reuse the same function (principle 4).

**D2 — The split is on the first line starting with `<!-- nera:site-notes`.** The new file is the template's text above its marker, followed by the site's file from its marker line to the end. The site keeps its own marker line and everything below it.

**D3 — The Nera part comes from the site's installed `node_modules/@nera-static/nera/template/AGENTS.md`, read after `npm update`.** It falls back to the running CLI's own `template/` when that file is missing. That way the instructions follow the installed Nera version (D2 in the ROADMAP), even when a global or older `nera` runs the update.

**D4 — An existing `CLAUDE.md` is never touched,** whatever it contains. Only a missing one is created.

**D5 — Writes happen only when the content changes** (actions `created`, `updated`, `unchanged`, `skipped`), so a repeated `nera update` is idempotent and leaves timestamps alone.

**D6 — The sync runs after a successful `npm update` on a thin site and after `--migrate`.** It does not run on the legacy guidance path, which changes nothing, or when npm fails. Nothing is ever prompted.

**D7 — Release as minor 1.7.0.** It is additive, and an existing site notices only new or refreshed Nera-owned text.

## Acceptance criteria

- [ ] Plain `nera update` creates `AGENTS.md` and `CLAUDE.md` when they are missing
- [ ] With an existing `AGENTS.md` that has the marker, `nera update` replaces only the part above the marker; the marker line and everything below it are kept byte for byte
- [ ] A marker-less `AGENTS.md` is left alone, and `nera update` prints a hint
- [ ] Temp-dir tests for all three cases
- [ ] ROADMAP slice 1 progress, README and CHANGELOG record it; version is 1.7.0

## Steps

### Step 1 — syncAgentFiles creates, refreshes or skips AGENTS.md / CLAUDE.md — ✅ done

- **Goal:** `src/agent-files.js` exports `syncAgentFiles({ cwd, templateDir })` (plus the marker constant). It creates missing files from the template, splices the template's Nera part onto the site's marker-onward part, skips a marker-less `AGENTS.md` and any existing `CLAUDE.md`, writes only on change, and returns `[{ file, action }]`.
- **Files:** `src/agent-files.js` — new; `test/agent-files.test.js` — new temp-dir tests: missing → created (both); marker → only the part above is replaced, user notes byte-identical (incl. CRLF/no trailing newline, user-edited heading); marker-less → skipped, file untouched; existing CLAUDE.md → unchanged; second run → `unchanged`; a template without a marker throws (a packaging bug, not a site state).
- **Verify:** `npx vitest run && npm run lint` — all green, new tests included
- **Review hardest:** the splice keeps the site's marker line and everything after it byte for byte, and a second marker or a marker-like text in the user's notes does not move the split
- **Risks:** a marker match that is too loose (e.g. inside a code fence in the Nera part) would cut the user's notes; the match is "line starts with", first occurrence
- **Walkthrough:** none

### Step 2 — nera update runs the sync and reports it — ⬜ todo

- **Goal:** `runUpdate` calls `syncAgentFiles` after a successful `npm update` (thin) and after `--migrate`, with the template from the site's installed `@nera-static/nera` when that template has `AGENTS.md`, otherwise from the running package's `templateDir()`. It prints one line per file (created / refreshed Nera part / up to date) and, for `skipped` AGENTS.md, a hint on adding the marker line above the site's own notes. Legacy guidance and failed npm runs write nothing.
- **Files:** `src/commands/update.js` — call + output + template resolution (an injectable `templateDir` option for tests); `test/update.test.js` — temp-site tests: thin site without files → both created; with marker → Nera part refreshed from a fake installed `node_modules/@nera-static/nera/template/AGENTS.md`; marker-less → untouched + hint on stdout; legacy without `--migrate` → no files; runNpm throwing → no files
- **Verify:** `npx vitest run && npm run lint` — all green
- **Review hardest:** the installed-template lookup prefers the site's `node_modules` copy and falls back cleanly when it is missing or predates 1.6.0
- **Risks:** the existing update/migrate tests asserting exact console output or file lists; a migrated site now also gains the two files
- **Walkthrough:** none

### Step 3 — Docs and release bookkeeping for 1.7.0 — ⬜ todo

- **Goal:** README's `nera update` row and update section explain the AGENTS.md/CLAUDE.md sync and the marker. CHANGELOG has `## [1.7.0] - 2026-10-10` / `### Added`. `npm version minor --no-git-tag-version` brings 1.7.0. ROADMAP-ai.md "Slice 1 — progress" and the slice plan mark the `nera update` part done and record D2–D5 of this plan (installed-template source, untouched CLAUDE.md, split rule).
- **Files:** `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `ROADMAP-ai.md`
- **Verify:** `npx vitest run && npm run lint && node -p "require('./package.json').version"` — green, prints `1.7.0`
- **Review hardest:** the ROADMAP still names the command-consistency test as the one open slice 1 item, and nothing claims a release that has not happened
- **Risks:** none beyond the docs drifting from the code
- **Walkthrough:** none
