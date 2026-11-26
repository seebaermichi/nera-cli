# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.29.0] - 2026-11-26

### Added

-   `nera new --starter blog` on a terminal asks which blog: `Blog` (`@nera-static/starter-blog`, the plain blog on `@nera-static/theme-blog` 2.x), `Blog for developers` (`stack`), `Photo blog` (`ansitz`) or `Travel blog` (`umwege`). Enter or the end of input takes the plain blog; a number or a name picks another; Ctrl-C cancels with nothing created. It is the only question asked, as with any `--starter`. With `--yes` or without a terminal (scripts, CI, AI agents), `--starter blog` stays the plain `@nera-static/starter-blog`, unchanged.
-   The starter names `stack`, `ansitz` and `umwege` (`@nera-static/starter-stack`, `starter-ansitz`, `starter-umwege`) are in the bundled starter list, so the "What are you building?" picker offers them also when the npm registry cannot be reached, and `listCatalog('starters')` falls back to them. The bundled description of `blog` now names its four sample posts and their series.
-   The scaffold's `AGENTS.md` (written by `nera new` and, in its CLI-owned part, by `nera update`) and the bundled `nera` skill name the three new starters next to `blank`, `blog`, `business` and `portfolio`; the skill's blog recipe names all four blogs.

## [1.28.0] - 2026-11-22

### Added

-   The programmatic API exports `renderDeployWorkflow({ target })`, which returns the deploy workflow `nera publish` writes as `.github/workflows/deploy.yml`, as text and byte for byte (generated first line included), so another tool, such as Nera Pro, can commit the same file and a later `nera publish` to the same target leaves it unchanged. `target` is a `--target` id, `github-pages` (default) or `netlify`; an unknown id rejects with a message naming the available ones. It also exports `basePathOf(htmlUrl)`, the `base_path` a site served at that URL needs (`/site` for `https://octo.github.io/site/`, `''` at the root). The workflow `nera publish` writes is unchanged.

## [1.27.2] - 2026-11-21

### Fixed

-   `nera dev` now reloads an open browser tab after every successful rebuild, as README, the bundled skill and the scaffold's start page promise. The rebuild deletes and rewrites `public/`, the folder Vite serves, and Vite's file watcher did not reliably notice that, so the page stayed on the old build until a manual reload (seen in Safari). Each successful rebuild now sends Vite's `full-reload` message to the connected tabs itself; a failed build leaves the tab as it is, and the terminal shows the error.

## [1.27.1] - 2026-11-21

### Fixed

