# Recipe: blog

Posts in a folder, a list of posts on the home page, tags, previous/next
links and a sitemap.

## Steps

1. Scaffold: `npx @nera-static/nera new my-blog`, then read its `AGENTS.md`.
2. One Markdown file per post in `pages/posts/`, e.g.
   `pages/posts/first-post.md`, each with `layout`, `title`, `description`,
   `date` (`2026-10-12`) and `tags` (`tags: travel, food` or a YAML list).
   A post is served at `/posts/first-post.html`.
3. Post list: `npm install @nera-static/plugin-simple-page-list`, set
   `page_path: /posts`, `sortBy: date` and `sortOrder: descending` in
   `config/simple-page-list.yaml`, run
   `npx nera-simple-page-list`, and include the list in the template of the
   home page (data: `app.pageList`).
4. Tags: `npm install @nera-static/plugin-tags`. It builds a page per tag
   at `/tags/<tag>.html`. Run `npx nera-tags` and include
   `partials/tag-links` in the post template and `partials/tag-cloud` where
   you want all tags.
5. Previous/next: `npm install @nera-static/plugin-page-pagination`, give
   each post a `pagination_order` number, run `npx nera-page-pagination`
   and include it in the post template. It links pages of the same folder.
6. A post template of its own: `theme/views/pages/post.pug`, extending
   `../layouts/layout` like `pages/default.pug`, with exactly one `main`.
   Posts then use `layout: pages/post.pug`.
7. Sitemap: `npm install @nera-static/plugin-sitemap` and set `origin` in
   `config/app.yaml`. It also writes `robots.txt`.
8. Menu: `@nera-static/plugin-navigation`, as in
   [business-site](business-site.md).
9. `npx nera validate`, then `npx nera build --check`; fix what they report.

Each plugin's README names its config keys and include paths; read it
before step 3, 4 or 5.

## Files touched

`pages/posts/*.md`, `pages/index.md`, `config/app.yaml`,
`config/simple-page-list.yaml`, `config/tags.yaml` (optional),
`theme/views/pages/post.pug`, `theme/views/vendor/plugin-*/`,
`package.json`.

## Read next

- https://nera.js.org/tutorials/build-a-blog.md
- https://nera.js.org/tutorials/tag-your-content.md
- https://nera.js.org/tutorials/prev-next-pagination.md
