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
| `nera new <name>` | Scaffold a new thin Nera site (one dependency: `@nera-static/nera`). |
| `nera build` | Render `pages/` → `public/`. |
| `nera dev` | Build, serve `public/`, and rebuild on change with live reload. |
| `nera serve` | Serve the already-built `public/` folder. |
| `nera update` | Update the site's Nera packages. On a legacy cloned site, `nera update --migrate` converts it to the thin model. |

A scaffolded site is a thin project — no vendored engine, no clone. It lists one
dependency and its scripts call the CLI:

```jsonc
{
  "scripts": { "dev": "nera dev", "build": "nera build", "serve": "nera serve" },
  "dependencies": { "@nera-static/nera": "^1.0.0" }
}
```

## Migrating a cloned (legacy) site

Older Nera sites were git clones that vendored the engine under `src/`. Inside
such a site run:

```bash
nera update --migrate
```

It adds `@nera-static/nera`, rewrites the scripts, removes the vendored `src/`
engine and root `index.js`, and installs — leaving your `pages/`, `config/` and
`theme/` untouched. Local plugins in `src/plugins/` are moved to `plugins/`.

## Requirements

Node.js >= 20.

## License

MIT
