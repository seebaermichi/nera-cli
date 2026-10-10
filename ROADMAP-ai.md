# ROADMAP — Nera for AI assistants, and a site online in one command

> **Status: spec, written 2026-10-10; decisions D1–D12 settled the same
> day (see "Decisions"). Slice 0, the baseline cold agent test, is done
> (2026-10-10, see "Slice 0 — baseline record"). Slice 1 is under way: the
> scaffold ships `AGENTS.md` and `CLAUDE.md` since `@nera-static/nera` 1.6.0
> (see "Slice 1 — progress"); `nera update` writing them and the
> command-consistency test are still open. No open questions.**
>
> This document is the single source of truth for two linked goals:
>
> 1. any AI assistant — Claude Code, Claude Desktop, claude.ai, OpenAI Codex,
>    ChatGPT, Cursor, Copilot — knows exactly how to set up and change a Nera
>    site, and
> 2. a person with no hosting experience runs `npx @nera-static/nera new my-site`
>    and ends with a live website, guided through every step, with or without
>    an AI.
>
> It lives in `nera-cli` because most of the work lands in the CLI and its
> scaffold `template/`; the parts in `nera-website`, the starter packages and a
> new `nera-mcp` repo are specified here too. Extend this file rather than
> starting a parallel one, as `generator/ROADMAP-core.md` and
> `nera-validate/ROADMAP-compliance.md` anchor their work.

## Why

The target user has just found Nera and wants a website for her business or
her blog with as little effort as possible, and she asks an AI to help. Today
that goes badly for a reason that has nothing to do with Nera's quality:
**models know almost nothing about Nera.** It is small and young, so it barely
appears in their training data. Asked "build me a bakery site with Nera", an
assistant guesses — it invents config keys, mixes Nera up with Hugo or
Eleventy, writes HTML into `public/` (deleted on every build), or forgets that a
page without `layout` is silently skipped.

So the core problem is **knowledge**, then **tools**, then **the last mile**:

| User's AI | Can it run commands and edit files? | What it lacks |
|---|---|---|
| Coding agent — Claude Code, Codex, Cursor, Copilot agent | yes | knowledge of Nera's conventions; machine-readable feedback |
| Desktop chat app — Claude Desktop | only through a local MCP server | knowledge **and** hands |
| Web chat — claude.ai, ChatGPT | only through a **remote** MCP server | knowledge, hands **and** a place for the files |
| No AI at all | — | a guided path |

And even a perfectly informed AI cannot deliver "effortless" if the parts are
missing: today there is one theme (`theme-example`), no starters, no sitemap or
feed plugin, and nothing that takes a site from a folder on a laptop to a URL.
An AI can only assemble what exists — and "put it online" is where beginners
give up.

## What MCP is (for the record)

The Model Context Protocol is an open standard (started by Anthropic in 2024,
now supported by OpenAI, Google, Microsoft, Cursor and others) through which an
AI client talks to a **server** that offers **tools** (functions the model may
call, e.g. `create_site`), **resources** (documents it may read, e.g. the docs)
and **prompts** (ready-made task starters). A server runs either **locally** as
a child process of the AI app (stdio) or **remotely** as a web service over
HTTPS (Streamable HTTP). One server works in every client that speaks MCP —
but web clients (claude.ai, ChatGPT) can only reach remote servers.

## Principles

1. **Knowledge first, tools second.** Cheap text that every AI reads beats an
   integration that only some clients load.
2. **One source of truth for AI-facing knowledge.** The docs on nera.js.org are
   the truth. Everything an AI reads — `llms.txt`, the skill, the MCP server's
   resources — is generated from them or points to them, never a hand-kept copy.
   Hand-kept copies drift; this workspace has paid for that more than once
   (vendored templates, the website plugin catalog).
3. **Short in-project instructions, deep docs elsewhere.** The `AGENTS.md` in a
   site holds only what is stable and what an agent gets wrong without it.
4. **One code path for human, agent and MCP.** The guided wizard, the
   non-interactive flags an agent uses and the MCP tools all call the same
   functions. Nothing is implemented twice.
5. **Interactive for humans, never for agents.** Every question the wizard asks
   has a flag; without a TTY (or with `--yes`) nothing is ever asked.
6. **Safe by default.** Tokens stay in the OS keychain or the hosted service's
   encrypted store, scopes are minimal, nothing is published without an action
   the user sees, and no tool runs arbitrary shell commands.
7. **GitHub is the home of a site's source.** Local or hosted, AI or not, a
   site ends up as a GitHub repository built by Actions. That is also Nera Pro's
   model (`nera-platform/plans/01`), so everything here is reusable there.

## The target experience

```text
$ npx @nera-static/nera new my-site

  What are you building?      › Business website / Blog / Portfolio / Empty
  Site name                   › Brot & Zeit
  Language                    › Deutsch
  ✔ Created my-site from the "business" starter

  Put it online now? (free, takes about two minutes)  › Yes
  → Opening github.com in your browser. No account yet? Create one there,
    then come back. Enter this code: WDJB-MJHT
  ✔ Signed in as brotundzeit
  ✔ Created github.com/brotundzeit/my-site
  ✔ Published — https://brotundzeit.github.io/my-site/ (live in ~1 minute)

  Next: edit pages/index.md, then run  npx nera publish
  Using an AI assistant? It will find instructions in AGENTS.md.
```

