# Work log — 01a1260d-8eed-7390-a6cd-19b53ac3d824-nera-cli-nera-new-starter-and-the-interactive-picker

- **Issue:** `01a1260d-8eed-7390-a6cd-19b53ac3d824`

## Issue snapshot (2026-10-13)

- **Id:** `01a1260d-8eed-7390-a6cd-19b53ac3d824`
- **Type:** feature
- **Group:** S5 Starters
- **Status:** in_progress
- **Title:** [nera-cli] nera new --starter and the interactive picker

Spec: `nera-cli/ROADMAP-ai.md` — L5, decision D5.

Accept bare name / package / GitHub URL / local path; merge deps, apply `--name`/`--lang`; picker from npm keyword `nera-starter` with bundled offline fallback; never prompt without a TTY. Prove with a minimal starter.

## Cloud launch (2026-10-13)

- **Worked in a Claude Code cloud session**, outside the local plan → implement → review → approve loop (to use the cloud credit). The gate was not armed.
- **Brief:** `plans/cloud/01a1260d-8eed-7390-a6cd-19b53ac3d824-brief.md` · **Branch:** `issue/01a1260d-nera-new-starter` · **Session:** launched by the user (URL to be added)
- **On return:** `/work-issue-cloud 01a1260d-8eed-7390-a6cd-19b53ac3d824` — verify locally, triage, merge, reconcile, resolve.

## Cloud result (2026-10-13)

- **Branch:** `issue/01a1260d-nera-new-starter` (same commits also on `claude/nera-new-starter-eahn33`) · 10 commits · result file `plans/cloud/01a1260d-8eed-7390-a6cd-19b53ac3d824-result.md`
- **Summary:** `nera new --starter <spec>` (bare name, package, GitHub URL, local/absolute path) lays a starter's pages/config/theme/assets/plugins/.neraignore over the base template, merges `dependencies`, prints its README; `--name`/`--lang` edit `config/app.yaml`; a TTY-only picker (registry keyword `nera-starter`, bundled fallback); `--yes`. New `src/starter.js`, `src/starters.js`, `src/prompt.js`; `scaffoldProject` stays the one entry point.
- **Verified locally (Node 22.22.0, `npm ci`):** `npm run lint` clean; `npx vitest run` 12 files / 217 tests pass (baseline 159).
- **Verified locally:** `nera new s1 --no-install </dev/null` from a `main` worktree and from the branch → `diff -r` trees identical, output identical (paths normalised).
- **Verified locally:** `--starter <fixture> --name "Brot & Zeit" --lang de` → exit 0, `name: "Brot & Zeit"`/`lang: de` (parses back via `yaml`), deps `nera` + `plugin-navigation`, no devDependencies, fixture pages, AGENTS.md = template's, no `scripts/`, README printed after Done.
- **Verified locally:** `--starter 'a b'` → exit 1, forms message, no folder; `--starter x --theme example` → exit 1, no folder; `--starter nope-x1` (real network) → npm's 404 named, no folder, no `nera-starter-*` temp dir left.
- **Review findings:** `src/scaffold.js` `applyNameAndLang` — `--lang de` on the base template leaves `translations:` with only `en`; core's `t()` (`generator/src/render.js:482`) falls back to the key, so a new page without `description`/`keywords` renders `content="app_description"`. Latent today (template pages set both in frontmatter); confirmed by building a `--lang de` site. Otherwise none: scope matches the brief, lazy imports respected, no new dependency, errors say what/where/what to do.

### Decisions
- Work on `issue/01a1260d-nera-new-starter`, same commits pushed to the session's `claude/nera-new-starter-eahn33`.
- `--starter` also accepts an absolute path; path characters as `LOCAL_THEME` (no spaces, no Windows drive paths).
- Unscoped package names only as `nera-starter-<x>`; any other lowercase name is a bare name. GitHub refs may contain `/`, not start with `-`; `http://`, other hosts, `git+ssh:` refused.
- Picker lists only registry results whose shown name maps back to the same package; an empty registry result offers only "Empty" (no bundled merge).
- Picker accepts a number or a starter's shown name, re-asks on invalid input; end of input takes defaults; Ctrl+C → "Cancelled — nothing was created.", exit 1.
- Enter at Site name / Language leaves `config/app.yaml` as the template or starter has it; prompt shows `[the starter's]` after picking a starter.
- With `--theme` on a TTY the starter question is skipped; name/lang still asked. Bad flags rejected before the first question.
- `--name`: non-empty, no control characters; `setAppValue` replaces the whole top-level line (inline comment dropped).
- Starter fetched and its manifest checked before the target folder exists; later failure removes the folder (`nera new <name>`) or lists written files (`nera new .`); a failing `npm install` does not remove the site.
- Symlinks in a starter are not copied; non-string dependency values ignored.
- Log lines `📦 Downloading the starter "<spec>"...` and `✓ Applied the "<label>" starter (<pkg>)`; README printed between "✅ Done!" and "👉 Next steps".
- Offline list in `src/starters.js` (comment-able), holds only `blank`.

### Carry forward
- `template/AGENTS.md`, `skills/nera/` — mention `--starter`/`--name`/`--lang`/`--yes` once `@nera-static/starter-blank` is published (blocked on issue 01a1260d-8eff).
- `../nera-website/pages/docs/cli.md` (+ de/es) — document the new flags and starter kits (other repo).
- `src/starters.js` — add each official starter when published (belongs to each starter issue).
- `src/scaffold.js` `applyNameAndLang` — `--lang <x>` without a `translations.<x>` block → `t()` renders raw keys on pages without description/keywords (review finding above).
- `src/starter.js` / `src/scaffold.js` — `execFileSync('npm', …)` is `npm.cmd` on Windows (same pre-existing limitation as `npm install`).

## Triage (2026-10-13)

| item | verdict | why |
|---|---|---|
| `applyNameAndLang`: `--lang <x>` without `translations.<x>` → raw keys from `t()` | **fix** | small, one surface: copy the site's current language block under the new code (user's choice) |
| `template/AGENTS.md` + `skills/nera/` mention `--starter` | **file** | blocked on `@nera-static/starter-blank` (01a1260d-8eff) being published |
| `nera-website` `docs/cli.md` (en/de/es): new flags + starter kits | **file** | other repo |
| Windows: `execFileSync('npm')` needs `npm.cmd` (install + starters) | **file** | pre-existing, separate fix |
| `src/starters.js` grows per official starter | none | part of each starter issue |
