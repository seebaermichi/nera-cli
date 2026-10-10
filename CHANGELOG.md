# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