The same flow, through an AI: the agent runs
`nera new my-site --starter business --name "Brot & Zeit" --lang de --yes`, then
`nera publish`, which prints the device code for the human to enter. Through
claude.ai or ChatGPT: the user adds the Nera connector, logs in with GitHub, and
says "make me a website for my bakery" (L7).

## Layers

### L1 — Agent instructions in every site

`nera new` writes, by default (decision D1):

- **`AGENTS.md`** — the cross-tool convention read by Codex, Cursor, Copilot,
  Gemini CLI and others. At most ~120 lines:
  - what Nera is, in two sentences, and the link to https://nera.js.org/llms.txt
  - the folder map: `pages/` (Markdown + frontmatter), `theme/views/` (Pug),
    `theme/assets/`, `config/*.yaml`, `src/plugins/` (local plugins — core's
    default `folders.plugins`, which the template does not change), `public/`
    (generated, **never edit**)
  - the commands: `npm run dev`, `npm run build`, `npx nera validate`,
    `npx nera check`, `npx nera publish`, and `--json` (L3)
  - the traps, one line each: a page needs `layout` in its frontmatter or it is
    silently skipped; `public/` is wiped on every build; plugins come from npm as
    `@nera-static/plugin-*` and are configured in `config/<name>.yaml`; plugin
    templates are copied with `publish-template` and included by hand; a theme
    file is overridden by a site file at the same path
  - "after every change: run `nera validate`, then `nera build --check`, and fix
    what they report"
  - a marked section at the end, "Notes for this site", that belongs to the user
- **`CLAUDE.md`** — one line, `@AGENTS.md`, so Claude Code loads the same text.

**Existing sites** get them through plain **`nera update`** (decision D2): it
creates the files when they are missing. When `AGENTS.md` exists, `nera update`
replaces only the Nera-owned part above the "Notes for this site" marker, so
instructions follow the installed Nera version and the user's notes survive. A
file without the marker is the user's own and is left alone (with a hint).

A test asserts that every `nera <command>` the template's `AGENTS.md` mentions
exists in the CLI's usage text, so the instructions cannot go stale silently.

### L2 — AI-readable docs on nera.js.org

`nera-website` publishes, **in English only** (decision D3):

