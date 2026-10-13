# Recipe: search

Client-side search with `@nera-static/plugin-search`: the build writes a
JSON index, a small script searches it in the browser. No backend.

## Steps

1. `npm install @nera-static/plugin-search`. It works without config;
   `config/search.yaml` can change the indexed `fields` or set
   `group_by_lang: true` for one index per language.
2. `npx nera-search` copies the search template to
   `theme/views/vendor/plugin-search/` and its script to
   `theme/assets/js/search.js`.
3. A page template for the search page, `theme/views/pages/search.pug`:

   ```pug
   extends ../layouts/layout

   block content
     main
       | !{ content }
       include /vendor/plugin-search/search.pug
   ```

4. `pages/search.md` with `layout: pages/search.pug`, a `title` and a
   `# Search` heading, and `show_title: false` in `config/search.yaml`, so
   that heading is the page's only `h1` (without the key the template adds
   its own and `nera build --check` warns `a11y-h1`). Link the page from
   the menu.
5. The template's input is already labelled (`aria-label`, default
   "Search"). To translate the template, add `search_label`, `search_title`
   and `search_placeholder` to the site's translations. A copy published
   before plugin-search 2.3.0 lacks both: refresh it with
   `npx nera-search --force` if it was never edited.
6. The index is written to `theme/assets/search-index.json` on every build
   and served as `/search-index.json`. It is generated: add
   `theme/assets/search-index*.json` to `.gitignore`.
7. Only pages with a `layout` are indexed. If other plugins add pages (tags),
   run search last with `config/plugin-order.yaml` as the README shows.
8. `npx nera validate`, then `npx nera build --check`; try a query with
   `npm run dev`.

## Files touched

`package.json`, `config/search.yaml` (optional), `pages/search.md`,
`theme/views/pages/search.pug`, `theme/views/vendor/plugin-search/`,
`theme/assets/js/search.js`, `.gitignore`.

## Read next

- https://nera.js.org/tutorials/add-search.md
- Plugin README: https://github.com/seebaermichi/nera-plugin-search
