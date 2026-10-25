---
name: nera
description: Create, change, check and deploy websites built with Nera, the Markdown + Pug static site generator (npm package @nera-static/nera). Use when package.json lists @nera-static/nera, or when the user asks to build a website, page, blog, portfolio or business site with Nera, or to add a contact form, search, images, a second language or a custom domain to a Nera site. Holds the workflow, the checks to run after every change, and short recipes for common sites and features.
---

# Nera

Nera turns Markdown pages and Pug templates into plain HTML. It is not
Eleventy, Hugo, Astro or Jekyll; do not apply their conventions.

## Read this first

- **In an existing site, read `AGENTS.md` at the site root before anything
  else.** It holds the folder map, the commands and the traps (pages need
  `layout`, URLs end in `.html`, `public/` is wiped on every build, plugin
  templates are copied and included by hand). This skill does not repeat it.
- No site yet? Scaffold one (step 1 below), then read its `AGENTS.md`.
- The "Notes for this site" section at the end of `AGENTS.md` belongs to the
  site owner: follow it, and add to it what the next agent should know.

## Workflow

1. **Scaffold.** `npx @nera-static/nera new my-site` creates a folder and
   installs; `npx @nera-static/nera new .` fills the current, empty folder.
   Start from an official starter when one fits, with `--starter <name>`:
   - `blank`: a home page, imprint and privacy placeholders, one layout
   - `blog`: sample posts, tags, archive, prev/next, feed, sitemap
   - `business`: home, about, services, opening hours, contact form
   - `portfolio`: project pages with image galleries, about, contact form

   `--name "<site name>"` and `--lang <code>` set `name` and `lang` in
   `config/app.yaml`. With `--yes`, or without a terminal, it never asks:
   `npx @nera-static/nera new my-site --starter blog --name "My Blog" --lang en --yes`.
   `--theme <name>` starts from a theme instead (not together with
   `--starter`, which brings its own); `--no-install` skips `npm install`.
2. **Content.** One Markdown file per page in `pages/`, each with YAML
   frontmatter that names its `layout`. Site name, language and texts for
   templates go in `config/app.yaml`. Shared markup goes in `theme/views/`.
3. **Plugins.** Look for a plugin before writing a feature (see below).
   Install it, configure it in `config/<name>.yaml`, copy its templates with
   its own binary and include them in a layout.
4. **Validate.** `npx nera validate` and fix every error it reports. It
   finds broken layouts and includes and pages the build would skip.
5. **Build and check.** `npx nera build --check` and fix what it reports
   (accessibility, privacy and legal hints on the built site).
   `npm run dev` previews on http://localhost:3000 with live reload; stop it
   when you are done.
6. **Deploy.** `npm run build` writes the finished site into `public/`.
   Upload the contents of `public/` to any static host. See
   [custom-domain](recipes/custom-domain.md) for a domain of your own.

Repeat steps 2–5 for every change. For machine-readable results, add `--json`:
`npx nera validate --json`, `npx nera check --json`,
`npx nera build --check --json`.

Existing site on an older Nera? `npx nera update` updates the Nera packages
and refreshes `AGENTS.md` and this skill.

## Look for a plugin before writing a feature

Features come from npm packages named `@nera-static/plugin-<name>`. An
installed plugin loads on the next build, with nothing to register. Do not
hand-write navigation, a contact form, tags, search, pagination, image
handling, a sitemap, a feed or a consent banner: a plugin exists for each.
The catalog: https://github.com/seebaermichi/nera/blob/main/PLUGINS.md

The published plugins: canonical-links, code-blocks, consent, contact-form,
feed, images, link-attributes, navigation, one-page, page-navigation,
page-pagination, popular-content, search, simple-page-list, sitemap,
social-media-links, stacks, statistics, tags. Each plugin's README (on npm, or
`github.com/seebaermichi/nera-plugin-<name>`) lists its config keys and its
template binary. Read it before you configure the plugin.

A feature no plugin covers can be a local plugin in
`src/plugins/<name>/index.js`; see the tutorial
[Write a local plugin](https://nera.js.org/tutorials/write-a-local-plugin.md).

## Recipes

Short task guides. Each names the steps, the files it touches and the docs
page to open next.

- [Business site](recipes/business-site.md): home, about, services, contact,
  imprint and privacy, with a menu
- [Blog](recipes/blog.md): posts, a post list, tags, pagination, sitemap
- [Portfolio](recipes/portfolio.md): project pages with responsive images
- [Contact form](recipes/contact-form.md): a `mailto:` form, no backend
- [Search](recipes/search.md): client-side search over the site
- [Images](recipes/images.md): responsive AVIF/WebP images
- [Multilingual site](recipes/multilingual.md): a second language
- [Custom domain](recipes/custom-domain.md): DNS, GitHub Pages `CNAME`,
  `base_path`

## Docs

The docs on https://nera.js.org are the truth; this skill only points to
them. For AI assistants, in English:

- Index: https://nera.js.org/llms.txt
- Everything in one file: https://nera.js.org/llms-full.txt
- Single pages as Markdown:
  [getting started](https://nera.js.org/docs/getting-started.md),
  [core concepts](https://nera.js.org/docs/core-concepts.md),
  [writing content](https://nera.js.org/docs/writing-content.md),
  [plugins](https://nera.js.org/docs/plugins.md),
  [deployment](https://nera.js.org/docs/deployment.md),
  [CLI](https://nera.js.org/docs/cli.md),
  [using AI](https://nera.js.org/docs/using-ai.md)
- Tutorials: [build a blog](https://nera.js.org/tutorials/build-a-blog.md),
  [custom navigation](https://nera.js.org/tutorials/custom-navigation.md),
  [tag your content](https://nera.js.org/tutorials/tag-your-content.md),
  [add search](https://nera.js.org/tutorials/add-search.md),
  [prev/next pagination](https://nera.js.org/tutorials/prev-next-pagination.md),
  [canonical links](https://nera.js.org/tutorials/canonical-links-seo.md),
  [how nera.js.org is built](https://nera.js.org/tutorials/how-this-site-is-built.md)