-   The GitHub Pages workflow `nera publish` writes (`.github/workflows/deploy.yml`) failed in "Deploy to GitHub Pages" on every run: its deploy job uploaded the `github-pages` artifact and deployed it in the same job, and `actions/deploy-pages` could not find that artifact yet (GitHub #18). The build job now uploads `public/` as `github-pages` (`actions/upload-pages-artifact`, still named "Upload the built site"), and the deploy job only configures Pages and deploys; the build job keeps `contents: read`. A site that published to GitHub Pages runs `nera publish` again, which rewrites the generated workflow (one you took over, without the generated first line, is kept); `nera update` does not change it. The Netlify workflow is unchanged.

## [1.27.0] - 2026-11-19

### Added

-   `nera publish --json` writes a machine-readable event as one JSON line on stderr for each step that waits for the user in the browser: `{"event":"action_required","action":{"kind":"github_sign_in","code","url"}}` for the GitHub sign-in (the code to enter and its page), `github_app_install` and `netlify_sign_in` with the page to open (`url`), and `{"event":"action_done","kind":…}` once the step is done. Each comes right after the log line that says the same, which stays as it was; stdout still holds only the one result object, and text mode writes no event. No event carries a token or GitHub's device code. An agent or the MCP server can follow the sign-in without parsing the log wording.

## [1.26.0] - 2026-11-19

### Added

-   `nera add <plugin>` adds an official plugin in one step: it runs `npm install @nera-static/plugin-<name>`, copies the plugin's default `config/<name>.yaml` into the site's config folder when the site has none (an existing file is kept as it is), and runs the plugin's `publish-template.js` binary when it ships one, which copies its templates into `theme/views/vendor/plugin-<name>/`. The plugin is `<name>`, `plugin-<name>` or `@nera-static/plugin-<name>` (e.g. `nera add sitemap`); another scope, a version, a path or `plugin-utils` is refused before npm runs, and so is a folder that is no thin Nera site. `--json` prints one object, `{ ok, plugin, config: { file, status }, templates }` (`status` `copied | kept | none`, `templates` `published | none`), with npm's and the binary's output on stderr.
-   `addPlugin(spec, { cwd, log, env, signal })` in the programmatic API: what `nera add` does, returning the `--json` object without `ok`. It never prompts and writes nothing to stdout.

### Changed

-   The scaffold's `AGENTS.md` (new sites, and existing ones on `nera update`), the bundled skill `SKILL.md` and its recipes (blog, business site, contact form, images, portfolio, search) add plugins with `npx nera add <name>` instead of `npm install` followed by the plugin's own `npx nera-<name>`. The blog and portfolio recipes now read the post or project list from `app.pageList.posts` / `app.pageList.projects`, the shape the copied default `config/simple-page-list.yaml` (`page_paths`) produces.

## [1.25.0] - 2026-11-18

### Added

-   `createSite` from the programmatic API takes `env` and `signal`. `env` (default `process.env`) is the environment of every child it starts — `npm --version`, the starter download's `npm pack` and `tar`, and `npm install` — so a host can put a bundled npm first on the `PATH` without patching its own `process.env`. `signal` (an `AbortSignal`) kills the running child and rejects with `signal.reason`; an abort during the download, the copy or the install removes a new site folder, while `.` keeps everything and the error names what was written. A failed install without an abort still keeps the folder.

### Changed

-   `createSite` no longer blocks the event loop: the starter download and `npm install` run as asynchronous children instead of `execFileSync`, so a host such as an MCP server keeps answering while a site is created and can let `createSite` run its own install (with a `theme` from npm, it names the theme package, so `package.json` gets a caret range). `nera new`'s output, prompts and exit codes are unchanged.

## [1.24.0] - 2026-11-18

### Added

-   A programmatic API: `import { … } from '@nera-static/nera'` (an `exports` map; `@nera-static/nera/package.json` still resolves, and the bin and `skills/` are still reached by path). It exports `listCatalog(kind)` for the starter, theme and plugin catalogs on npm (official `@nera-static/*` packages first, then third-party ones; starters fall back to the bundled official list offline, themes and plugins throw a `CatalogError`), `listStarters` and `BUNDLED_STARTERS`, `createSite(projectName, { cwd, starter, theme, name, lang, install, log })` → `{ dir, firstSteps }`, which never prompts and writes nothing to stdout (progress to `log`, default stderr; `npm install`'s output to stderr), and `validate({ cwd })`, `check({ cwd })` and `hasErrors` for the validator's records. Building, `dev`, `serve` and `publish` stay with the `nera` bin. Importing the API loads neither vite nor chokidar. See "Programmatic API" in the README.

### Changed

-   `nera new`'s starter picker reads the same catalog as the API: it also lists an official `@nera-static/starter-*` that lacks the `nera-starter` keyword, and offline its bundled starters show their description without the label prefix.

## [1.23.0] - 2026-11-18

### Added

-   A site from `nera new` (also with `--starter` or `--theme`) ships the scoped `overrides` block from `@nera-static/core`'s README in its `package.json`, so `npm audit` reports no GHSA-3g3m-2fjr-6pw4 (`glob`) or GHSA-g3hv-75wg-m249 (`minimatch`) through `js-beautify` 2.0.3, which `npm audit fix` cannot resolve. The block replaces only the copies under `js-beautify` (`glob` ^14.0.2, and `minimatch` ^11.0.1 under its `editorconfig`), never the `minimatch` other tools use, and every page renders the same. It is temporary: remove it once a core release names a fixed `js-beautify` in its changelog. `nera update` neither adds nor removes it; an existing site follows core's README.

## [1.22.0] - 2026-11-18

### Added

-   The deploy workflow `nera publish` writes keeps `.nera-cache` between runs: the build job restores it with `actions/cache` before `npm run build`, so a site using `@nera-static/plugin-images` re-encodes only new or changed images instead of every image on every push. The cache key follows the site's and a local theme's `assets/`, `pages/`, `config/images.yaml` and `package-lock.json`, and a changed key starts from the newest earlier cache. A site without a `.nera-cache` folder only gets a warning from the cache step, never a failed build. An existing site gets the step on its next `nera publish`, as long as its workflow still starts with the line `nera publish` writes.

## [1.21.1] - 2026-11-18

### Fixed

-   `nera new`, `nera update` and `nera new --starter <package>` work on Windows. They started npm as `npm`, which Windows names `npm.cmd` and Node spawns only through a shell, so the install step, the update and a starter from npm failed there; every npm call now goes through one helper that runs `npm.cmd` through `cmd.exe` with each argument quoted. The check that npm is at least 10.9 now runs on Windows too, where it was silently skipped.
-   A starter from npm is unpacked with relative paths, so a GNU tar on Windows (Git for Windows) no longer reads the drive letter of an absolute path as a remote host.

## [1.21.0] - 2026-11-18

### Added

-   `nera publish` without `--target` and without a target in `config/publish.yaml` asks on a terminal "Is this a site for a business?" (Enter: no) and then where to publish, with the targets numbered and each with one line on what it suits: Netlify is recommended for a business, since its terms allow commercial sites on the free plan and GitHub Pages' do not, and GitHub Pages otherwise; Enter takes the recommended one. The choice is kept in `config/publish.yaml` like `--target`. Ctrl-C cancels before anything is signed in to or written. With `--yes`, `--json` or without a terminal nothing is asked, and the target stays GitHub Pages.
-   `nera publish --target <other>` on a site already published to the other host says it moved the site: the new host is set up and the workflow's deploy job swapped as before, the old host is left untouched, and the CLI prints how to remove the site there (GitHub Pages: "Unpublish site" in the repository's Pages settings; Netlify: delete the site in app.netlify.com, and the repository secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` are no longer used) and that a custom domain points to the old host until its DNS records change. `--json` reports the old target's id as `movedFrom`. `nera --help`, the README and the `nera` skill describe the question and the move.

### Fixed

-   `nera publish` writes the new `target` to `config/publish.yaml` only once the host is set up, so a move whose set-up fails (for example a refused Netlify sign-in) keeps the old target.

## [1.20.0] - 2026-11-18

### Added

-   `nera publish --target netlify` deploys the site to Netlify. GitHub Actions still builds it as for GitHub Pages; only the deploy job differs. `nera --help`, the README, the site's `AGENTS.md` and the `nera` skill (with its custom-domain recipe) describe the target. What is in place:
    -   Sign-in through Netlify's ticket flow with the "Nera CLI" Netlify OAuth app: the CLI says who runs the app, prints the authorize link (and opens it in a terminal), links Netlify's sign-up page if you have no account, waits for "Authorize" and prints "Signed in to Netlify as `<email>`". With `--yes`, `--json` or without a terminal, nothing is ever asked.
    -   The Netlify token is kept in the operating system's keychain, else in `~/.config/nera/netlify-credentials.json`, readable only by you. `NERA_NETLIFY_TOKEN` takes precedence over both and is never written. A stored token Netlify no longer accepts leads to a new sign-in. `nera publish --sign-out` removes the stored GitHub and Netlify tokens and links the Netlify page where you revoke the app.
    -   The Netlify site is created through Netlify's API, named after the repository and with no repository link, so Netlify's own build never runs. A name that is taken gets a short random suffix. Its id is kept in `config/publish.yaml` (`netlify: { site_id }`), so later runs reuse the site.
    -   `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` are stored as encrypted secrets of the GitHub repository on every run, sealed for the repository's public key through the new dependencies `@noble/curves`, `@noble/ciphers` and `@noble/hashes`. The token is never logged, printed or written into the site.
    -   The deploy job of the generated workflow zips `public/`, uploads it to Netlify's zip deploy API with curl and waits until Netlify reports the deploy ready, or fails with Netlify's error. No third-party action and no netlify-cli are used.
    -   `base_path` is removed from `config/app.yaml`, since Netlify serves the site from the root. The live URL is the custom domain once one is set, else the site's `https://<site>.netlify.app` address.
    -   Netlify's free plan has 300 credits a month and a production deploy costs 15 of them. The first set-up says so; later runs count this month's production deploys of the site and warn before the push once they reach 80 % of the budget. Bandwidth and your other Netlify sites are not counted, and the warning says so.
    -   `--domain <host>` sets the custom domain of the Netlify site and checks its DNS on every run: an `A` record `75.2.60.5` for an apex domain, a `CNAME` to `<site>.netlify.app` for a subdomain. Missing or wrong records are printed with what to set and never stop the publish; Netlify issues the certificate by itself. A domain Netlify refuses, such as one another Netlify site uses, is an error that says where to remove it.

### Changed

-   `nera publish --domain` refuses a `netlify.app` address (the site's own Netlify address, or any other) for every target, as it refuses a `github.io` one, and says to publish without `--domain` to use the host's own address.

### Fixed

-   The DNS check of `nera publish --domain` tells an apex domain from a subdomain by its SOA record, for GitHub Pages and Netlify alike: a name with its own SOA, such as `example.co.uk`, gets the host's `A` records, and `www.example.com` gets the `CNAME`. It used to treat every name of more than two labels as a subdomain. When the SOA lookup fails, it falls back to that rule: two labels are an apex.

## [1.19.0] - 2026-10-26

### Added

-   The GitHub sign-in of `nera publish` is kept in the operating system's keychain, through the new optional dependency `@napi-rs/keyring`. Where there is no keychain (headless Linux, CI, or an install that skipped the optional dependency), it goes to `~/.config/nera/credentials.json`, readable only by you. `NERA_GITHUB_TOKEN` takes precedence over both and is never written.
-   `nera publish`, the part every host shares. `nera --help`, the README, the site's `AGENTS.md` and the `nera` skill name the command and its flags (`--target`, `--repo`, `--domain`, `--private`, `--yes`, `--json`, `--sign-out`). What is in place:
    -   Sign-in through the "Nera Static" GitHub App's device flow: the CLI says who runs the app, links nera.js.org and explains how to create a GitHub account if you have none (it waits, it never creates one). It prints the code, opens github.com/login/device in a terminal, prints "Signed in as `<login>`", and refreshes an expired token by itself. `nera publish --sign-out` deletes the stored token and links the GitHub page where you revoke the app.
    -   Before the app touches a repository, the CLI says what it may do and sends you to its installation page if it is not installed, then waits.
    -   The repository is created under your account (named after the site folder, or `--repo <name>`; public unless `--private`, which GitHub Pages only serves on a paid plan), or the one recorded in `config/publish.yaml` is reused. A name that is already taken is an error that names `--repo`.
    -   A generated `.github/workflows/deploy.yml` builds the site (`npm ci`, `nera build`) and deploys it on every push to `main`. Once you remove its generated header line, the file is yours and `nera publish` leaves it alone.
    -   The site is committed and pushed with git when it is installed, else through the GitHub API, so git is not required. The token never appears in a command line, `.git/config` or a remote URL, and a remote that changed elsewhere is never overwritten.
    -   The Actions run for the pushed commit is followed until it finishes; a failure names the failing step, shows an excerpt of its log up to the first error and suggests a fix.
    -   `--json` prints one JSON object on stdout and logs on stderr. With `--yes` or without a terminal, nothing is ever asked.
-   `nera publish` deploys to GitHub Pages (`--target github-pages`, and the default when no target is named). Netlify arrives in a following release.
    -   GitHub Pages is switched on for the repository with the GitHub Actions build type before the first push. A Pages site that already exists is reused; one that deployed from a branch is switched to GitHub Actions, with a log line. On a free plan GitHub refuses Pages for a private repository, and the error says so.
    -   The deploy job of the generated workflow hands the built `public/` folder to GitHub Pages (`configure-pages`, `upload-pages-artifact`, `deploy-pages`) in the `github-pages` environment.
    -   `base_path` in `config/app.yaml` follows the address GitHub Pages reports: `/<repo>` for a project page, removed for a `<user>.github.io` repository or a custom domain. Comments and the other keys stay as they are, and a change is logged.
    -   `--domain <host>` sets the site's custom domain in the GitHub Pages settings; no `CNAME` file is written, since GitHub ignores one for a site an Actions workflow deploys. A URL, a path, a port, an IP address or a `github.io` name is refused before sign-in, saying what to pass. A later run without `--domain` keeps the domain, and once GitHub has issued the domain's certificate, the next run switches on "Enforce HTTPS"; until then each run says so and goes on.
    -   Whenever the Pages site has a custom domain, its DNS is checked: `A` (and optional `AAAA`) records for a bare domain, a `CNAME` to `<user>.github.io` for any other. Missing or wrong records are printed with what to set; they never stop the publish, since DNS changes take hours to spread.
    -   The live URL is printed (`Live at …`) and is the `url` of the `--json` object.

## [1.18.0] - 2026-10-25

### Added

-   The site's `AGENTS.md` names the command that starts another site from a starter, `npx @nera-static/nera new <name> --starter <blank|blog|business|portfolio> --name "<site name>" --lang <code> --yes`, and says that with `--yes` or without a terminal it never asks.
-   The `nera` skill's first workflow step starts from an official starter with `--starter` (one line each for `blank`, `blog`, `business` and `portfolio`) and names `--name`, `--lang` and `--yes`. The `business-site`, `blog` and `portfolio` recipes start from their starter as the fast path and keep the hand-built steps, which produce different files.
-   `nera update` brings both texts to existing sites: it refreshes the Nera part of `AGENTS.md` (the notes below the "Notes for this site" marker stay as they are) and replaces the `nera` skill.

### Changed

-   `AGENTS.md` no longer says that the site's pages use `pages/default.pug`, which was not true for a site created from the blog, business or portfolio starter; it says to copy the `layout` from a similar page.
-   The `nera` skill's list of published plugins names `consent` and `feed`, and its advice not to hand-write a feature a plugin covers names a feed and a consent banner.

## [1.17.0] - 2026-10-25

### Added

-   The bundled starter list, which `nera new` shows when the npm registry cannot be reached, offers `portfolio` (`@nera-static/starter-portfolio`): a designer's portfolio on `@nera-static/theme-business` with project pages, image galleries, a contact form and a sitemap.
-   The README names the `portfolio` starter next to `blank`, `blog` and `business`.

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
