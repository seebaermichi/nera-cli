# Recipe: images

Responsive images with `@nera-static/plugin-images`: each picture becomes a
`<picture>` with AVIF and WebP in several widths, plus a fallback. Needs
`@nera-static/core` 4.13.0 or later (`npx nera update` brings it).

## Steps

1. `npm install @nera-static/plugin-images`
2. Put the originals in the assets folder, e.g. `theme/assets/images/`.
   They are referenced without `theme/assets`: `/images/photo.jpg`.
3. In Markdown, write images as usual; the plugin rewrites them:
   `![A pier at dusk](/images/pier.jpg)`. A title becomes a caption
   (`![Alt](/images/pier.jpg "Caption")`), and query parameters crop or
   size one image (`?w=800&ratio=16:9`, see the README).
4. In frontmatter, `image: /images/hero.jpg` gets precomputed variants for
   templates. Run `npx nera-images` to copy the `picture` mixin to
   `theme/views/vendor/plugin-images/`, then in a template:

   ```pug
   include /vendor/plugin-images/picture
   +picture(meta.images && meta.images.image, { alt: meta.image_alt })
   ```

   Images written directly in Pug (`img(src=…)`) are not processed.
5. Optional `config/images.yaml`: `formats`, `widths`, `sizes`, `quality`.
6. Variants are cached in `.nera-cache/images/`; the scaffold's
   `.gitignore` already ignores `.nera-cache`.
7. Originals with location data? List their folder (e.g. `images`) in a
   `.neraignore` file at the site root; its paths are relative to the
   assets folder. Only the processed variants, without metadata, are then
   published.
8. `npx nera validate`, then `npx nera build --check`; every image needs
   alt text.

## Files touched

`package.json`, `theme/assets/images/`, `pages/*.md`,
`config/images.yaml` (optional), `theme/views/vendor/plugin-images/`,
`.neraignore` (optional).

## Read next

- Plugin README: https://github.com/seebaermichi/nera-plugin-images
- https://nera.js.org/docs/writing-content.md
