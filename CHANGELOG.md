# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.16.1] - 2026-10-23

### Fixed

-   With `--theme`, `nera new` keeps the imprint and privacy placeholders and says, after "Using theme", that the theme's layout must link them (theme-blog and theme-business take `footer_links` in `config/theme.yaml`), or `nera build --check` keeps the two `legal-*` warnings. The site's `AGENTS.md` says those warnings are expected until the placeholders are filled and linked.

## [1.16.0] - 2026-10-23

### Added

-   A new site without a theme or starter passes `nera build --check` with zero findings. The scaffold layout starts with a skip link to `main#main` (labelled by `t('skip_to_content')`) and ends with a footer linking `/imprint.html` and `/privacy.html`, and the scaffold ships `pages/imprint.md` and `pages/privacy.md` as clearly marked placeholders to replace before publishing. The labels sit in `translations.en` in `config/app.yaml`. Existing sites are unchanged: `nera update` leaves layouts, pages and config alone.
-   The site's `AGENTS.md` says to replace the imprint and privacy placeholders before deploying, and the `business-site` recipe of the `nera` skill starts from them; `nera update` brings both texts to existing sites.

### Changed

-   `AGENTS.md` no longer quotes the page template's exact `main` markup, so its text is true for sites created before and after this release.

## [1.15.0] - 2026-10-19

### Changed

-   `nera update` raises the caret range of each updated Nera package in `package.json` to the version npm installed (`^1.0.0` → `^1.15.0`) and prints each change; `npm update` installs within a range but never rewrites it. The root entry of `package-lock.json` follows, so `package.json` and the lockfile stay in sync. Only a plain `^x.y.z` (x ≥ 1) is raised, only upwards and never across a major; exact, tilde, tag, git and 0.x ranges stay as they are, and the file keeps its indentation.

## [1.14.1] - 2026-10-19

### Fixed

-   `nera new` and `nera update --migrate` write `@nera-static/nera` as a caret range from the CLI's own version (`^1.14.1`), not `^1.0.0`. The old range claimed a site worked with versions that lack what set it up: starters, `nera check` and the `validate`/`check` scripts. Existing sites are unchanged: `nera update` (`npm update`) installs the newest 1.x but keeps the range in `package.json` as it is.
-   The README's example of a scaffolded site's `package.json` shows the `validate` and `check` scripts.

## [1.14.0] - 2026-10-18

### Added

-   The bundled starter list, which `nera new` shows when the npm registry cannot be reached, offers `business` (`@nera-static/starter-business`): a small-business site on `@nera-static/theme-business` with services, opening hours, a contact form and a sitemap.
-   The README names the `business` starter next to `blank` and `blog`.

## [1.13.0] - 2026-10-16

### Added

-   New sites get `npm run validate` (`nera validate`) and `npm run check` (`nera build --check`) in their `package.json`, with or without a starter. Existing sites are unchanged.
-   `nera new` refuses to start, before it asks or writes anything, when it would run `npm install` with npm older than 10.9.0, and names the fix: Node.js 22.12 or later, or `npm i -g npm@10.9`. npm 10.8 (bundled with Node 20) crashes in arborist on the optional peers of vite 8, which every site installs. With `--no-install` npm is not checked; when its version cannot be read, `nera new` goes ahead as before.

### Changed

-   `nera new --starter` prints only the `## First steps` section of the starter's README (up to the next `#` or `## ` heading), not the whole file with its badges and reference sections. A starter README without that section prints nothing.
-   `engines.node` is `>=22.12.0`, documenting the real floor: on Node 20 the bundled npm cannot install a new site. Node 22.12 bundles npm 10.9.

## [1.12.0] - 2026-10-15

### Added

-   The bundled starter list, which `nera new` shows when the npm registry cannot be reached, offers `blog` (`@nera-static/starter-blog`): a blog on `@nera-static/theme-blog` with sample posts, tags, an archive, an Atom feed and a sitemap.
-   The README names both official starters, `blank` and `blog`, instead of "the official starters are coming".

## [1.11.1] - 2026-10-14

### Fixed

