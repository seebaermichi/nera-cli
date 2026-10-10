# Work log — 01a1260d-8e1c-7059-bd2c-a14bc8f50ffc-nera-cli-agents-md-claude-md-in-the-scaffold-template

- **Issue:** `01a1260d-8e1c-7059-bd2c-a14bc8f50ffc`

## Issue snapshot (2026-10-10)

- **Id:** `01a1260d-8e1c-7059-bd2c-a14bc8f50ffc`
- **Type:** feature
- **Group:** S1 Agent instructions
- **Status:** in_progress
- **Title:** [nera-cli] AGENTS.md + CLAUDE.md in the scaffold template

Spec: `nera-cli/ROADMAP-ai.md` — L1.

Write `template/AGENTS.md` (≤ ~120 lines: what Nera is, folder map, commands, traps, validate/check loop, the "Notes for this site" marker) and `template/CLAUDE.md` (`@AGENTS.md`). Content driven by the S0 findings. Minor release.

## Decision (2026-10-10)

**D1 — Marker is the line `<!-- nera:site-notes … -->` above `## Notes for this site`.** Alternatives: the heading alone (a user rewording or translating it would make `nera update` treat the file as unmarked and leave it stale), a front-matter flag (AGENTS.md has no front matter convention; agents would read it as noise). An HTML comment is invisible on GitHub, survives Markdown formatters, and is a fixed literal the update issue (`01a1260d-8e34-…`) can split on. Cost: the literal is now a contract — changing it later needs `nera update` to accept both spellings.

**D2 — Only today's facts.** `nera publish` and `--json` are slices 3/6; naming them would fail the consistency test (`01a1260d-8e49-…`) and mislead agents. Checked against core: local plugins default to `./src/plugins` (`generator/src/core.js` defaultSettings, honoured from `app.folders.plugins` in `src/index.js`); the spec's L1 folder map says `plugins/`, which the template does not configure. Alternative was adding `folders.plugins: ./plugins` to `template/config/app.yaml` — rejected here as an unasked template change; recorded in the ROADMAP instead so L1's map gets corrected.

**D3 — Theme-neutral wording**, because `--theme` drops the starter `.pug` files (`skipStarters`), so `theme/views/pages/default.pug` may not exist in the site.

**D4 — No scaffold code change.** `copyDir` copies every file; root `AGENTS.md`/`CLAUDE.md` are not dotfiles, so `assertEmptyDir` and the "Kept your existing" branch are unaffected.

**Scope cut:** `nera update` writing the files and the command-consistency test are their own S1 issues; step 1 deliberately does not test commands against usage.

## Carry forward (2026-10-10)

- design · S · src/scaffold.js#assertEmptyDir — `nera new .` refuses a folder that already holds an `AGENTS.md`/`CLAUDE.md` (agents often start in one); decide whether to keep the user's copy like `.gitignore` — belongs with the `nera update` marker logic (`01a1260d-8e34-…`)
- debt · S · template/config/app.yaml — set `folders.plugins: ./plugins` so new sites match the ROADMAP's L1 folder map, then update AGENTS.md — template behaviour change, not asked here

## Step 1 — started (2026-10-10)

base_sha: 9799f0a96633c14ff974cf73f291784757952107
mode: fresh

## Decision (2026-10-10)

AGENTS.md links https://nera.js.org/llms.txt, which returns 404 until slice 2 (L2) ships on nera-website — how to handle it? → Link https://nera.js.org now; the llms.txt link goes in with slice 2, recorded as a ROADMAP note in Step 2, and the acceptance-criterion line is reworded to match (D2: only facts true today; a dead link is the first thing an agent would read).

## Step 1 — implemented (2026-10-10)

base_sha: 9799f0a96633c14ff974cf73f291784757952107

