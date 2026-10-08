# @nera-static/nera

The Nera CLI — scaffold, build, preview and update a [Nera](https://github.com/seebaermichi/nera)
static site with a single command. It runs over the [`@nera-static/core`](https://github.com/seebaermichi/nera)
engine and is the one package a Nera site depends on.

📖 **Documentation:** [nera.js.org](https://nera.js.org)

## Quick start

```bash
npx @nera-static/nera new my-site
cd my-site
npm run dev            # or: nera dev
```

## Commands

| Command | What it does |
|---|---|
| `nera new <name>` | Scaffold a new thin Nera site (one dependency: `@nera-static/nera`). Add `--theme <name>` to start from a theme. |
| `nera build` | Render `pages/` → `public/`. |
| `nera dev` | Build, serve `public/`, and rebuild on change with live reload. |
| `nera serve` | Serve the already-built `public/` folder. |
| `nera update` | Update the site's Nera packages. On a legacy cloned site, `nera update --migrate` converts it to the thin model. |
| `nera validate` | Check the site (layouts, includes, YAML) before publishing; exits non-zero on any error. |

A scaffolded site is a thin project — no vendored engine, no clone. It lists one
dependency and its scripts call the CLI:

```jsonc
{
  "scripts": { "dev": "nera dev", "build": "nera build", "serve": "nera serve" },
  "dependencies": { "@nera-static/nera": "^1.0.0" }
}
```

## Starting from a theme

```bash
npx @nera-static/nera new my-site --theme example
```

This installs the theme (`example` → `@nera-static/theme-example`; a full
package name such as `@acme/my-theme`, or a local path such as `./my-theme`,
works too), sets `theme:` in `config/app.yaml`, and leaves out the scaffold's
starter templates.

That last part matters. A site's own `theme/views/` wins over its theme's views
**file by file** — that is how you override a single theme template. Without
`--theme`, `nera new` writes a starter `theme/views/layouts/layout.pug` and
`theme/views/pages/default.pug`, the same names a theme uses, so a theme added
later stays hidden behind them. Each starter file carries a
`//- nera:scaffold-default` first line, and `nera validate` warns
(`theme-shadowed`) while such a file hides a theme's. Delete it to use the
theme's version, or delete the marker line to keep yours.

## Migrating a cloned (legacy) site

Older Nera sites were git clones that vendored the engine under `src/`. Inside
such a site run:

```bash
nera update --migrate
```

It adds `@nera-static/nera`, rewrites the scripts, removes the vendored `src/`
engine and root `index.js`, and installs — leaving your `pages/`, `config/` and
`theme/` untouched. Local plugins in `src/plugins/` are moved to `plugins/`;
add this to `config/app.yaml` so the engine discovers them there:

```yaml
folders:
  plugins: ./plugins
```

A root `views/` and `assets/` (no `theme/` folder) keeps rendering but prints a
deprecation warning — move them to `theme/views/` and `theme/assets/`, the
layout `nera new` scaffolds.

## Requirements

Node.js >= 20.

## License

MIT