- **`/llms.txt`** — the [llms.txt](https://llmstxt.org) convention: an H1, a
  one-paragraph summary, then linked sections (Docs, Tutorials, Plugins,
  Starters, CLI), each link with a one-line description.
- **`/llms-full.txt`** — the complete English docs and tutorials as one Markdown
  file, frontmatter stripped, pages in navigation order.
- **`/<page>.md`** next to each English docs page — the raw Markdown (slice 2b).

Generated at build time by a local plugin in `nera-website/plugins/llms-txt/`
that reads the Markdown sources from `pages/docs/` and `pages/tutorials/`
(ordered by `pagination_order`) and hands the files to core through
`getAssets` — writing into `public/` directly would be lost, since `public/` is
deleted after plugins run.

Plus one docs page, **"Using Nera with AI"**, in all three site languages (the
human-facing page is translated; only the machine-facing files are English).

### L3 — Machine-readable CLI output

- `nera validate --json`, `nera check --json`, `nera build --check --json`,
  `nera publish --json` print one JSON object on stdout and nothing else (logs go
  to stderr in JSON mode). Validate/check: `{ "ok": bool, "results": [...] }`
  with `@nera-static/validate`'s existing `{file, line, severity, rule,
  message}`. Exit codes unchanged.
- A review pass makes every message actionable on its own: what, where, what to
  do.
- Every interactive question in `nera new` and `nera publish` has a flag
  (principle 5); `--yes` accepts all defaults.

### L4 — A Nera skill

An Agent Skill is a folder with a `SKILL.md` (name, description, instructions)
plus optional reference files that an agent loads **on demand** when the task
matches. As of 2026-10 the format is read by Claude Code, Claude Desktop/claude.ai,
Codex, Cursor, GitHub Copilot/VS Code and Gemini CLI, among others.

**Locations (decision D4 — maximum coverage from one source):** the skill's
source lives once, in `nera-cli/skills/nera/`. `nera new` and `nera update`
copy it into **two** places in the site:

- **`.agents/skills/nera/`** — the shared location read by Codex, Cursor,
  Copilot and others;
- **`.claude/skills/nera/`** — read by Claude Code.

Both are Nera-owned and refreshed on `nera update` (like the upper part of
`AGENTS.md`). Only the portable frontmatter fields (`name`, `description`) are
used, so one file serves every client. Before slice 4, re-check each vendor's
docs for the exact folders — this area moves fast — and add a folder if a major
client needs its own.

Beyond the site folder, for people who have no site yet:

- a **downloadable zip** on nera.js.org (claude.ai and Claude Desktop install
  skills by upload);
- a **Claude Code plugin** (marketplace in a `nera-ai` repo or inside
  `nera-mcp`) that bundles the skill and the local MCP server in one install;
- later, the equivalent for Codex/ChatGPT if OpenAI's plugin directory accepts
  it.

Content:

- `SKILL.md` — when to use it ("creating, changing or publishing a Nera site")
  and the workflow: `nera new --starter` → content → plugins → validate/check →
  `nera publish`.
- `recipes/` — short task guides: business site, blog, portfolio, add a contact
  form, add search, add images, multilingual site, custom domain.
- Links to `llms-full.txt` for depth rather than copying the docs (principle 2).

### L5 — Starter kits (`nera new --starter`)

Modelled on Statamic's starter kits (decision D5): a theme is presentation
only; a **starter kit** is a whole ready-to-edit site — sample pages, config,
plugins wired up, and a theme dependency.

- **Package:** `@nera-static/starter-<name>` on npm (own repos
  `nera-starter-<name>`, flat siblings like the plugins), with a `nera.starter`
  field in `package.json` naming its human label and description. Third parties
  publish their own; `--starter` accepts a bare name (`blog` →
  `@nera-static/starter-blog`), a package name, a GitHub URL, or a local path —
  the same forms `--theme` accepts today (`validateThemeSpec` in `scaffold.js`).
- **Contents:** `pages/`, `config/`, optional site-level `theme/` overrides,
  `assets/`, a `package.json` fragment (`dependencies`: the theme and plugins),
  and an optional `README` shown after scaffolding.
- **Behaviour:** `nera new` copies the starter over the base template, merges the
  dependencies, applies `--name`/`--lang` to `config/app.yaml`, installs. After
  that the starter is gone — the site owns the files (no update path, by
  design, as with Statamic). The theme it depends on still updates via npm.
- **Interactive:** without `--starter` on a TTY, `nera new` asks "What are you
  building?" from a list fetched from the npm registry (`keywords:
  nera-starter`), with the official ones first; offline it falls back to a list
  bundled with the CLI.
- **First set:** `business` (home, about, services, opening hours, contact form,
  imprint, privacy), `blog` (tags, pagination, feed, sitemap), `portfolio`
  (images). Each needs a real theme — at least two new themes beyond
  `theme-example`; theme specs live in `generator/ROADMAP-themes.md`.

### L6 — `nera publish`: from folder to URL

The last mile, built into the CLI (decision D6). Two targets **from the first
release** (decision D8): **GitHub Pages** and **Netlify**. The source always
lands on GitHub, which every other path in this spec (and Nera Pro) builds on;
only the host differs. `nera publish --target github-pages|netlify`; on a TTY
without the flag the wizard asks (see "Choosing the target" below).

`nera publish` (first run sets everything up; every later run publishes changes)
— steps 1–3 are shared, 4–5 are per target:

1. **Sign in** with the GitHub OAuth **device flow**: the CLI shows a code, opens
   github.com/login/device in the browser, and polls. Needs only a public client
   id — no secret ships in the CLI. The token is stored in the OS keychain.
2. **No account?** The browser page offers sign-up; the CLI prints "Create an
   account there, then come back — I'll wait." Account creation itself is **not
   automated**: GitHub's sign-up has a CAPTCHA and email verification, and its
   terms forbid accounts created by bots. Guiding the human through it is the
   honest maximum.
3. **Create the repository** (name = folder name, public — free GitHub Pages
   needs a public repo on the Free plan), commit the site with the deploy
   workflow (`.github/workflows/deploy.yml`, modelled on `nera-website`'s),
   push. Uses `git` if installed, else the GitHub API (trees/commits), so git is
   not a prerequisite.
4. **Set up the host.**
   - *GitHub Pages:* enable Pages with the Actions build type via the REST API;
     set `base_path` in `config/app.yaml` for a project page
     (`user.github.io/repo`), leave it empty for a `user.github.io` repo or a
     custom domain.
   - *Netlify:* sign in with Netlify's browser flow (the "ticket" flow
     `netlify-cli` uses: create a ticket, open app.netlify.com to approve,
     poll, exchange for a token — undocumented in the OpenAPI spec but stable in
     Netlify's own js-client; verify in slice 6), offer Netlify's sign-up page if
     there is no account (same rule as GitHub: guided, never automated), create
     the site via the API, and store `NETLIFY_AUTH_TOKEN` + `NETLIFY_SITE_ID` as
     encrypted repository secrets via the GitHub API. `base_path` stays empty
     (Netlify serves from the root of `<name>.netlify.app`).
5. **Wait and report**: poll the Actions run, print the live URL, or the failing
   step with its log excerpt and a fix hint.

**One build path for both targets:** GitHub Actions always builds (`nera build`
in the generated workflow); only the last step differs — `deploy-pages` or a
deploy to Netlify's API with the stored secrets. So the hosted MCP server, a
local edit and a push from any Git tool all publish the same way, and Netlify's
own build minutes are never used.

**Netlify's free-plan credits are a design constraint.** As of 2026-10 the free
plan reportedly has a hard monthly credit budget (third-party sources: 300
credits; a production deploy ~15 credits; bandwidth extra), and exhausting it
pauses the team's sites until the next cycle. ~20 deploys a month is plenty for
a person editing by hand, but **not** for an AI committing every change.
Therefore, for the Netlify target:

- the workflow deploys on `workflow_dispatch` and on pushes to `main` only, and
  `nera publish` / the MCP `publish` tool are the deliberate "go live" moments;
- the hosted MCP server batches its commits for a conversation and deploys
  once, when the user says so;
- `nera publish` reads the account's usage via the API where possible and warns
  before a deploy would cross ~80 % of the budget.

Verify the exact numbers and the commercial-use terms against Netlify's own
pricing and terms pages in slice 6 and record them here.

Later runs: commit + push the changes, report the URL. Options:
`--domain example.com` (GitHub Pages: writes `CNAME`; Netlify: sets the custom
domain via the API; both print the DNS records to set and check them),
`--private` (GitHub Pages needs a paid GitHub plan, explained; Netlify deploys
from a private repo for free), `--json`.

**Choosing the target.** The wizard asks "Is this a site for a business?" —
yes → Netlify recommended (its terms allow commercial sites on the free plan;
GitHub's do not, see below), no → GitHub Pages recommended (one account fewer).
The user can pick either. `nera publish --target <other>` later moves a site
(new host set up, workflow's deploy step swapped, old host left untouched with a
hint how to remove it).

**The GitHub identity:** a **GitHub App** "Nera" rather than an OAuth App —
fine-grained permissions (contents, pages, actions, workflows on the
repositories the user picks, not all repos), and the same app serves the hosted
MCP server (L7) and Nera Pro. Device flow must be enabled on it.

**Business sites and GitHub's terms:** GitHub Pages "is not intended for or
allowed to be used as a free web-hosting service to run your online business,
e-commerce site, …" (GitHub Pages limits, docs.github.com). A blog or portfolio
is fine; a simple business presence is a grey zone; a shop is out. That is why
Netlify ships alongside GitHub Pages from the start, behind a **target adapter**
interface (set up, deploy step for the workflow, custom domain, status) so a
third host can be added later without touching the rest.

### L7 — MCP servers (`@nera-static/mcp`)

One package, new `nera-mcp/` repo, two ways to run it (decision D7). Both expose
the same tool definitions and call the same functions as the CLI.

#### L7a — Local (Claude Desktop, Claude Code, Cursor, Codex)

Transport **stdio**: `npx -y @nera-static/mcp --root <folder>`. Files live on the
user's computer under `--root`; every path is checked against it. Packaged as a
**Claude Desktop extension** (`.mcpb`, Node bundled, root folder chosen in a
settings dialog) so a non-developer installs it with one click.

| Tool | Does |
|---|---|
| `list_starters` / `list_themes` / `list_plugins` | catalogs with descriptions |
| `create_site` | `nera new` with starter, name, language |
| `list_sites` / `get_site` | sites under the root; config, pages tree, plugins, theme |
| `write_page` / `read_page` / `delete_page` | Markdown + frontmatter (requires `layout`) |
| `write_file` / `read_file` | config, views, assets inside the site |
| `add_plugin` | install + default config + publish its templates |
| `build` / `validate` | `nera build --check` / `nera validate`, JSON results |
| `preview` | starts `nera dev`, returns the local URL |
| `publish` | `nera publish`; returns the device code for the user on first run |

**Resources:** the docs (`llms-full.txt` bundled at release, matching the
installed version), the starter/plugin catalogs, the open site's `AGENTS.md`.
**Prompts:** "New business website", "New blog", "Add a page", "Put my site
online".

#### L7b — Hosted (claude.ai, ChatGPT, Claude mobile — no install, no Node)

claude.ai and ChatGPT reach only remote MCP servers over HTTPS; they cannot
start a local process. A hosted server cannot see the user's disk either — so
**the user's GitHub repository is the working copy.** Tools read and commit
through the GitHub API; GitHub Actions builds and deploys; the user needs
nothing but a browser and a GitHub account. That is the most effortless path of
all, and it is Nera Pro's architecture in miniature.

Differences from L7a: `create_site` creates a repo from the starter and enables
Pages in one step; `write_*` tools commit (one commit per logical change, with a
message the model writes); `build`/`validate` run on a temporary checkout on the
server and return JSON; `preview` returns the deployed URL (or, later, a
preview branch); there is no `--root`.

**What it takes to host it** (the answer to "what would be necessary"):

| Need | What | Notes |
|---|---|---|
| Server code | `@nera-static/mcp` in HTTP mode — MCP TypeScript SDK, Streamable HTTP transport, endpoint `/mcp` | same tools as L7a |
| Authentication | an **OAuth 2.1 authorization server** in front of the MCP endpoint: protected-resource metadata (RFC 9728), authorization-server metadata (RFC 8414), **dynamic client registration** (RFC 7591), PKCE, refresh tokens | claude.ai and ChatGPT both register themselves via DCR. GitHub has no DCR, so our server is the OAuth server and **delegates login to GitHub** (the GitHub App from L6) |
| Token storage | GitHub user tokens, encrypted at rest; our own access/refresh tokens | a small database (SQLite or Postgres) |
| Compute | Node 22 on a small VPS — `validate`/`build` need a real filesystem and Pug, so not an edge-function platform | Hetzner (Germany, DSGVO-friendly) via Forge — already the Nera Pro plan (`nera-platform/plans/03`); a few euros a month at first |
| Builds & hosting of the sites | none on our side — the user's GitHub Actions build, GitHub Pages serves | keeps our cost near zero |
| Domain + TLS | **`mcp.nera-pro.app`** (decision D9); Let's Encrypt | `.app` is HSTS-preloaded, so HTTPS-only from the first request — which MCP requires anyway |
| Abuse & limits | rate limits per user; tools touch only repos the GitHub App is installed on; temporary checkouts deleted after each call | |
| Operations | uptime monitoring, error tracking, logs without content, backups of the token DB, a status line in the docs | |
| Legal (Germany) | imprint, privacy policy (GitHub identity + tokens are personal data; hosting in the EU), terms of use; no content stored beyond a call | |
| Listings | submit to Anthropic's connector directory and OpenAI's app/plugin directory once stable; both review for security and quality | |

Plan requirements on the user's side, as of 2026-10: claude.ai custom
connectors need a paid Claude plan; ChatGPT needs Developer Mode (paid plans)
until the app is listed in OpenAI's directory. A listed connector removes the
manual setup for users.

### L8 — Missing plugins

- **`@nera-static/plugin-sitemap`** — `sitemap.xml` (+ `robots.txt` pointer).
- **`@nera-static/plugin-feed`** — RSS/Atom for blogs, per language.

Each gets its own ROADMAP in its own repo; the `blog` starter needs both.

## Decisions (2026-10-10)

The first round, settled with the maintainer:

- **D1 — `AGENTS.md` + `CLAUDE.md` ship by default** in every new site.
- **D2 — Existing sites get them through plain `nera update`**, no extra flag
  or command. Nera owns the part above the "Notes for this site" marker; the
  user owns the rest.
- **D3 — The AI files on nera.js.org are English only.** The site itself is in
  English, German and Spanish; models read English docs fine and translate
  freely, and three copies would triple the size for no gain.
- **D4 — Best possible skill support:** one source in `nera-cli/skills/nera/`,
  copied into `.agents/skills/` and `.claude/skills/` in every site, plus a
  downloadable zip and a Claude Code plugin.
- **D5 — Starters are chosen with `nera new --starter <name>`** (Statamic-style
  starter kits as separate packages), with an interactive picker when no flag
  is given.
- **D6 — Getting online is part of the CLI** (`nera publish`), GitHub Pages by
  default, guided sign-in and sign-up, with a target adapter interface for a
  commercial-friendly second host.
- **D7 — The MCP server is hosted too**, not only local, so claude.ai and
  ChatGPT users need no install; the user's GitHub repo is the working copy.
- **D8 — Netlify is a publish target from the first release**, next to GitHub
  Pages, and the recommended one for business sites. (Was O1.)
- **D9 — The hosted service lives under the domain `nera-pro.app`**
  (`mcp.nera-pro.app` for the MCP endpoint), which the maintainer has
  checked is available. (Was O3.)
- **D10 — The hosted MCP server is built in `nera-mcp` and runs on the Nera Pro
  infrastructure** (Hetzner via Forge, `nera-platform/plans/03`), sharing the
  GitHub App. Its plan stays here; `nera-platform/plans/` links to it rather
  than copying it. (Was O2.)
- **D11 — The maintainer, Michael Becker, operates the hosted service** in his
  own name (https://michael-becker-berlin.de): he is the provider named in the
  imprint, the controller in the privacy policy, the party to the terms of use,
  and the owner of the GitHub App, the Netlify OAuth app and the directory
  listings. Hetzner is only the processor (data processing agreement with
  Hetzner needed). Consequences for slice 9: `nera-pro.app` gets its own
  imprint, privacy policy and terms naming him, written for this service —
  GitHub identity and tokens, Netlify tokens, EU hosting, no site content kept
  beyond a call — rather than linking to michael-becker-berlin.de's pages, whose
  privacy policy describes a different processing. Have the texts checked
  before launch. (Was O4.)
- **D12 — The slice-7 rerun pins the baseline's models**:
  `claude -p --model claude-sonnet-5-5` and `codex exec --model gpt-6-luna`,
  the CLI defaults the baseline ran on. A difference to the baseline then comes
  from Nera, not from a newer model. An extra run on the then-current default
  is optional and recorded separately. (Settled while recording slice 0.)

## Semver

- L1, L4 in the template, `nera update` writing them: new files and behaviour,
  nothing existing changes → `@nera-static/nera` **minor**.
- `--json`, `--starter`, the wizard (only on a TTY without flags, so scripts
  see no change), `nera publish`: additive → **minor** each.
- `@nera-static/mcp` and each `@nera-static/starter-*`: new packages, 1.0.0
  bootstrap-published by hand, then a real x.y.1 via CI OIDC within two days so
  the Trusted Publisher does not expire (the `nera-plugin-images` lesson).
- `nera-website` changes are never released.

## Slice plan

0. **Baseline.** Run the cold agent test (see "Acceptance criteria") with
   Claude Code and Codex *before* any change; record where they fail here.
   Those failures decide what `AGENTS.md` must say. **Done 2026-10-10**, see
   "Slice 0 — baseline record".
1. **L1** — `AGENTS.md` + `CLAUDE.md` in the template and via `nera update`, the
   marker logic, the command-consistency test. **Template part done
   2026-10-10** (`@nera-static/nera` 1.6.0), see "Slice 1 — progress";
   `nera update` and the consistency test are open.
2. **L2** — `llms.txt` + `llms-full.txt` in `nera-website`; the "Using Nera with
   AI" page in en/de/es.
3. **L3** — `--json` and the message review. Slices 1 and 3 can share a release.
4. **L4** — the skill and recipes, in both site folders, plus the zip.
5. **L5** — `--starter` in the CLI and the interactive picker, proven with a
   minimal `starter-blank`; then `starter-blog` (needs L8) and
   `starter-business` (needs a theme).
6. **L6** — `nera publish` with both targets: the adapter interface, GitHub App,
   device flow, keychain, repo + workflow; GitHub Pages (Pages API,
   `base_path`); Netlify (ticket sign-in, site creation, repo secrets, credit
   warning — verify Netlify's current terms and numbers first); status polling,
   `--domain`, `--target`. Released only when both targets work.
7. Re-run the cold agent test and a **no-AI test** (a non-developer, the
   wizard only), once per target; record both here.
8. **L7a** — local MCP server, the Desktop extension, the Claude Code plugin.
9. **L7b** — hosted MCP server on `mcp.nera-pro.app`: OAuth server + GitHub
   delegation, API-backed tools, deployment, legal pages; then directory
   submissions. Legal pages per D11 before going public.
10. **Field test** — a non-developer builds a real site through claude.ai with
    only the connector. Record what broke.

Themes (for L5) and L8 run in parallel in their own repos.

## Slice 0 — baseline record (2026-10-10)

The cold agent test from "Acceptance criteria", run once per agent before any
AI-facing change. Both runs are headless and credential-isolated, and both
used `@nera-static/nera` 1.4.1 over `@nera-static/core` 4.15.0, Node 20.20.
The harness is `test/cold-agent/` (see its `README.md`). Everything below
traces to a committed file in `test/cold-agent/2026-10-10-baseline/`. `claude:N`
and `codex:N` mean line N of that agent's `transcript.md`. `files/…` are
verbatim copies of the site files a finding rests on, and `meta.md` holds the
run notes, including one discarded run per agent (a harness fault each time).

| | Claude Code (`claude-sonnet-5-5`, 11 turns, 87 s) | Codex (`gpt-6-luna`, one turn, 191 s) |
|---|---|---|
| builds; `nera validate`, `nera check` no errors | **pass** (`evaluation.txt`) | **pass** (`evaluation.txt`; its own `nera check` warned `a11y-main` once, codex:390, and the agent fixed it) |
| every requested page renders | **pass**: 6 Markdown pages → 6 HTML | **pass**: 6 → 6 |
| nothing hand-written into `public/` | **pass** | **pass** |
| contact form via `@nera-static/plugin-contact-form` | **FAIL**: a hand-written `<form>` posting to Formspree with a placeholder ID (`files/pages/kontakt.md`) | **FAIL**: a hand-written form plus an inline script that opens a `mailto:` link (`files/pages/kontakt.md`) |
| live at a URL the agent reports | **FAIL**, as expected (no `nera publish` yet): looked for the `netlify`/`vercel`/`wrangler`/`gh`/`surge` CLIs and a `gh` login (claude:108, 130–135), found no login and stopped to ask (claude:235–249). It attempted no publish. | **FAIL**, as expected: probed `gh`/`vercel`/`netlify`, env vars and `git remote` (codex:37, 49), stopped and said so (codex:509) |
| never confused Nera with another generator | **pass** | **pass** (no foreign files or dependencies), but it read the *core* README first, which says "you probably don't want this package" (codex:86–104) |

Stopping at "Get it online" is the right behaviour without credentials. The
publish criterion is measured again in slice 7. Neither run needed a human.

### Where the agents went wrong

1. **Docs reach is thin and accidental.** Claude fetched only the homepage. Its
   summary says the page does not describe the project layout, does not
   document URL routing and "doesn't cover forms" (claude:30–45). Codex opened
   nera.js.org (content not logged, `meta.md`), then fell back to web search,
   the GitHub API, the core README, a guessed raw path that returned 404 and
   the CLI README (codex:18–123).
2. **`nera new` cannot fill the folder it was given.** `nera new .` is refused
   with "Invalid project name" (codex:168–174; also Claude's discarded run,
   `meta.md`). Both agents scaffolded elsewhere and copied up. Claude used a
   sibling folder outside its own (claude:54, 108). Codex used a subfolder and
   removed it with `python3 shutil.rmtree` after its own policy blocked
   `rm -rf` (codex:179, 233, 273, 428; `meta.md`).
3. **URL shape guessed wrong** (Claude). The layout linked `/ueber-uns/`
   (`files/theme/views/layouts/layout.first.pug`). Probing
   `public/oeffnungszeiten/index.html` failed (claude:164, 185), so it rewrote
   every link to `.html` with sed (claude:189–193).
4. **No plugin was considered at all.** Both builds log
   `0 loaded` (claude:119, codex:336). Navigation is hand-written in the layout
   (`layout.first.pug`), and the contact form too (see the table). Codex's
   `mailto:` form uses the plugin's mechanism, but without its YAML field
   config, honeypot or recipient obfuscation. Claude's
   adds an external processor and an account the owner must create
   (claude:245).
5. **Pages written as HTML, not Markdown** (Codex). All six pages are raw
   `<section>` markup inside `.md` (codex:460–468, `files/pages/ueber-uns.md`).
   It renders, because Markdown allows HTML, but it defeats the content model.
6. **Pug and layout guesses broke the build** (Codex). It deleted the scaffold's
   `theme/views/pages/default.pug` while every page still named it as its
   `layout` → `ENOENT` (codex:303, 337). It wrote `!{ content }` on a line of
   its own → Pug error (codex:359–362). Then two `<main>` per page
   → `a11y-main` from `nera check`, which the agent fixed by editing both the
   layout and `pages/default.pug` (codex:390, 396). It ran `nera build` before
   `nera validate`, which reports a missing layout as `layout-unresolved` with
   the page and line.
7. **Side effects outside the folder** (Claude). It started `npx nera serve`
   in the background with a log in `/tmp/s.log` and stopped it with
   `pkill -f "nera serve"`, which would kill any other `nera serve` running
   (claude:196, `meta.md`).

Not agent errors, but read by every agent and worth fixing where they come
from: the dotenv banner `◇ injected env (0) from .env` (core's `dotenv.config()`
in `src/render.js`) and an npm deprecation warning for `glob@10.5.0` on every
`npx` (claude:59–60, codex:172–173), and `HTML created: /` once per page
instead of the page's path (claude:171–176, codex:385–388; core
`src/render.js`). The discarded Codex run (`meta.md`) also showed that a global
`nera` from the deprecated `@nera-static/installer` answers `nera build` with
installer usage when `node_modules` is missing.

Both agents marked invented business details as placeholders and flagged the
legal pages as templates to be checked. Nothing to change there.

### Fixed since the baseline (2026-10-10)

The record above stays as measured. What the same issue fixed afterwards:

-   **Finding 2:** `@nera-static/nera` 1.5.0 ships `nera new .`. It scaffolds
    into the current folder when that holds nothing but dotfiles (`.git`,
    editor folders), keeps an existing `.gitignore`, names the package after
    the folder (normalised, `nera-site` as the fallback) and drops the `cd`
    from "Next steps". 1.5.1 makes those say `npm run dev` (not `nera dev`,
    which needs a global `nera`) and folds `ß` and similar letters into the
    package name.
-   **Core log noise:** `@nera-static/core` 4.15.1 logs `HTML created:` with
    the written file (`/about.html`) instead of `/`, and runs dotenv with
    `quiet: true`. The `glob@10.5.0` deprecation warning is untouched.
-   **Harness:** Codex runs from a dedicated `CODEX_HOME` (never a copy of the
    real login), `site/` lives in its own temp folder away from `out/`, and
    `COLD_MODEL` pins a model when a comparison needs one (unset = the CLI's
    default, which is what a user gets). That `CODEX_HOME` is reset to its
    `auth.json` before every run. See `test/cold-agent/README.md`.

### Inputs for `AGENTS.md` (slice 1)

`AGENTS.md` is read only once a site exists, so findings 1 and 2 belong to
nera.js.org (L2, `llms.txt`) and the CLI (`nera new .`), not to it. Each line
below is true of core 4.15.0 / nera 1.4.1:

- **Pages are Markdown.** `pages/**/*.md` with YAML frontmatter. Write prose in
  Markdown; page structure and shared markup go in `theme/views/` (finding 5).
- **URLs.** `pages/a/b.md` becomes `public/a/b.html`, linked as `/a/b.html`.
  There are no pretty URLs (finding 3).
- **Layouts.** `layout` in a page's frontmatter names a file under
  `theme/views/` (the scaffold's pages use `pages/default.pug`). Renaming or
  deleting it breaks every page that uses it. A page without `layout` is
  not rendered, and the build says nothing; `nera validate` warns
  (`layout-missing`) (finding 6).
- **The page body.** The rendered Markdown arrives in the view as `content`,
  and the scaffold prints it with `main !{ content }` inside `block content`.
  That `<main>` is the page's only one, so the layout must not add another
  (finding 6).
- **Look for a plugin before hand-writing a feature.** Features come from
  `@nera-static/plugin-*` npm packages, picked up automatically once
  installed; most read optional settings from `config/<name>.yaml`. Link the catalog. Name the
  two these runs needed: `@nera-static/plugin-contact-form` (a `mailto:` form,
  no backend or form service; `npx nera-contact-form` copies its template to
  `theme/views/vendor/plugin-contact-form/`) and `@nera-static/plugin-navigation`
  (finding 4).
- **Order of checks.** `npx nera validate` before building, then
  `npx nera build --check`, and fix what they report. In these runs
  `nera validate` would have named the broken layout, and `nera check` did
  catch the second `<main>` (finding 6).
- **Preview.** `npm run dev` serves on port 3000. Stop it when done; do not
  kill other processes by name (finding 7).
- **Getting online.** Neither agent found a way. Until `nera publish` exists
  (slice 6), `AGENTS.md` cannot name it, because the command-consistency test
  (L1) would fail. Until then, say that `public/` after `nera build` is the
  folder to deploy.

The L1 list's other traps (`public/` wiped on every build, plugin templates
copied with `publish-template`, theme files overridden per path) were not
exercised: neither agent wrote into `public/` or published a plugin template.
They stay in, and slice 7 shows whether they hold.

## Slice 1 — progress

**Done 2026-10-10 (`@nera-static/nera` 1.6.0): the scaffold template.**
`nera new` — with or without `--theme`, and in place with `nera new .` —
writes `AGENTS.md` (118 lines, built from "Inputs for `AGENTS.md`" above) and
`CLAUDE.md` (the single line `@AGENTS.md`). `src/scaffold.js` needed no
change; it copies `template/` as it is. Settled on the way:

- **The ownership marker is one HTML-comment line directly above
  `## Notes for this site`:** it starts with `<!-- nera:site-notes` and closes
  on the same line. It is invisible when rendered, survives Markdown
  formatters, and does not depend on the heading, which a user may reword or
  translate. The literal is now a contract: `nera update` will split on it, and
  changing it later means accepting both spellings.
