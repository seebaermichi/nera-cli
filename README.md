# @nera-static/nera

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

## Commands

| Command | What it does |
|---|---|
| `nera new <name>` | Scaffold a new thin Nera site (one dependency: `@nera-static/nera`). Add `--theme <name>` to start from a theme. |
| `nera build` | Render `pages/` → `public/`. With `--check`, then run `nera check` on the result — one command for CI. |
| `nera dev` | Build, serve `public/`, and rebuild on change with live reload. Watches `pages/`, `config/`, `theme/` and a local theme (`theme: ./themes/<name>`). |
| `nera serve` | Serve the already-built `public/` folder. |
| `nera update` | Update the site's Nera packages. On a legacy cloned site, `nera update --migrate` converts it to the thin model. |
| `nera validate` | Check the site's sources (layouts, includes, YAML) before publishing; exits non-zero on any error. |
| `nera check` | Check the built `public/` for accessibility, privacy and legal-notice problems (see below). Build first. |

A scaffolded site is a thin project — no vendored engine, no clone. It lists one
dependency and its scripts call the CLI:

```jsonc
{
  "scripts": { "dev": "nera dev", "build": "nera build", "serve": "nera serve" },
  "dependencies": { "@nera-static/nera": "^1.0.0" }
}
```

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

Node.js 20.19 or later, or 22.12 or later.

## License

MIT