### Changed
- `template/AGENTS.md` — new, 117 lines: what Nera is (not Eleventy/Hugo/Astro/Jekyll) + https://nera.js.org; folder map (`src/plugins/<name>/index.js` per D2, `folders.plugins` named); commands (`npm run dev`/`build`, `npx nera validate`, `npx nera build --check`, `npx nera check`); validate → build --check loop; traps (Markdown not HTML, `/a/b.html` URLs, `layout` required + `layout-missing`, `main !{ content }` is the only `<main>`, `public/` wiped, site file overrides theme file per path, `t()`); plugins first (catalog, contact-form `mailto:` + `npx nera-contact-form`, navigation + `npx nera-navigation`, copy into `theme/views/vendor/<plugin>/`, include by hand, skip-if-exists / `--force`); preview (stop by PID, never `pkill -f`, port fallback); getting online = deploy `public/`; D1 marker `<!-- nera:site-notes … -->` directly above `## Notes for this site`
- `template/CLAUDE.md` — new, `@AGENTS.md\n`
- `test/scaffold.test.js` — new block: both files written for a new folder, `--theme example`, and `nera new .` (CLAUDE.md exact, AGENTS.md byte-equal to the template); ≤ 120 lines; docs link present and no `llms.txt`; marker exactly once, well-formed, directly above the last `##` heading "Notes for this site"; no `nera publish`/`--json`/bare `plugins/<name>`
- `test/build.test.js` — the scaffold-and-render test also asserts no `AGENTS.*`/`CLAUDE.*` lands in `public/` (the plan's risk)
- plan acceptance criterion 1 — reworded to the homepage link per the Decision (llms.txt 404s today)

Claims checked against: `generator/src/core.js:227-245` (href `/a/b.html`), `:72,104-105` (default plugins folder, `theme/views`), `render.js:458-493` (basedir → `include /vendor/…`, layout skip, `t()`), `setup-plugins.js:129-141` (`@nera-static/plugin-*` discovery), `nera-validate/index.js:142-160` (`layout-missing` warning without line, `layout-unresolved` error with line), contact-form 1.1.1 / navigation 3.0.3 `bin` and `publish-template.js` (theme-aware dest, `--force`), `src/commands/serve.js:6-17` (port 3000, vite non-strict port).

### Fixed alongside
- none

### Carry forward
- debt · S · `../nera-plugin-contact-form/README.md:252-258` — the example layout wraps the page in `section.contact` without `main`, so on the scaffold's `layouts/layout.pug` the page has no `<main>` and `nera build --check` reports `a11y-main` — other repo, unrelated to this step

### Verification
```
npx vitest run → Test Files  6 passed (6) / Tests  71 passed (71)
npm run lint → eslint . (no output, exit 0)
wc -l template/AGENTS.md → 117 template/AGENTS.md
curl https://nera.js.org/llms.txt → 404 (hence the Decision); PLUGINS.md catalog URL → 200
```

### Self-critique
- Considered and rejected: `npx nera dev` in Commands — the template's script is `npm run dev`, and 1.5.1 deliberately stopped naming a global `nera`.
- Considered and rejected: the spec's `npx nera publish` and `--json` (D2) and `plugins/` (template doesn't set `folders.plugins`); a test pins all three out.
- The template depends on `@nera-static/nera ^1.0.0` → core `^4.12.0`; claims were checked against 4.15.1 (what installs). Root-absolute `include /vendor/…` needs core ≥ 4.3.0 and the theme-aware vendor copy needs plugin-utils ≥ 1.5.0 — navigation declares `^1.2.0`, so a stale lockfile could still copy to root `views/`; a fresh install resolves 1.5+.
- Least sure: wording that is untested by any machine — "Nera is not Eleventy…" and the plugin-first list (tags, search, pagination, images) are judgment calls; the cold agent test (slice 7) is the real check.
- The "folders that exist today" regex is narrow by design (guards D2 only); the command-consistency test is issue `01a1260d-8e49-…`.

