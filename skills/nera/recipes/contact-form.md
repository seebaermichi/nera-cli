# Recipe: contact form

A contact form with `@nera-static/plugin-contact-form`. It opens the
visitor's mail client (`mailto:`): no backend, no form service, no account.
Do not hand-write a `<form>` or post to a third-party service.

## Steps

1. `npm install @nera-static/plugin-contact-form`
2. Create `config/contact-form.yaml`. `recipient` and at least one field
   are required; without them the form does not render and the build only
   warns:

   ```yaml
   recipient: hello@example.com
   fields:
       - name: name
         label: Your name
         type: text
         required: true
       - name: email
         label: Your email
         type: email
         required: true
       - name: message
         label: Message
         type: textarea
         required: true
   ```

   Field types: `text`, `email`, `tel`, `textarea`, `select`, `checkbox`,
   `radio`. The README lists the optional keys (subject, labels, honeypot,
   `consent_text` with a link to the privacy page).
3. `npx nera-contact-form` copies the form to
   `theme/views/vendor/plugin-contact-form/` and its script to
   `theme/assets/js/contact-form.js`.
4. A page template for the contact page, `theme/views/pages/contact.pug`:

   ```pug
   extends ../layouts/layout

   block content
     main
       | !{ content }
       include /vendor/plugin-contact-form/contact-form
   ```

5. `pages/contact.md` with `layout: pages/contact.pug`, a `title` and a
   short text above the form.
6. `npx nera validate`, then `npx nera build --check`. Open
   `/contact.html` with `npm run dev` and submit once: the mail client
   should open with the message filled in.

## Files touched

`package.json`, `config/contact-form.yaml`, `pages/contact.md`,
`theme/views/pages/contact.pug`, `theme/views/vendor/plugin-contact-form/`,
`theme/assets/js/contact-form.js`.

## Read next

- Plugin README: https://github.com/seebaermichi/nera-plugin-contact-form
- https://nera.js.org/docs/plugins.md
