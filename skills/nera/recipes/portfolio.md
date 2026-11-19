# Recipe: portfolio

A home page with a grid of projects, one page per project, large responsive
images.

## Fast path

`npx @nera-static/nera new my-portfolio --starter portfolio` creates a
portfolio on `@nera-static/theme-business`: project pages with image
galleries, about, a contact form, navigation, responsive images and a
sitemap. Read its `AGENTS.md`, then replace the sample projects and images
and the placeholder `origin: https://example.com` in `config/app.yaml`;
step 7 below still applies. The steps below build the portfolio by hand
instead, with different files.

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
4. Project list: `npx nera add simple-page-list`, change `page_paths` in
   the copied `config/simple-page-list.yaml` to `[/projects]`, and render
   `app.pageList.projects` on the home page. For a grid with cover images,
   loop over it in your own Pug template instead of the published one.
5. A project template, `theme/views/pages/project.pug`, extending
   `../layouts/layout`, that shows the cover with the images plugin's
   `+picture` mixin and then `content`, with exactly one `main`.
6. Optional, each with `npx nera add <name>`: `tags` to group projects by
   kind, `page-pagination` for previous/next project, `social-media-links`,
   `sitemap`.
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