- **Only facts true for core 4.15.1 / nera 1.5.1.** No `nera publish`, no
  `--json`; "Getting online" says `public/` after `npm run build` is the
  folder to deploy. Local plugins are documented at core's real default,
  `src/plugins/<name>/index.js`, settable via `folders.plugins` — the L1
  folder map above said `plugins/`, which the template does not configure,
  and is corrected.
- **`AGENTS.md` links https://nera.js.org, not `/llms.txt`,** which returns
  404 until slice 2 (L2) ships on `nera-website`. The `llms.txt` link goes
  into the template with slice 2.

**Still open in slice 1**, each its own issue: `nera update` creating the two
files and replacing only the part above the marker (D2), and the test that
every `nera <command>` in `AGENTS.md` exists in the CLI's usage text.

## Where the work lands

| Repo | Slices | What lands there |
|---|---|---|
| `nera-cli` (home; this spec lives here) | 0, 1, 3, 4, 5 (CLI part), 6, 7 | baseline test record, `AGENTS.md`, `--json`, the skill, `--starter`, `nera publish` with GitHub Pages and Netlify |
| `nera-validate` | 3 (part) | the message review — the messages come from the validator |
| `nera-website` | 2, 4 (zip) | `llms.txt`/`llms-full.txt`, raw Markdown pages, the "Using Nera with AI" page, the skill download |
| `nera-mcp` (new, from slice 8) | 8–10 | local and hosted MCP server, Desktop extension, Claude Code plugin, `nera-pro.app` legal pages |
| `nera-starter-*`, new `nera-theme-*` (new) | 5 (content) | the starter kits and the themes they need; theme specs in `generator/ROADMAP-themes.md` |
| `nera-plugin-sitemap`, `nera-plugin-feed` (new) | L8 | each gets its own ROADMAP |
| `nera-platform` | — | links to L7b, no copy (D10) |