-   The bundled starter list, which `nera new` shows when the npm registry cannot be reached, describes `blank` as `@nera-static/starter-blank` 1.0.0 ships it: a home page, imprint and privacy placeholders and one accessible layout, with no theme, plugins or JavaScript. It said "one page, one layout".

## [1.11.0] - 2026-10-13

### Added

-   `nera new --starter <spec>` starts a site from a starter kit: a bare name (`blank` → `@nera-static/starter-blank`), a package name (`@acme/starter-x`, `nera-starter-x`), a GitHub URL (`https://github.com/owner/repo#ref`, `github:owner/repo`) or a local path. The starter's `pages/`, `config/`, `theme/`, `assets/`, `plugins/` and `.neraignore` are copied over the base template, its `dependencies` are added to the site's `package.json`, and its README is printed. Packages and repositories are downloaded with `npm pack --ignore-scripts`. A package without a `nera.starter` field in its `package.json` is refused before anything is written. `--starter` and `--theme` together are an error.
-   `nera new --name "<site name>"` and `--lang <code>` set `name:` and `lang:` in `config/app.yaml`, with or without a starter. A new language gets a copy of the current language's `translations:` entry, ready to translate, so no page shows a raw translation key.
-   On a terminal, `nera new` without `--starter` asks what you are building (starters from the npm registry with the keyword `nera-starter`, official ones first, or a bundled list when offline), the site name and the language; Enter keeps each default. `--yes` skips every question; without a terminal nothing is ever asked and `nera new` behaves as before.

## [1.10.1] - 2026-10-13

### Changed

-   The skill's search recipe follows `@nera-static/plugin-search` 2.3.0, whose template labels its input and can leave out its own `h1`: the search page keeps its `# Search` heading with `show_title: false` in `config/search.yaml`, and no hand-added `aria-label` is needed. It names the `search_label`, `search_title` and `search_placeholder` translation keys. `nera update` brings the new recipe into a site's skill folders.

## [1.10.0] - 2026-10-12

### Added

-   The `nera` Agent Skill for AI assistants, shipped in the package under `skills/nera/`: a `SKILL.md` with the workflow (scaffold, content, plugins, `nera validate`, `nera build --check`, deploy `public/`) and eight short recipes (business site, blog, portfolio, contact form, search, images, multilingual site, custom domain) that link the docs on nera.js.org.
-   `nera new` copies the skill into `.agents/skills/nera/` (Codex, Cursor, Copilot, Gemini CLI) and `.claude/skills/nera/` (Claude Code), with or without `--theme` and for `nera new .`.

### Changed

-   `nera update` (and `nera update --migrate`) also keeps both skill folders an exact copy of the installed `@nera-static/nera`'s skill: it adds missing files, rewrites changed ones and removes stale ones, only inside the two `nera/` folders. It writes nothing when they are current.
-   The usage text and README list `--no-install` for `nera new`, which already skipped `npm install` but was undocumented.

## [1.9.0] - 2026-10-12

### Added

