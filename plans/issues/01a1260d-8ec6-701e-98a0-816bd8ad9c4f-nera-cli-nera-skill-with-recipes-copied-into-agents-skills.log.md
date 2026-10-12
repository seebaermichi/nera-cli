# Work log — 01a1260d-8ec6-701e-98a0-816bd8ad9c4f-nera-cli-nera-skill-with-recipes-copied-into-agents-skills

- **Issue:** `01a1260d-8ec6-701e-98a0-816bd8ad9c4f`

## Issue snapshot (2026-10-12)

- **Id:** `01a1260d-8ec6-701e-98a0-816bd8ad9c4f`
- **Type:** feature
- **Group:** S4 Skill (1)
- **Status:** in_progress
- **Title:** [nera-cli] Nera skill with recipes, copied into .agents/skills and .claude/skills

Spec: `nera-cli/ROADMAP-ai.md` — L4, decision D4.

Source in `skills/nera/` (SKILL.md + recipes). `nera new` and `nera update` copy it into both folders; add `skills` to `files`. Re-check vendor folder docs first.

## Cloud launch (2026-10-12)

- **Worked in a Claude Code cloud session**, outside the local plan → implement → review → approve loop (to use the cloud credit). The gate was not armed.
- **Brief:** `plans/cloud/01a1260d-8ec6-701e-98a0-816bd8ad9c4f-brief.md` · **Branch:** `issue/01a1260d-nera-skill` · **Session:** launched by the user (`claude --cloud` needs an interactive terminal); URL to be added
- **Vendor folder check (2026-10-12):** Claude Code `.claude/skills`; Codex `.agents/skills`; Cursor `.agents/skills` + `.cursor/skills` (also reads `.claude/skills`); Copilot/VS Code `.github/skills`, `.claude/skills`, `.agents/skills`; Gemini CLI `.gemini/skills` + alias `.agents/skills`. Decision: D4's two folders suffice, no third.
- **Decided for the user in the brief:** both skill folders are wholly Nera-owned mirrors (update rewrites/removes inside `skills/nera/` only, writes only on change); source on update = installed package, fallback running CLI; recipes name no planned feature (`--starter`, `nera publish`); `template/AGENTS.md` unchanged; consistency test extended to the skill; ships as 1.10.0 (minor).
- **On return:** `/work-issue-cloud 01a1260d-8ec6-701e-98a0-816bd8ad9c4f` — verify locally, triage, merge, reconcile, resolve.

## Cloud result (2026-10-12)

- **Branch:** `claude/nera-skill-recipes-6wgabr` (local `issue/01a1260d-nera-skill`) · 8 commits · result file `plans/cloud/01a1260d-8ec6-701e-98a0-816bd8ad9c4f-result.md`
- **Summary:** `skills/nera/SKILL.md` (105 lines) + eight recipes; `src/skill.js` `syncSkill()` mirrors it into `.agents/skills/nera/` and `.claude/skills/nera/`; `nera new` copies it, `nera update` (and `--migrate`) syncs from the installed package with fallback; `files` gains `skills`; README section.
- **Verified locally (Node 22.22.0):** `npm ci && npm run lint` clean; `npx vitest run` 159/159; brief's throwaway site from the checkout: build + validate clean, both `diff -r` identical, `npx nera update` reports all four `unchanged`.
- **Links:** all 18 nera.js.org URLs in `skills/` return 200 (the cloud could not fetch them).
- **Review hints checked:** simple-page-list items spread `meta` (cover `image` reachable) ✓; tags 3.2.x has `group_by_lang` ✓; `linkListNav(elements, className, rootPath)` ✓; `src/plugins/<name>/index.js` matches `template/AGENTS.md` ✓.
- **Review findings:** none blocking. `src/skill.js` `mirror()` turns a user-symlinked `nera/` folder into a copy — accepted (folder is Nera-owned).

### Decisions
- `syncSkill({ cwd, sourceDir })` → `[{ path, action: created|updated|unchanged }]`; printing in the commands.
- Update source: installed `node_modules/@nera-static/nera/skills/nera` (read after `npm update`) if it has `SKILL.md`, else the running CLI's.
- Exact mirrors, write only on change, stale files removed, nothing outside the two `nera/` folders touched; no `SKILL.md` in source → packaging-bug error.
- Two folders, no third. Skill names only today's commands. Link test skips code spans/fences. Test parses frontmatter with hoisted `yaml`. Soft size guards (SKILL < 200 lines, recipe ≤ 80).

### Carry forward
- `bin/nera.js:15` usage line lacks `nera new --no-install` (works in `src/commands/new.js:17`).
- `nera-plugin-search` `search.pug`: own `h1` + unlabelled search input → `a11y-h1`/`a11y-form-label` on every site using it as published.
- `.claude/issue-conventions.md` boot command: `npm install <checkout>` symlinks, plugins then fail to load; `--install-links` works.

## Triage (2026-10-12)

| # | item | verdict |
|---|---|---|
| 1 | `--no-install` missing from `nera new` usage | fix (usage + README row + skill wording) |
| 2 | plugin-search template a11y warnings | file (`[nera-plugin-search]`, other repo) |
| 3 | issue-conventions boot command symlinks | fix (`--install-links`) |

User approved 2026-10-12.
