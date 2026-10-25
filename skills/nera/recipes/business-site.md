# Recipe: business site

A small business presence: home, about, services, opening hours, contact,
imprint and privacy, with a menu on every page.

## Fast path

`npx @nera-static/nera new my-business --starter business` creates all of
this on `@nera-static/theme-business`: the pages, navigation, a contact form,
responsive images, social links and a sitemap. Read its `AGENTS.md`, then
replace the sample texts; steps 2, 8 and 9 below still apply. The steps
below build the site by hand instead, with different files.

## Steps

1. Scaffold: `npx @nera-static/nera new my-business`, then read its
   `AGENTS.md`.
2. Set the site in `config/app.yaml`: `name`, `lang`, and `origin` (the
   live URL, e.g. `https://example.com`) once the domain is known.
3. Write one Markdown page per topic, each with `layout: pages/default.pug`,
   a `title` and a `description`: `pages/index.md`, `pages/about.md`,
   `pages/services.md`, `pages/opening-hours.md`, `pages/contact.md`.
   Opening hours fit a Markdown table. A new site already has
   `pages/imprint.md` and `pages/privacy.md` as placeholders, linked from
   the layout's footer: replace their text, or write them if they are
   missing.
4. Menu: `npm install @nera-static/plugin-navigation`, list the pages in
   `config/navigation.yaml` (`href` ending in `.html`, `name`; groups such
   as `main:` and `footer:`; a footer menu replaces the layout's own
   imprint and privacy links, so keep only one of the two), run
   `npx nera-navigation` and include a menu in
   `theme/views/layouts/layout.pug` (see the plugin README for the mixins).
5. Contact form: follow [contact-form](contact-form.md).
6. Optional, for search engines: `@nera-static/plugin-sitemap` (needs
   `origin`) and `@nera-static/plugin-canonical-links`. Social profiles:
   `@nera-static/plugin-social-media-links`.
7. Styles: a CSS file in `theme/assets/css/`, linked from the layout's
   `head` (`link(rel="stylesheet" href="/css/main.css")`).
8. `npx nera validate`, then `npx nera build --check`; fix what they report.
   The legal hints from the check matter here: a business site usually
   needs an imprint and a privacy page.
9. Deploy `public/` (see [custom-domain](custom-domain.md)).

Mark invented details (address, hours, prices, legal texts) as placeholders
for the owner to replace, and say that legal pages need checking.

## Files touched

`config/app.yaml`, `config/navigation.yaml`, `pages/*.md`,
`theme/views/layouts/layout.pug`, `theme/views/vendor/plugin-navigation/`,
`theme/assets/css/`, `package.json`.

## Read next

- https://nera.js.org/docs/writing-content.md
- https://nera.js.org/tutorials/custom-navigation.md
- https://nera.js.org/docs/deployment.md