-   `nera validate --json`, `nera check --json` and
    `nera build --check --json` print one JSON object on stdout and
    nothing else, for AI agents and scripts: `{ "ok", "results" }`, where
    `results` is the validator's list of `{ file, line, severity, rule,
    message }` and `ok` is `true` exactly when the exit code is `0`. When
    the command cannot run (no `public/`, a failed build) the object is
    `{ "ok": false, "error", "results": [] }` with exit code `1`. The
    build log and plugin output go to stderr; exit codes are the same as
    without `--json`. `nera build --json` alone prints
    `{ "ok": true, "results": [] }` after a successful build.
-   The scaffold's `AGENTS.md` names the `--json` commands and their shape.
    `nera update` adds the line to existing sites too, since it sits in
    the Nera-owned part above the site-notes marker.

## [1.8.0] - 2026-10-11

### Added

-   The scaffold's `AGENTS.md` links https://nera.js.org/llms.txt and
    https://nera.js.org/llms-full.txt next to the docs, so an AI assistant
    finds the whole documentation as Markdown. `nera update` adds the line
    to existing sites too, since it sits in the Nera-owned part above the
    site-notes marker.

## [1.7.1] - 2026-10-11

### Changed

-   README shows the Test workflow and npm version badges under the title, like every other Nera package.

## [1.7.0] - 2026-10-11

### Added

-   `nera update` now also keeps a site's `AGENTS.md` and `CLAUDE.md`
    current, with no extra flag. After a successful package update (and
    after `nera update --migrate`) it creates either file when it is
    missing, so sites made before 1.6.0 get them too. In an existing
    `AGENTS.md` it replaces only the part above the first line starting
    with `<!-- nera:site-notes`, taken from the installed
    `@nera-static/nera`'s template; that line and everything below it are
    kept byte for byte. An `AGENTS.md` without the line is left alone with
    a hint on how to opt in, and an existing `CLAUDE.md` is never touched.
    Files are written only when their content changes, so a repeated
    `nera update` changes nothing.

## [1.6.0] - 2026-10-10

### Added

-   `nera new` writes `AGENTS.md` and `CLAUDE.md` into every new site, with
    or without `--theme` and in place with `nera new .`. `AGENTS.md` tells
    an AI assistant (Codex, Cursor, Copilot, Claude Code, …) what Nera is,
    where things live, which commands to run, the traps (a page without
    `layout` is skipped, `public/` is regenerated, URLs end in `.html`) and
    to run `nera validate` and `nera build --check` after every change.
    It ends with a "Notes for this site" section that belongs to the site
    owner, behind a `<!-- nera:site-notes … -->` marker line. `CLAUDE.md`
    is the single line `@AGENTS.md`, so Claude Code reads the same text.
    Existing sites are not changed.
-   `nera new .` also works in a folder that holds only an `AGENTS.md`
    and/or `CLAUDE.md`, as when an AI assistant wrote them before
    scaffolding. Both files are kept as they are ("Kept your existing …");
    any other file still makes the folder count as not empty.

## [1.5.1] - 2026-10-10

### Fixed

-   `nera new`: the "Next steps" say `npm run dev` instead of `nera dev`,
    which only worked with a global `nera`, and list `npm install` when it
    ran with `--no-install`.
-   `nera new .`: the package name taken from the folder now folds `ß`, `æ`,
    `œ`, `ø`, `ł` and `đ` (`Straße` → `strasse`, not `stra-e`), stops at
    npm's 214 characters and falls back to `nera-site` for the names npm
    refuses (`node_modules`, `favicon.ico`).

## [1.5.0] - 2026-10-10

### Added

-   `nera new .` scaffolds into the current folder instead of creating a
    subfolder — the natural move when the folder already exists, for example
    one an AI assistant was started in. The folder must be empty apart from
    dotfiles (`.git`, editor folders); anything else is refused before a
    single file is written. An existing `.gitignore` is kept, with one line
    saying so. The package is named after the folder, normalised to a valid
    name (`My Bakery` → `my-bakery`), and the "Next steps" leave out the
    `cd`. `nera new <name>` is unchanged.

## [1.4.1] - 2026-10-09

### Changed

-   `nera new`: the scaffolded `.gitignore` now lists `.nera-cache`, the
    build cache of `@nera-static/plugin-images`, so generated image variants
    are never committed

## [1.4.0] - 2026-10-09

### Changed

-   **`engines.node` corrected from `>=20.0.0` to `^20.19.0 || >=22.12.0`.**
    `vite` 8, which runs `nera dev` and `nera serve`, declares exactly that
    range, and `@nera-static/core` pulls in `entities@8` (`>=20.19.0`); the
    old range claimed support the dependency tree does not, and installing on
    an older Node printed `EBADENGINE` warnings. This documents the real
    floor rather than removing working support; Node 20 itself reached end
    of life on 2026-04-30. If you are below it, upgrade Node (22 LTS
    recommended).

## [1.3.1] - 2026-10-09

### Changed

-   README: `ignore` in `config/validate.yaml` (from `@nera-static/validate`
    1.3.0) silences a rule on whole files or folders, for `nera validate` too
    — e.g. `layout-missing` on content fragments and drafts.

## [1.3.0] - 2026-10-09

### Added

-   `nera check`: checks the built `public/` for accessibility, privacy and
    legal-notice problems with `validateOutput` from `@nera-static/validate`
    — hints, all warnings by default, configured in `config/validate.yaml`.
    Exits 1 only when a finding has the level `error`; without `public/` it
    stops with "run `nera build` first". The report ends with the reminder
    that a clean run is not proof of compliance. `nera validate` is unchanged
    and checks the sources only.
-   `nera build --check`: build, then `nera check` — one command for CI.

### Changed

-   Requires `@nera-static/validate` ^1.2.0 (for `validateOutput`).

## [1.2.0] - 2026-10-08

### Added

-   `nera dev` rebuilds on changes to a local theme (`theme: ./themes/classic`
    in `config/app.yaml`, or the same via `NERA_THEME`). It watched only
    `pages/`, `config/` and `theme/`, so editing a theme kept outside those
    meant restarting the server. The theme's `views/`, `assets/` and
    `config/` are watched, and a theme switched in `app.yaml` mid-session is
    picked up after the next rebuild. Installed theme packages under
    `node_modules` are not watched.
-   `NERA_THEME` (from `@nera-static/core` 4.12.0) overrides `theme:` for one
    run of `nera build`, `nera dev` or `nera validate`:
    `NERA_THEME=./themes/classic nera dev`.

### Changed

-   Requires `@nera-static/core` ^4.12.0.

## [1.1.0] - 2026-10-08

### Added

-   `nera new <name> --theme <name>` (also `--theme=<name>`) starts a site from
    a theme: it adds the theme package as a dependency (a bare name maps to
    `@nera-static/theme-<name>`; a scoped package or a local `./path` works
    too), sets `theme:` in `config/app.yaml`, and leaves out the starter
    templates. Site views win over theme views file by file, so the starter
    `layouts/layout.pug` and `pages/default.pug` would otherwise hide the
    theme's own and the site would look unthemed.
-   The starter templates now begin with a `//- nera:scaffold-default` line.
    `nera validate` (via `@nera-static/validate` 1.1.0+) warns with
    `theme-shadowed` while a file carrying it hides a theme's file of the same
    name. The line renders nothing.

