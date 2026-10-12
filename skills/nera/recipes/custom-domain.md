# Recipe: custom domain

Serve the built site under a domain of your own. Nera builds static files;
the domain is set at the host and at the domain registrar.

## Steps

1. Build: `npm run build`. Deploy the contents of `public/` to the host
   (GitHub Pages, Netlify, any static host). Set the host to build with
   `npm run build` and publish `public/`, or upload `public/` yourself.
2. At the host, add the custom domain in its site settings.
3. At the registrar, set the DNS records the host names for that domain,
   usually a `CNAME` record for `www` pointing at the host and `A`/`AAAA`
   records (or `ALIAS`) for the bare domain. Copy them from the host's own
   docs; they differ per host. DNS can take hours to spread.
4. **GitHub Pages:** it needs a file named `CNAME` (no extension) at the
   root of the deployed site, holding only the domain (`www.example.com`).
   Never write it into `public/`, which every build deletes. Put it in
   `theme/assets/CNAME`: every file in `theme/assets/` is copied to the root
   of `public/` on each build, so it ends up at `public/CNAME`.
5. **`base_path`:** leave it unset for a custom domain or any site served
   from the root. Set `base_path: /<repo>` in `config/app.yaml` only for a
   site served under a sub-path, such as a GitHub project page at
   `https://<user>.github.io/<repo>/`; Nera then prefixes every root-absolute
   link and asset URL. Remove it again when the custom domain takes over.
6. Set `origin: https://www.example.com` in `config/app.yaml`, so the
   sitemap and canonical links use the real domain.
7. Turn on HTTPS at the host once the domain resolves.
8. `npx nera validate`, then `npx nera build --check`, then deploy again.

## Files touched

`theme/assets/CNAME` (GitHub Pages), `config/app.yaml` (`origin`,
`base_path`), DNS settings outside the site.

## Read next

- https://nera.js.org/docs/deployment.md
