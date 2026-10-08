# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
