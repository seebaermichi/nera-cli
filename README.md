# @nera-static/nera

[![Test](https://github.com/seebaermichi/nera-cli/actions/workflows/test.yml/badge.svg)](https://github.com/seebaermichi/nera-cli/actions/workflows/test.yml)
[![npm version](https://img.shields.io/npm/v/@nera-static/nera)](https://www.npmjs.com/package/@nera-static/nera)

The Nera CLI — scaffold, build, preview and update a [Nera](https://github.com/seebaermichi/nera)
static site with a single command. It runs over the [`@nera-static/core`](https://github.com/seebaermichi/nera)
engine and is the one package a Nera site depends on.

📖 **Documentation:** [nera.js.org](https://nera.js.org)

## Quick start

```bash
npx @nera-static/nera new my-site
cd my-site
npm run dev            # or: nera dev
```

Already in the folder the site should live in? `nera new .` scaffolds into the
current folder instead. The folder must be empty apart from dotfiles such as
`.git` and an `AGENTS.md`/`CLAUDE.md` an AI assistant may have written first
(an existing `.gitignore`, `AGENTS.md` or `CLAUDE.md` is kept), and the
package is named after the folder (`My Bakery` → `my-bakery`).

## Commands

| Command | What it does |
|---|---|
| `nera new <name>` | Scaffold a new thin Nera site (one dependency: `@nera-static/nera`). Add `--starter <spec>` to start from a starter kit or `--theme <name>` to start from a theme (not both), `--name "<site name>"` and `--lang <code>` to set `name:` and `lang:` in `config/app.yaml` (a new language gets a copy of the current language's `translations:` entry to translate), `--no-install` to skip `npm install`. On a terminal, without `--starter` or `--yes`, it asks what you are building, the site name and the language; without a terminal it never asks. `nera new .` scaffolds into the current, empty folder (dotfiles, `AGENTS.md` and `CLAUDE.md` allowed). Every new site also gets the `nera` skill for AI assistants. |
| `nera add <plugin>` | Add an official plugin to the site: `npm install @nera-static/plugin-<name>`, copy the plugin's default `config/<name>.yaml` when the site has none (an existing file is kept as it is), and run the plugin's `publish-template.js` binary when it ships one, which copies its templates into `theme/views/vendor/plugin-<name>/` (skipped when that folder exists; `npx nera-<name> --force` overwrites it). The plugin is `<name>` or `@nera-static/plugin-<name>` (e.g. `nera add sitemap`); another scope, a version, a path or `plugin-utils` is refused before npm runs, and so is a folder that is no thin Nera site. Templates still have to be included by hand. `--json` prints one JSON object (see [Machine-readable output](#machine-readable-output)). |
| `nera build` | Render `pages/` → `public/`. With `--check`, then run `nera check` on the result — one command for CI. `--json` prints the result as one JSON object (see [Machine-readable output](#machine-readable-output)). |
| `nera dev` | Build, serve `public/`, and rebuild on change with live reload. Watches `pages/`, `config/`, `theme/` and a local theme (`theme: ./themes/<name>`). |
| `nera serve` | Serve the already-built `public/` folder. |
| `nera update` | Update the site's Nera packages and raise their caret ranges in `package.json` (and `package-lock.json`) to the installed versions, then create a missing `AGENTS.md`/`CLAUDE.md` and refresh the Nera part of `AGENTS.md` and the `nera` skill (see [Instructions for AI assistants](#instructions-for-ai-assistants)). On a legacy cloned site, `nera update --migrate` converts it to the thin model. |
| `nera validate` | Check the site's sources (layouts, includes, YAML) before publishing; exits non-zero on any error. `--json` for machine-readable output. |
| `nera check` | Check the built `public/` for accessibility, privacy and legal-notice problems (see below). Build first. `--json` for machine-readable output. |
| `nera publish` | Publish the site through GitHub: sign in with the "Nera Static" GitHub App, create (or reuse) the repository, generate `.github/workflows/deploy.yml` (its build job keeps `.nera-cache` between runs, so `@nera-static/plugin-images` re-encodes only new or changed images), push, and follow the Actions run. The host is GitHub Pages (`--target github-pages`, the default): it switches Pages on with the GitHub Actions build type, sets `base_path` in `config/app.yaml` to match the Pages address (`/<repo>` for a project page, none for a `<user>.github.io` repository or a custom domain) and prints the live URL. `--domain <host>` sets a custom domain in the Pages settings (no `CNAME` file), checks its DNS on every run and prints the records to set when they are missing or wrong; they never stop the publish. Or the host is Netlify (`--target netlify`): GitHub Actions still builds the site, and the deploy job uploads `public/` to Netlify's API, so Netlify's own build never runs. `nera publish` signs in to Netlify through the "Nera CLI" OAuth app (it prints the authorize link and opens it in a terminal, links the sign-up page if you have no account, and waits), creates the Netlify site named after the repository (or reuses the one in `config/publish.yaml`), stores `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` as encrypted repository secrets, removes `base_path` and prints the live URL (`https://<site>.netlify.app`, or the custom domain). `--domain <host>` sets the Netlify custom domain and checks its DNS (`A 75.2.60.5` for a bare domain, a `CNAME` to `<site>.netlify.app` otherwise); Netlify issues the certificate by itself. Netlify's free plan has 300 credits a month and each production deploy costs 15, so about 20 deploys use it up (bandwidth comes on top) and Netlify then pauses your sites until the next month: the first set-up says so, and later runs warn before the push once this month's deploys reach 80 % of the budget. The chosen target is kept in `config/publish.yaml`, so a later `nera publish` reuses it. Without `--target` and without a target in `config/publish.yaml`, `nera publish` on a terminal asks "Is this a site for a business?" (Enter: no) and then where to publish: Netlify is recommended for a business (its terms allow commercial sites on the free plan, GitHub Pages' do not), GitHub Pages otherwise, and Enter takes the recommended one; Ctrl-C cancels before anything is signed in to or written. With `--yes`, `--json` or without a terminal nothing is asked and the target is GitHub Pages. `nera publish --target <other>` on a site already published to the other host moves it: the new host is set up and the workflow's deploy job swapped, the old host is left untouched, and the CLI prints how to remove the site there (GitHub Pages: "Unpublish site" in the repository's Pages settings; Netlify: delete the site in app.netlify.com and the two now unused repository secrets) and that a custom domain points to the old host until its DNS records change (`--domain <host>` sets it on the new one). `--json` then reports the old target's id as `movedFrom`. `--repo <name>` names the repository (default: the folder name), `--private` makes it private (GitHub Pages serves a private repository only on a paid plan), `--yes` never asks, `--json` prints one JSON object (`url` holds the live URL), `--sign-out` removes the stored GitHub and Netlify tokens. The Netlify token is kept like the GitHub one (keychain, else `~/.config/nera/netlify-credentials.json`); `NERA_NETLIFY_TOKEN` takes precedence and is never written. |

A scaffolded site is a thin project — no vendored engine, no clone. It lists one
dependency, a caret range starting at the version of the CLI that created it,
and its scripts call the CLI:

```jsonc
{
  "scripts": {
    "dev": "nera dev", "build": "nera build", "serve": "nera serve",
    "validate": "nera validate", "check": "nera build --check"
  },
  "dependencies": { "@nera-static/nera": "^1.16.0" },
  "overrides": {
    "js-beautify": { "glob": "^14.0.2", "editorconfig": { "minimatch": "^11.0.1" } }
  }
}
```

The `overrides` block is temporary: it is the scoped override from
`@nera-static/core`'s README that keeps `npm audit` clean of GHSA-3g3m-2fjr-6pw4
(`glob`) and GHSA-g3hv-75wg-m249 (`minimatch`), which reach a site through
`js-beautify` 2.0.3 and which `npm audit fix` cannot resolve. It replaces only
the copies under `js-beautify` and changes no page. Remove it once a core
release names a fixed `js-beautify` in its changelog; `nera update` neither
adds nor removes it.

## Instructions for AI assistants

Every scaffolded site carries an `AGENTS.md`, the file Codex, Cursor, Copilot
and other assistants read first, and a `CLAUDE.md` holding the single line
`@AGENTS.md`, so Claude Code loads the same text. `AGENTS.md` covers what
Nera is, the folder map, the commands, the common traps, and the check loop:
`nera validate`, then `nera build --check`, after every change.

It ends with a **Notes for this site** section for your own instructions —
brand voice, pages not to touch, where the site is deployed. It starts below
the marker line `<!-- nera:site-notes … -->`; keep that line in place. The
part above it is Nera's and may be replaced by a later Nera version; your
notes below it are yours.

`nera update` keeps both files current, with no extra flag. After the
packages are updated (and after `nera update --migrate`) it:

- creates `AGENTS.md` and `CLAUDE.md` when they are missing, so a site made
  before 1.6.0 gets them too;
- replaces only the part of `AGENTS.md` above the first line starting with
  `<!-- nera:site-notes`, taking the new text from the installed
  `@nera-static/nera`'s template; the marker line and everything below it
  stay byte for byte as they are;
- leaves an `AGENTS.md` without that line alone and prints a hint: copy the
  marker line from the template directly above your own notes to opt in;
- never touches an existing `CLAUDE.md`.

A file is written only when its content changes, so running `nera update`
again changes nothing.

### The `nera` skill

Every site also gets the `nera` [Agent Skill](https://agentskills.io): a
`SKILL.md` with the workflow (scaffold, content, plugins, `nera validate`,
`nera build --check`, deploy `public/`) and short recipes — business site,
blog, portfolio, contact form, search, images, multilingual site, custom
domain — that assistants load when a task matches. It lives in two folders,
`.agents/skills/nera/` (Codex, Cursor, Copilot, Gemini CLI) and
`.claude/skills/nera/` (Claude Code); commit them with the site.

Both folders are Nera's: `nera new` writes them, and `nera update` (also after
`--migrate`) replaces them with the skill of the installed `@nera-static/nera`,
removing files the new version no longer has. Put your own instructions in
`AGENTS.md`'s notes section or in a skill folder of your own; other folders
under `.agents/skills/` and `.claude/skills/` are never touched. The source is
[`skills/nera/`](skills/nera/) in this repository.

## Starting from a theme

```bash
npx @nera-static/nera new my-site --theme example
```

This installs the theme (`example` → `@nera-static/theme-example`; a full
package name such as `@acme/my-theme`, or a local path such as `./my-theme`,
works too), sets `theme:` in `config/app.yaml`, and leaves out the scaffold's
starter templates.

That last part matters. A site's own `theme/views/` wins over its theme's views
**file by file** — that is how you override a single theme template. Without
`--theme`, `nera new` writes a starter `theme/views/layouts/layout.pug` and
`theme/views/pages/default.pug`, the same names a theme uses, so a theme added
later stays hidden behind them. Each starter file carries a
`//- nera:scaffold-default` first line, and `nera validate` warns
(`theme-shadowed`) while such a file hides a theme's. Delete it to use the
theme's version, or delete the marker line to keep yours.

## Starter kits

```bash
npx @nera-static/nera new my-site --starter blank --name "Brot & Zeit" --lang de
```

A starter kit is a whole ready-to-edit site: sample pages, config, optional
site-level `theme/` overrides, assets and the theme and plugins it depends on.
`nera new` copies its `pages/`, `config/`, `theme/`, `assets/`, `plugins/` and
`.neraignore` over the base template, adds its `dependencies` to the site's
`package.json`, applies `--name` / `--lang`, installs, and prints the
`## First steps` section of the starter's README (nothing, when it has none).
After that the site owns the files; a starter has no update path (the theme it
depends on still updates through npm).

`--starter` takes:

- a starter name: `blank` → `@nera-static/starter-blank`, `blog` →
  `@nera-static/starter-blog`, `business` → `@nera-static/starter-business`,
  `portfolio` → `@nera-static/starter-portfolio`;
- a package name: `@acme/starter-shop`, or unscoped `nera-starter-shop`;
- a GitHub URL: `https://github.com/owner/repo` (optionally `.git`, `#ref`),
  or `github:owner/repo#ref`;
- a local path: `./my-starter`, `../my-starter` or an absolute path.

Packages and GitHub repositories are downloaded with
`npm pack --ignore-scripts`, so no script of the starter runs. A starter is a
package whose `package.json` has a `nera.starter` field
(`{ "label": "…", "description": "…" }`); anything else is refused. One that
sets `theme:` in its `config/app.yaml` leaves out the scaffold's starter
templates, as `--theme` does.

Run `nera new my-site` on a terminal and it asks instead:

```text
What are you building?
  1) Empty — the base template, no starter
  2) …
Choose 1–2 [1]:
Site name [My Nera Site]:
Language [en]:
```

The list comes from the npm registry (packages with the keyword
`nera-starter`, official `@nera-static/` ones first), or from a short list
bundled with the CLI when the registry cannot be reached. Enter accepts the
default. Every question has a flag (`--starter`, `--name`, `--lang`); with
`--yes`, or without a terminal (scripts, CI, AI agents), nothing is asked and
`nera new` scaffolds the base template.

The official starters: `blank` (`@nera-static/starter-blank`, one accessible
layout, no theme), `blog` (`@nera-static/starter-blog`, a blog on
`@nera-static/theme-blog` with tags, an archive, an Atom feed and a sitemap),
`business` (`@nera-static/starter-business`, a small-business site on
`@nera-static/theme-business` with services, opening hours and a contact
form) and `portfolio` (`@nera-static/starter-portfolio`, a designer's
portfolio on `@nera-static/theme-business` with projects in image galleries,
an about page and a contact form).

## Checking the built site

```bash
nera build --check    # build, then check — what a CI job runs
nera check            # check an existing public/ without rebuilding
```

`nera validate` reads the sources; `nera check` reads the **built** output — the
page a visitor gets, with its layout, navigation, footer, scripts, stylesheets
and fonts — and reports what a parser can find there:

- **Accessibility** (`a11y-*`, WCAG 2.2 AA where machine-decidable): `<html
  lang>`, `<title>`, one `<h1>`, heading jumps, `alt` text, form labels, link
  names, `<main>`, a skip link, named navigations, duplicate ids, zoom blocked
  by the viewport.
- **Privacy** (`privacy-*`, DSGVO / TDDDG): resources loaded from another host
  (Google Fonts, YouTube, analytics, …), `http://` resources, and — opt-in —
  scripts using cookies or browser storage.
- **Legal notice** (`legal-*`, DDG / MStV): every page links to the imprint and
  the privacy policy, and those pages do not cite a superseded law (TMG, TTDSG,
  § 55 RStV).

Every finding is a **warning** by default, so `nera check` exits `0`; it exits
`1` only when a rule you promoted to `error` fires. Without `public/` it stops
with "run `nera build` first". A template problem is reported once, with the
number of pages it appears on.

These are hints, not legal advice, and a clean run is not proof of compliance:
automated checks find only part of the accessibility problems (about a third of
WCAG failures), and contrast, focus visibility or whether a law applies to your
site are not checked. Every report ends with that reminder.

Configure it in `config/validate.yaml` (optional):

```yaml
rules:
  a11y-img-alt: error         # promote: fails the check
  a11y-target-blank: warning  # enable an opt-in rule
  a11y-skip-link: off         # disable
legal:
  imprint: { de: /de/impressum.html, en: /en/imprint.html }
  privacy: { de: /de/datenschutz.html, en: /en/privacy.html }
privacy:
  allowed_hosts: [cdn.example.org]   # third-party hosts you have accounted for
```

Silence a rule on one page with `validate_ignore: [a11y-h1]` in its frontmatter.
To silence a rule on whole files or folders, list them under `ignore` — this
works for `nera validate` too, e.g. for `layout-missing` on content fragments
another page pulls in, or on drafts, which have no `layout` on purpose:

```yaml
ignore:
  layout-missing:
    - pages/*/references     # a folder covers everything below it; * = one folder name
    - pages/de/blog/drafts
```

Your own host is `origin` in `config/app.yaml`, else `app_origin` in
`config/canonical-links.yaml`. Without `legal.*` config, the imprint and privacy
links are found by their text in German and English only (*Impressum*,
*Imprint*, *Datenschutz*, *Privacy*, …); pages in other languages need
`legal.imprint.<lang>` / `legal.privacy.<lang>`. The full rule tables, with the
WCAG criterion or law behind each rule, are in the
[`@nera-static/validate` README](https://github.com/seebaermichi/nera-validate#checking-the-built-output).

## Machine-readable output

`nera validate --json`, `nera check --json` and `nera build --check --json`
print exactly one JSON object on stdout and nothing else, for an AI agent or a
script to parse:

```json
{
  "ok": true,
  "results": [
    {
      "file": "public/index.html",
      "line": 26,
      "severity": "warning",
      "rule": "a11y-skip-link",
      "message": "the first focusable element is not a skip link — …"
    }
  ]
}
```

`results` is the validator's list as it is, in the same order (`severity` is
`error` or `warning`); `ok` is `true` exactly when the exit code is `0`, so
warnings alone keep it `true`. When the command cannot run — no `public/` for
`nera check`, a failed build, a config the validator cannot read — stdout holds
`{ "ok": false, "error": "<message>", "results": [] }` and the exit code is `1`.
Every log line (the build log, plugin output) goes to stderr, and the exit code
is the same as without `--json`. `nera build --json` without `--check` prints
`{ "ok": true, "results": [] }` after a successful build.

`nera add <plugin> --json` prints what it did:

```json
{
  "ok": true,
  "plugin": "@nera-static/plugin-sitemap",
  "config": { "file": "config/sitemap.yaml", "status": "copied" },
  "templates": "none"
}
```

`status` is `copied`, `kept` (the site already had the file) or `none` (the
plugin ships no default), `templates` is `published` when the plugin's
template binary ran and `none` when it has none. npm's and the binary's
output go to stderr. On failure stdout holds `{ "ok": false, "error": "<message>" }`
and the exit code is `1`.

## Programmatic API

A program can use the catalogs, site creation, adding a plugin and both
validator passes without spawning `nera`:

```js
import { listCatalog, createSite, validate, check, hasErrors } from '@nera-static/nera'

const themes = await listCatalog('themes')
const { dir, firstSteps } = await createSite('my-site', {
    cwd: '/path/to/projects',
    starter: 'blog',
})
const results = validate({ cwd: dir })
if (hasErrors(results)) console.error(results)
```

-   `listCatalog(kind, { fetch, timeout })` — `kind` is `starters`, `themes` or
    `plugins`. Returns `[{ name, package, version, description, official, npm }]`
    from the npm registry: the official `@nera-static/*` packages first, then
    third-party ones; `name` is what `--starter`/`--theme` take. Starters fall
    back to `BUNDLED_STARTERS` (the official starters, exported too) when the
    registry cannot be reached; themes and plugins throw a `CatalogError`.
    `listStarters()` is the starter list `nera new`'s picker shows.
-   `createSite(projectName, { cwd, starter, theme, name, lang, install, log, env, signal })`
    — what `nera new` does, without a prompt. `projectName` is the new folder
    under `cwd`, or `.` for `cwd` itself. Returns `{ dir, firstSteps }`, the
    latter the starter's `## First steps` section or `null`. Every progress line
    goes to `log` (default: stderr) and `npm install`'s output to stderr, so
    nothing is written to stdout and nothing is read from stdin — safe for an
    MCP server over stdio. The starter download (`npm pack`, `tar`) and
    `npm install` (`install`, default `true`) run asynchronously, so the
    caller's event loop keeps running; with a `theme` from npm the install
    names the theme package, so `package.json` gets a caret range for it, as
    with `nera new`. `env` (default `process.env`) is the environment of every
    child — `npm --version`, `npm pack`, `tar` and `npm install` — e.g. a `PATH`
    with a bundled npm first. `signal` (an `AbortSignal`) kills the running
    child and rejects with `signal.reason`: a new folder is removed, while for
    `.` nothing is removed and the error names what was already written. A
    failed install without an abort keeps the folder, where `npm install` can
    be rerun.
-   `addPlugin(spec, { cwd, log, env, signal })` — what `nera add` does, for
    the site in `cwd`. `spec` is `<name>`, `plugin-<name>` or
    `@nera-static/plugin-<name>`; anything else, or a folder that is no thin
    Nera site, throws before npm runs. Returns
    `{ plugin, config: { file, status }, templates }`, the `--json` object
    without `ok`. Progress lines go to `log` (default: stderr), npm's and the
    template binary's output to stderr, and nothing is read from stdin. `env`
    and `signal` work as for `createSite`: the environment of both children,
    and an `AbortSignal` that kills the running child and rejects with
    `signal.reason`.
-   `validate({ cwd })` and `check({ cwd })` — `nera validate` and `nera check`
    for the site in `cwd`, returning the validator's records (the `results` of
    the JSON above). `check` throws when there is no build yet. `hasErrors(results)`
    is `true` when any record is an error.

Building, `nera dev`, `nera serve` and `nera publish` are not part of the API:
run the `nera` bin for those. Only `@nera-static/nera` and
`@nera-static/nera/package.json` can be imported; the bin and the `skills/`
folder are reached by path from `package.json`'s folder.

## Migrating a cloned (legacy) site

Older Nera sites were git clones that vendored the engine under `src/`. Inside
such a site run:

```bash
nera update --migrate
```

It adds `@nera-static/nera`, rewrites the scripts, removes the vendored `src/`
engine and root `index.js`, and installs — leaving your `pages/`, `config/` and
`theme/` untouched. Local plugins in `src/plugins/` are moved to `plugins/`;
add this to `config/app.yaml` so the engine discovers them there:

```yaml
folders:
  plugins: ./plugins
```

A root `views/` and `assets/` (no `theme/` folder) keeps rendering but prints a
deprecation warning — move them to `theme/views/` and `theme/assets/`, the
layout `nera new` scaffolds.

## Requirements

Node.js 22.12 or later (its bundled npm 10.9 or later).

## License

MIT