New repos are created only when their slice starts, not ahead of time.

**Tracking:** the Snagio project **"Nera AI"** holds the whole backlog on one
board — one group per slice (`S0 Baseline` … `S10 Field test`, plus `Parallel:
themes and plugins`), ordered, each issue titled `[<repo>] …` with an
`external_ref` of the form `roadmap-ai/<slice>/<key>` (imported 2026-10-10, 33
issues). The step skills commit in the repo Claude runs in, so an issue is
worked **from the repo its title names**: when a repo's turn comes, run
`snagio install` there and put the same token in its git-ignored `.env`. Issues
link to sections of this file; this file stays the spec, Snagio only tracks
progress.

## Acceptance criteria

**Cold agent test** — an empty folder, a fresh session with no Nera context,
Node installed, one prompt:

```text
Create a website for my bakery "Brot & Zeit" in Berlin with Nera
(https://nera.js.org): home, about us, opening hours, contact form, imprint
and privacy page. Get it online.
```

Passes when, with the human only entering the GitHub device code:

- the site builds; `nera validate` and `nera check` report no errors
- every requested page renders (none skipped for a missing `layout`)
- nothing was hand-written into `public/`
- the contact form uses `@nera-static/plugin-contact-form`, not invented markup
- the site is live at a URL the agent reports
- the agent never confused Nera with another generator

Run with Claude Code and Codex after slice 6, with Claude Desktop + the
extension after slice 9, with claude.ai and ChatGPT + the hosted connector after
slice 10.

**No-AI test** — a person who has never used a terminal beyond pasting one
command runs `npx @nera-static/nera new my-site` and has a live site in under
ten minutes, without reading docs.

## Open questions

None. O1–O4 are settled (D8–D11). New questions go here.

## Later

- `@nera-static/plugin-llms-txt` — the website's generator as a plugin, so every
  Nera site can publish its own `llms.txt` for its visitors' AIs.
- MCP tools for images (`plugin-images` presets) and translations.
- Preview branches (a deploy per draft) for the hosted server.
- A Codex/ChatGPT plugin bundling the skill and the connector, once OpenAI's
  directory accepts third-party plugins of that shape.