## [1.0.1] - 2026-10-08

### Fixed

-   `README.md` Commands table was missing `nera validate`, which the CLI has
    shipped since 1.0.0.
-   `README.md` migration section said local plugins are moved from
    `src/plugins/` to `plugins/` but not that `config/app.yaml` then needs
    `folders.plugins: ./plugins` for the engine to find them — the step
    `nera update --migrate` itself prints as a warning. It now shows that
    snippet, and notes that a root `views/`/`assets/` keeps building with a
    deprecation warning until moved under `theme/`. Documentation only.

## [1.0.0] - 2026-07-24

Initial release — the one Nera CLI, over the `@nera-static/core` engine. Slice 2
of the core consolidation (`ROADMAP-core.md`): it subsumes the scaffolding and
update roles of `@nera-static/installer`, and a scaffolded site depends on this
one package instead of being a git clone of the generator.

### Added

-   `nera new <name>` — scaffold a thin Nera site from the bundled template
    (one dependency: `@nera-static/nera`; no vendored engine, no clone). Reuses
    the installer's strict project-name validation.
-   `nera build` — render `pages/` → `public/` via `@nera-static/core`'s `run()`.
-   `nera dev` — build once, serve `public/` with Vite, and rebuild on changes to
    `pages/`/`config/`/`theme/`, coalescing changes that land mid-build. The code
    form of the generator's old `concurrently` dev script.
-   `nera serve` — serve the built `public/` folder with Vite (no rebuild).
-   `nera update` — `npm update` the site's `@nera-static/*` packages. On a legacy
    cloned site (vendors the engine under `src/`, no `@nera-static/nera`
    dependency), `nera update --migrate` converts it to the thin model: adds the
    dependency, rewrites scripts, moves `src/plugins/` → `plugins/`, removes the
    vendored `src/` and root `index.js`, and installs — leaving `pages/`,
    `config/` and `theme/` untouched.
-   Bundled scaffold template under `template/` (thin `package.json`, `config/`,
    `pages/`, `theme/views` + `theme/assets`), shipped in the published package.
