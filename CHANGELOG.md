# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
