# Plan: [nera-cli] AGENTS.md + CLAUDE.md in the scaffold template

- **Issue:** `01a1260d-8e1c-7059-bd2c-a14bc8f50ffc`
- **Type:** feature
- **Plan written:** 2026-10-10

## Context

ROADMAP-ai.md L1 / slice 1: every site `nera new` creates should carry an
`AGENTS.md` (≤ ~120 lines: what Nera is, folder map, commands, traps, the
validate → build --check loop, a "Notes for this site" section the user owns) and
a one-line `CLAUDE.md` (`@AGENTS.md`). The content comes from the slice-0 record,
section "Inputs for `AGENTS.md` (slice 1)". The scaffold copies `template/`
verbatim (`src/scaffold.js#copyDir`), so the work is two new template files, tests
that a scaffold ships them, and the docs/release bookkeeping. `nera update`
writing them and the command-consistency test are separate S1 issues
(`01a1260d-8e34-…`, `01a1260d-8e49-…`) and stay out of this plan — but the marker
this plan fixes is what `nera update` will parse.

## Design decisions

**D1 — The ownership marker is one HTML-comment line, `<!-- nera:site-notes … -->`,
directly above `## Notes for this site`.** Invisible when rendered, greppable, and
stable for the `nera update` issue to split on; the heading alone is too easy to
reword or translate.

**D2 — Only facts true for core 4.15.1 / nera 1.5.1 today.** No `nera publish`,
no `--json` (they do not exist yet); "Getting online" says `public/` after
`npm run build` is the folder to deploy. Local plugins are documented at core's
real default `src/plugins/<name>/index.js` (configurable via `folders.plugins`),
not the spec's `plugins/`, which the template does not configure.

**D3 — Theme-neutral wording.** With `--theme` the starter `.pug` files are left
out, so `AGENTS.md` says layouts live in `theme/views/` *or the theme package*,
and names `pages/default.pug` as what the scaffold's pages use.

**D4 — No scaffold code change.** `copyDir` already copies every template file;
`AGENTS.md`/`CLAUDE.md` are not dotfiles, so in-place `nera new .` needs nothing
new either.

## Acceptance criteria

- [ ] `nera new` writes `AGENTS.md` (≤ 120 lines) covering: Nera in two sentences + https://nera.js.org link (`llms.txt` follows with slice 2 — Decision in the log), folder map, commands, traps, validate → build --check loop
- [ ] `AGENTS.md` ends with the user-owned "Notes for this site" section behind the D1 marker
- [ ] `nera new` writes `CLAUDE.md` containing exactly `@AGENTS.md`
- [ ] Both files are written with and without `--theme`, and in place (`nera new .`)
- [ ] Every claim in `AGENTS.md` holds for the core version the template depends on
- [ ] Minor release prepared: version bump + CHANGELOG + README + ROADMAP slice-1 note

## Steps

### Step 1 — The scaffold ships AGENTS.md and CLAUDE.md — ✅ done

- **Goal:** `template/AGENTS.md` and `template/CLAUDE.md` exist with the L1
  content and D1 marker; `nera new` (plain, `--theme`, in place) writes both.
- **Files:** `template/AGENTS.md` — new, the instructions (slice-0 inputs: Markdown
  pages, `/a/b.html` URLs, `layout` required and `layout-missing`, `main !{ content }`
  is the only `<main>`, look for a `@nera-static/plugin-*` first — contact-form
  (`npx nera-contact-form`) and navigation (`npx nera-navigation`) named, catalog
  linked —, `public/` wiped, plugin templates copied into
  `theme/views/vendor/<plugin>/` and included by hand, site file overrides theme
  file at the same path, `npm run dev` on :3000 and stop it yourself, validate →
  build --check, deploy `public/`); `template/CLAUDE.md` — new, `@AGENTS.md`;
  `test/scaffold.test.js` — assertions for the three scaffold modes, CLAUDE.md's
  exact content, AGENTS.md ≤ 120 lines with the marker exactly once, last section
  "Notes for this site". (Commands named vs. CLI usage is issue `01a1260d-8e49-…`.)
- **Verify:** `npx vitest run && npm run lint` — green; plus
  `wc -l template/AGENTS.md` ≤ 120.
- **Review hardest:** each factual claim against `../generator/src` (core.js URLs
  and folders, render.js layout skip, setup-plugins.js discovery),
  `../nera-validate` rule ids, and the two plugins' `package.json` `bin` names —
  a wrong instruction is worse than none.
- **Risks:** `nera validate` / `nera dev` treating a root `AGENTS.md` as content
  (they read `pages/` only — confirm with the existing build test passing).
- **Walkthrough:** none

### Step 2 — Docs and release bookkeeping for 1.6.0 — ✅ done

- **Goal:** README documents the two files and the marker; ROADMAP-ai.md slice 1
  records D1–D2 (marker literal, `src/plugins` correction of the L1 folder map) and
  the llms.txt Decision (homepage link until slice 2) as done for this issue; CHANGELOG `1.6.0` "Added" entry; version bumped minor.
- **Files:** `README.md` — scaffold section; `ROADMAP-ai.md` — L1 / slice-1 note;
  `CHANGELOG.md` — `## [1.6.0] - 2026-10-10`; `package.json`,
  `package-lock.json` — via `npm version minor --no-git-tag-version`.
- **Verify:** `npx vitest run && npm run lint` — green;
  `node -p "require('./package.json').version"` prints `1.6.0`.
- **Review hardest:** the ROADMAP note must not claim the `nera update` or
  consistency-test parts are done.
- **Risks:** none beyond docs drift.
- **Walkthrough:** none

### Step 3 — `nera new .` accepts an existing AGENTS.md/CLAUDE.md; contact-form README gets `main` — ✅ done

- **Goal:** (triage #1) `assertEmptyDir` ignores `AGENTS.md` and `CLAUDE.md`, so
  `nera new .` works in a folder an agent started in; `copyDir` keeps the user's
  copy and prints "Kept your existing …" (comment at `src/scaffold.js:139-140`
  updated to name them). (triage #2) the contact-form README's example page
  layout uses `main.contact` instead of `section.contact`, so `nera build --check`
  no longer reports `a11y-main` on the scaffold layout.
- **Files:** `src/scaffold.js` — `assertEmptyDir` + the `copyDir` comment;
  `test/scaffold.test.js` — in-place scaffold into a folder holding only a user
  `AGENTS.md`/`CLAUDE.md`: succeeds, both files keep the user's content, the rest
  of the template is written; a folder with `AGENTS.md` plus another file still
  refuses; `CHANGELOG.md` — one bullet in the unreleased `## [1.6.0]` entry (not
  tagged yet, so no new version);
  `../nera-plugin-contact-form/README.md:255` — `section.contact` → `main.contact`
  (README only, its own commit in that repo, no release).
- **Verify:** `npx vitest run && npm run lint` — green, incl. the new tests;
  in `../nera-plugin-contact-form`: `npm run lint` green, `git diff` shows only the
  README line.
- **Review hardest:** the allow-list matches the two exact names only (no
  case-folding surprises, no other files slip through); the user's file is never
  overwritten.
- **Risks:** a user's `CLAUDE.md` without the Nera content stays as is — intended;
  `nera update` (`01a1260d-8e34-…`) owns merging the Nera part in.
- **Walkthrough:** none
