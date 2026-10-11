# Plan: [nera-cli] Test: commands named in AGENTS.md exist in the CLI usage

- **Issue:** `01a1260d-8e49-738c-8c1b-3d804b7198c0`
- **Type:** improvement
- **Plan written:** 2026-10-11

## Context

`ROADMAP-ai.md` L1 promises a test that asserts every `nera <command>` named
in the template's `AGENTS.md` exists in the CLI's usage text, so the
instructions an AI reads cannot go stale silently (e.g. naming `nera publish`
before slice 6 ships it). It is the last open item of slice 1. Today
`template/AGENTS.md` names `nera validate`, `nera build --check`,
`nera check` and `nera update`; the usage text is a module-local `const` in
`bin/nera.js`, printed when the CLI runs without a command (exit 0). The work
is one new test file plus the ROADMAP's slice-1 bookkeeping; no production
code changes.

## Design decisions

**D1 — Read the usage by running `node bin/nera.js` with no arguments.** No production change; the test checks exactly what a user sees.

**D2 — Extract `nera <command>` (and a `--flag` written right after it) from the whole `AGENTS.md`, case-sensitive.** `Nera` in prose and `nera-contact-form` binaries do not match; a named flag must appear in the usage too.

**D3 — The test proves it is not vacuous.** The extraction must find the known commands, and a fixture naming `nera publish` must be reported as missing.

**D4 — No release.** `test/` is not in the package's `files`, so consumers receive nothing new: no version bump, no CHANGELOG entry.

## Acceptance criteria

- [ ] A vitest extracts every `nera <command>` from `template/AGENTS.md` and asserts each appears in the usage text of `bin/nera.js`.
- [ ] The test fails when `AGENTS.md` names a command the usage lacks (proven by a fixture, not by editing the template).
- [ ] `ROADMAP-ai.md` records the test as done and slice 1 as complete, in the status header, the slice list and "Slice 1 — progress".

## Steps

### Step 1 — A vitest proves every nera command in AGENTS.md is in the CLI usage — ✅ done

- **Goal:** `test/agents-commands.test.js` runs `node bin/nera.js`, extracts `nera <command>` (+ an immediately following `--flag`) from `template/AGENTS.md`, and asserts each command is a usage line (`  nera <command>`) and each flag occurs in the usage; a helper-level test shows a fixture naming `nera publish` is reported missing, and the real extraction contains at least `validate`, `build`, `check`, `update`.
- **Files:** `test/agents-commands.test.js` — new
- **Verify:** `npx vitest run && npm run lint` — all green, new file included
- **Review hardest:** the regex — it must catch `npx nera build --check` and the marker comment's `nera update`, and must not match `nera.js.org`, `nera-navigation` or `pkill -f nera`.
- **Risks:** spawning the CLI from a cwd-relative path; resolve `bin/nera.js` from the test file's URL so vitest's cwd does not matter.
- **Walkthrough:** none

### Step 2 — ROADMAP-ai.md records the consistency test and slice 1 as done — ✅ done

- **Goal:** the status header, slice list item 1 and "Slice 1 — progress" say the command-consistency test is done (2026-10-11, no release, test-only) and slice 1 is complete; the L1 section names the test file.
- **Files:** `ROADMAP-ai.md` — status header, L1 paragraph, "Order of slices" item 1, "Slice 1 — progress"
- **Verify:** `grep -n 'still open\|is open\|consistency test' ROADMAP-ai.md` — no line still calls the test open; `npx vitest run && npm run lint` green
- **Review hardest:** stale "open" wording left in one of the four places.
- **Risks:** none beyond the document.
- **Walkthrough:** none
