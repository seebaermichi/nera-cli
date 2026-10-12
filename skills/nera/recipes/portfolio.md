# Recipe: portfolio

A home page with a grid of projects, one page per project, large responsive
images.

## Steps

1. Scaffold: `npx @nera-static/nera new my-portfolio`, then read its
   `AGENTS.md`.
2. Images: put originals in `theme/assets/images/` and set up
   [images](images.md) first, so every photo is served as AVIF/WebP in
   several widths.
3. One Markdown file per project in `pages/projects/`, each with `layout`,
   `title`, `description`, `date` and `image: /images/<file>.jpg` (the cover
   picture). Show more photos in the body with
   `![Alt text](/images/<file>.jpg "Caption")`.
4. Project list: `npm install @nera-static/plugin-simple-page-list`, set
   `page_path: /projects` in `config/simple-page-list.yaml`, run
   `npx nera-simple-page-list`, and render `app.pageList` on the home page.
   For a grid with cover images, loop over `app.pageList` in your own Pug
   template instead of the published one.
5. A project template, `theme/views/pages/project.pug`, extending
   `../layouts/layout`, that shows the cover with the images plugin's
   `+picture` mixin and then `content`, with exactly one `main`.
6. Optional: `@nera-static/plugin-tags` to group projects by kind,
   `@nera-static/plugin-page-pagination` for previous/next project,
   `@nera-static/plugin-social-media-links`, `@nera-static/plugin-sitemap`.
7. `npx nera validate`, then `npx nera build --check`. The check reports
   images without alt text; describe what each picture shows.

## Files touched

`theme/assets/images/`, `pages/projects/*.md`, `pages/index.md`,
`config/images.yaml` (optional), `config/simple-page-list.yaml`,
`theme/views/pages/project.pug`, `theme/views/vendor/plugin-*/`,
`package.json`.

## Read next

- https://nera.js.org/docs/writing-content.md
- https://nera.js.org/docs/plugins.md
