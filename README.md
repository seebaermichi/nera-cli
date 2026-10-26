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
| `nera build` | Render `pages/` → `public/`. With `--check`, then run `nera check` on the result — one command for CI. `--json` prints the result as one JSON object (see [Machine-readable output](#machine-readable-output)). |
| `nera dev` | Build, serve `public/`, and rebuild on change with live reload. Watches `pages/`, `config/`, `theme/` and a local theme (`theme: ./themes/<name>`). |
| `nera serve` | Serve the already-built `public/` folder. |
| `nera update` | Update the site's Nera packages and raise their caret ranges in `package.json` (and `package-lock.json`) to the installed versions, then create a missing `AGENTS.md`/`CLAUDE.md` and refresh the Nera part of `AGENTS.md` and the `nera` skill (see [Instructions for AI assistants](#instructions-for-ai-assistants)). On a legacy cloned site, `nera update --migrate` converts it to the thin model. |
| `nera validate` | Check the site's sources (layouts, includes, YAML) before publishing; exits non-zero on any error. `--json` for machine-readable output. |
| `nera check` | Check the built `public/` for accessibility, privacy and legal-notice problems (see below). Build first. `--json` for machine-readable output. |
| `nera publish` | Publish the site through GitHub: sign in with the "Nera Static" GitHub App, create (or reuse) the repository, generate `.github/workflows/deploy.yml`, push, and follow the Actions run. The host is GitHub Pages (`--target github-pages`, the default): it switches Pages on with the GitHub Actions build type, sets `base_path` in `config/app.yaml` to match the Pages address (`/<repo>` for a project page, none for a `<user>.github.io` repository or a custom domain) and prints the live URL. `--domain <host>` sets a custom domain in the Pages settings (no `CNAME` file), checks its DNS on every run and prints the records to set when they are missing or wrong; they never stop the publish. `--repo <name>` names the repository (default: the folder name), `--private` makes it private (GitHub Pages serves a private repository only on a paid plan), `--yes` never asks, `--json` prints one JSON object (`url` holds the live URL), `--sign-out` removes the stored GitHub token. Netlify arrives in a following release. |

A scaffolded site is a thin project — no vendored engine, no clone. It lists one
dependency, a caret range starting at the version of the CLI that created it,
and its scripts call the CLI:

```jsonc
{
  "scripts": {
    "dev": "nera dev", "build": "nera build", "serve": "nera serve",
    "validate": "nera validate", "check": "nera build --check"
  },
  "dependencies": { "@nera-static/nera": "^1.16.0" }
}
```

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
