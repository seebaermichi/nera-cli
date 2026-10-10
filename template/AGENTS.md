# AGENTS.md

Instructions for AI coding agents working on this site. People are welcome to
read them too.

## What this is

This site is built with [Nera](https://nera.js.org), a static site generator:
Markdown pages plus Pug templates in, plain HTML out. Nera is not Eleventy,
Hugo, Astro or Jekyll, so do not apply their conventions here. The docs are
at https://nera.js.org.

## Folder map

- `pages/` — the content: one Markdown file with YAML frontmatter per page
- `theme/views/` — the Pug templates (`layouts/`, `pages/`, and `vendor/`
  for copied plugin templates)
- `theme/assets/` — CSS, JavaScript, images and fonts, copied into
  `public/` on every build
- `config/` — YAML settings: `app.yaml` for the site, `<plugin>.yaml` for
  each plugin
- `src/plugins/<name>/index.js` — local plugins for this site only (optional;
  another folder can be set with `folders.plugins` in `config/app.yaml`)
- `public/` — the generated site. **Never edit it**: every build deletes it
  and writes it again

## Commands

- `npm run dev` — build, serve on http://localhost:3000 and rebuild on
  every change
- `npm run build` — render `pages/` into `public/`
- `npx nera validate` — check pages, layouts, includes and YAML before a build
- `npx nera build --check` — build, then check the built `public/` for
  accessibility, privacy and legal issues (`npx nera check` checks without
  building)

## After every change

1. Run `npx nera validate` and fix every error it reports.
2. Run `npx nera build --check` and fix what it reports.

`nera validate` names the file and line of a broken layout or include and
finds pages the build would skip silently. Run it first.

## How Nera works (and where it trips agents up)

- **Pages are Markdown.** Write prose in Markdown, not HTML. Page structure
  and markup shared between pages belong in `theme/views/`.
- **URLs end in `.html`.** `pages/a/b.md` becomes `public/a/b.html` and is
  linked as `/a/b.html`; `pages/index.md` is `/index.html`. There are no
  pretty URLs such as `/a/b/`.
- **A page needs `layout`.** The `layout` key in a page's frontmatter names a
  file under `theme/views/`; the pages this site was created with use
  `pages/default.pug`. A page without `layout` is not rendered and the build
  says nothing; `nera validate` warns (`layout-missing`). Renaming or deleting
  a layout breaks every page that uses it.
- **The page body.** The rendered Markdown reaches the template as `content`.
  Without a theme, `theme/views/pages/default.pug` prints it with
  `main !{ content }` inside `block content`; with a theme, the theme's layout
  may already hold the `<main>`. A page has exactly one `<main>`: check the
  layout and the page template before adding one.
- **`public/` is wiped on every build.** Put source files in `pages/`,
  `theme/` or `config/`; anything written into `public/` by hand is lost.
- **Site files override theme files.** If `config/app.yaml` sets `theme:`,
  the layouts come from that theme (a package or a folder), and a file in
  `theme/views/` or `theme/assets/` replaces the theme's file at the same
  path.
- **Translations.** Templates call `t('key')`, which reads
  `translations.<lang>.key` from `config/app.yaml` (the page's `lang`, else
  the site's).

## Plugins: look for one before writing a feature

Features come from npm packages named `@nera-static/plugin-*`. Install one with
`npm install`, and Nera loads it on the next build; there is nothing to
register. Most read optional settings from `config/<name>.yaml` (the plugin's
README shows the keys). Plugin catalog:
https://github.com/seebaermichi/nera/blob/main/PLUGINS.md

Check the catalog before hand-writing navigation, a contact form, tags, search,
pagination or image handling. Two that sites often need:

- `@nera-static/plugin-contact-form` — a contact form that opens the visitor's
  mail client (`mailto:`). No backend and no form service; configured in
  `config/contact-form.yaml`.
- `@nera-static/plugin-navigation` — menus from `config/navigation.yaml`.

Plugin templates are not used automatically. Copy them into the site first,
then include them by hand in your own template:

- `npx nera-contact-form` copies the form to
  `theme/views/vendor/plugin-contact-form/` (and its script to
  `theme/assets/js/`); include it with
  `include /vendor/plugin-contact-form/contact-form`
- `npx nera-navigation` copies the menus to
  `theme/views/vendor/plugin-navigation/`

The copy is skipped when the target folder already exists, so later plugin
updates do not reach it; `--force` overwrites the copy.

## Preview

`npm run dev` keeps running until it is stopped. If you start it in the
background, stop that process yourself when you are done, by its process ID.
Never kill processes by name (`pkill -f nera`), which stops other people's
servers too. If port 3000 is taken, the server picks another one and prints
the URL.

## Getting online

`npm run build` writes the finished site into `public/`. That folder is what
gets deployed: upload its contents to any static web host.

<!-- nera:site-notes — everything below this line belongs to the site owner; `nera update` keeps it as it is -->
## Notes for this site

Add what an agent should know about this particular site: its audience, tone,
languages, pages that must not change, the hosting.