### Pressure-test questions for the reviewer
1. Is any AGENTS.md sentence false for core 4.15.1 / validate 1.4.0 — especially "`nera validate` names the page and line of a broken layout or include" and "the server picks another port"?
2. Is the D1 marker text (`<!-- nera:site-notes — everything below this line belongs to the site owner; `nera update` keeps it as it is -->`) a good stable split key for the `nera update` issue, or should it be a bare `<!-- nera:site-notes -->`?
3. With `--theme`, the starter layouts are skipped but AGENTS.md still names `pages/default.pug` and `layouts/layout.pug` as "the pages this site was created with use" — acceptable under D3, or misleading on a themed site?

## Step 1 — reviewed (2026-10-10)

Verdict: approve

### 🔴 Blocking
- none

### Fixed in review
- `template/AGENTS.md:57-61` — "The page body" claimed `theme/views/pages/default.pug` prints `main !{ content }` and that is the only `<main>`; false on a `--theme example` site (no starter views; the theme's `layouts/layout.pug:10` holds `main.content`, its `pages/default.pug` wraps in `article.page`), so an agent copying the pattern would nest two `<main>`. Reworded: without a theme vs. with a theme, "check the layout and the page template before adding one" — `npx vitest run && npm run lint` → 71/71 passed, lint exit 0; `wc -l` → 118
- `template/AGENTS.md:42-43` — "names the page and line of a broken layout or include, which a failing build does not": `include-unresolved` names the template file (not the page, `nera-validate/src/pug-refs.js:47-52`), `layout-missing` has `line: null`, and a Pug include error does carry file:line. Reworded to "names the file and line of a broken layout or include and finds pages the build would skip silently" — same verify → green
- plan Step 2 Goal — added "the llms.txt Decision (homepage link until slice 2)" to what ROADMAP-ai.md records; the log's Decision promises that, but Step 2's goal only named D1–D2 (non-negotiable: decisions go back into the ROADMAP) — n/a (plan text)

### Fixed alongside
- none

### Carry forward
- none (the implementer's contact-form README debt stands as logged)

### Checked
goal (three scaffold modes write both files, byte-equal; marker once, above last heading) · `npx vitest run` 71/71, `npm run lint` exit 0, `wc -l` 117→118 · Non-negotiables, Framework correctness, Tests & hygiene · claims against generator 147b00a: `core.js` defaultSettings `plugins: ./src/plugins`, theme probe → `theme/views`/`theme/assets`, href `/a/b.html`; `render.js:481-493` layout skip, `t()` = `translations[meta.lang||app.lang][key]`, basedir = views folder; validate `layout-missing` warning / `layout-unresolved` error with line; contact-form 1.1.1 bins `nera-contact-form`, `publishAsset` → `js/contact-form.js` theme-aware, `--force`; navigation 3.0.3 bin `nera-navigation`, `--force`; plugin-utils skip-if-exists unless force; `bin/nera.js` has `check`; serve.js port 3000 without `strictPort` (vite falls back) · self-critique claims verified · walkthrough n/a

### Answers to the pressure-test questions
1. Two sentences were off for core 4.15 / validate 1.4: the `<main>` bullet on a themed site and the validate-vs-build sentence (see Fixed in review). "The server picks another port" is true: `startServer` passes `port` to vite with no `strictPort`, vite's default is to try the next port and print the URL.
2. Keep the prose marker. It is stable as long as the `nera update` splitter keys on the prefix `<!-- nera:site-notes` through `-->` (as the test already does with `SITE_NOTES_MARKER`), never on the full literal — then the explanatory text can be reworded later without orphaning existing sites. The `nera update` issue should state that rule.
3. `layout: pages/default.pug` stays true on a `--theme example` site (the theme ships `views/pages/default.pug`), and the folder map plus the "Site files override theme files" bullet explain where layouts come from. The `<main>` bullet was misleading there and is now fixed; the rest is acceptable under D3.

## Step 1 — approved (2026-10-10)

snagio: ticked
commit: 97997bc

## Step 2 — started (2026-10-10)

base_sha: 97997bc280aaeee19c0f7b06bbbef922d0c9896c
mode: fresh

## Step 2 — implemented (2026-10-10)

base_sha: 97997bc

### Changed
- `README.md` — new "Instructions for AI assistants" section (after the thin-project block): the two files, the check loop, the user-owned "Notes for this site" section behind `<!-- nera:site-notes … -->`
- `ROADMAP-ai.md` — status header (slice 1 under way, template part in 1.6.0); L1 folder map `plugins/` → `src/plugins/` (D2 correction); slice-plan item 1 marks only the template part done; new "Slice 1 — progress" section recording D1 (marker literal as contract), D2 (only facts true today, `src/plugins`), the llms.txt Decision (homepage link until slice 2), and naming `nera update` + the consistency test as still open
- `CHANGELOG.md` — `## [1.6.0] - 2026-10-10` / `### Added` entry for `AGENTS.md` + `CLAUDE.md`, "Existing sites are not changed"
- `package.json`, `package-lock.json` — 1.5.1 → 1.6.0 via `npm version minor --no-git-tag-version`

### Fixed alongside
- none

### Carry forward
- none

### Verification
```
npx vitest run → Tests  71 passed (71)
npm run lint → eslint . (no output, exit 0)
node -p "require('./package.json').version" → 1.6.0
package-lock.json → "version": "1.6.0" (lines 3 and 9)
```

### Self-critique
- Every CHANGELOG/README claim checked against `template/AGENTS.md` (traps, `.html` URLs, `public/` regenerated, check loop, marker line); README says the part above the marker "may be replaced by a later Nera version" — hedged on purpose, since `nera update` does not touch `AGENTS.md` yet.
- ROADMAP wording kept future tense for `nera update` ("will split on it") so nothing claims the update issue is done.
- Left the L1 spec bullets for `llms.txt`, `nera publish`, `--json` unchanged: they describe the target, and the progress section records why the template omits them today.
- Least sure: placement of the README section (own `##` between the thin-project block and "Starting from a theme"); it could also sit under Quick start.
- The workspace-root `CLAUDE.md` still names nera 1.5.1 as latest; it is untracked and should change at release (after the tag), not in this diff.

### Pressure-test questions for the reviewer
1. Does any line of the ROADMAP diff (header, slice plan, progress section) read as if `nera update` writing the files or the command-consistency test were done?
2. Is "Existing sites are not changed" in the CHANGELOG accurate — i.e. does `nera update` on 1.6.0 really leave a site without `AGENTS.md` untouched?
3. Is minor the right bump (new template files only affect new sites)?

## Step 2 — reviewed (2026-10-10)

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
goal (README section, ROADMAP header/L1 map/slice plan/progress section, CHANGELOG 1.6.0 Added, minor bump) · `npx vitest run` → 71 passed; `npm run lint` → exit 0; version → 1.6.0; lockfile lines 3/9 → 1.6.0 · Non-negotiables, Framework correctness, Tests & hygiene · claims checked: `template/AGENTS.md` is 118 lines, marker at line 114 starts `<!-- nera:site-notes` and closes on the same line, `src/plugins` matches core (`../generator/src/core.js:72`, `setup-plugins.js:81`), AGENTS.md links nera.js.org and not `/llms.txt`, `template/CLAUDE.md` is `@AGENTS.md` · scope: only the step's 5 files plus plan/log bookkeeping · walkthrough n/a

### Answers to the pressure-test questions
1. No. Header: "`nera update` writing them and the command-consistency test are still open"; slice plan: "Template part done … `nera update` and the consistency test are open"; progress section uses future tense ("`nera update` will split on it") and closes with a "Still open in slice 1" paragraph naming both.
2. Yes. `src/commands/update.js` writes only `package.json` (line 70) and moves `src/plugins` on `--migrate`; nothing reads `template/` or writes `AGENTS.md`/`CLAUDE.md`, so an existing site is unchanged.
3. Yes. The conventions say template changes that only affect new sites are minor; this adds files to `template/` only, with no CLI contract change.

## Step 2 — approved (2026-10-10)

snagio: ticked
