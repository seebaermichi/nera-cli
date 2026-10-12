# Recipe: multilingual site

A second language beside the first, e.g. English at `/` and German at
`/de/`.

## Steps

1. Keep the default language at the root of `pages/` and put each other
   language in its own folder: `pages/de/index.md` becomes `/de/index.html`.
2. Give every page in another language `lang` in its frontmatter
   (`lang: de`). Pages without it use `lang` from `config/app.yaml`.
3. Pair the versions of a page with the same `slug` in their frontmatter
   (`slug: about` on `pages/about.md` and `pages/de/ueber-uns.md`).
4. Template texts: write `t('key')` in Pug and add the texts per language
   under `translations:` in `config/app.yaml`:

   ```yaml
   lang: en
   translations:
     en:
       read_more: Read more
     de:
       read_more: Weiterlesen
   ```

   `t()` uses the page's `lang`, else the site's.
5. In `theme/views/layouts/layout.pug`, set the document language from the
   page: `html(lang=meta.lang || app.lang)`.
6. Menus: one group per language in `config/navigation.yaml` (`main:` and
   `main_de:`), each rendered with the menu mixin and the language root,
   e.g. `+linkListNav(app.nav.main_de.elements, 'nav--main', '/de')`.
   Add a link to the other language's version of the page.
7. Search engines: `@nera-static/plugin-canonical-links` with
   `available_languages` in `config/canonical-links.yaml` adds `hreflang`
   links; `@nera-static/plugin-sitemap` lists the pairs too. Both use
   `lang` and `slug`.
8. Search and tags can keep one index or tag list per language
   (`group_by_lang` in `config/search.yaml` or `config/tags.yaml`).
9. `npx nera validate`, then `npx nera build --check`.

## Files touched

`pages/<lang>/*.md`, `config/app.yaml`, `config/navigation.yaml`,
`config/canonical-links.yaml`, `theme/views/layouts/layout.pug`.

## Read next

- https://nera.js.org/docs/core-concepts.md
- https://nera.js.org/tutorials/canonical-links-seo.md
- https://nera.js.org/tutorials/custom-navigation.md
