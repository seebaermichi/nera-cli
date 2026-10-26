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
4. **GitHub Pages through `nera publish`:** run
   `npx nera publish --yes --domain www.example.com`. It sets the domain in
   the Pages settings, removes `base_path`, checks the DNS on every publish
   and prints the records to set when they are missing (`A`/`AAAA` for a
   bare domain, a `CNAME` to `<user>.github.io` otherwise). Steps 2 and 5 are done for you; set
   the records of step 3 yourself.
   No `CNAME` file is needed: GitHub ignores it for a site an Actions
   workflow deploys. Only a Pages site deployed from a branch uses one; put
   it in `theme/assets/CNAME` (never in `public/`, which every build deletes).
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

`config/app.yaml` (`origin`, `base_path`), DNS settings outside the site,
`theme/assets/CNAME` only for a Pages site deployed from a branch.

## Read next

- https://nera.js.org/docs/deployment.md
