# ROADMAP — Nera for AI assistants

> **Status: draft spec, written 2026-10-10. Nothing implemented. The open
> questions at the end need the maintainer's decision before slice 1.**
>
> This document is the single source of truth for making Nera easy to set up
> and run *through* an AI assistant — Claude Code, Claude Desktop, OpenAI Codex,
> ChatGPT, Cursor, Copilot. It lives in `nera-cli` because most of the work lands
> in the CLI and its scaffold `template/`; the parts in `nera-website` and in a
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

So the core problem is **knowledge**, and only secondarily **tools**:

| User's AI | Can it run commands and edit files? | What it lacks |
|---|---|---|
| Coding agent — Claude Code, Codex, Cursor, Copilot agent | yes | knowledge of Nera's conventions; machine-readable feedback |
| Chat app — Claude Desktop, ChatGPT | no (only through MCP) | knowledge **and** hands |

A coding agent can already run `npx @nera-static/nera new bakery`. It needs to
be told how Nera works, at the moment it opens a Nera project. A chat app needs
an MCP server to act at all.

And even a perfectly informed AI cannot deliver "effortless" if the parts are
missing: today there is one theme (`theme-example`), no sitemap or feed plugin,
and no deploy workflow in a new site. An AI can only assemble what exists.

## What MCP is (for the record)

The Model Context Protocol is an open standard (started by Anthropic in 2024,
now supported by OpenAI, Google, Microsoft, Cursor and others) through which an
AI client talks to a **server** that offers **tools** (functions the model may
call, e.g. `create_site`), **resources** (documents it may read, e.g. the docs)
and **prompts** (ready-made task starters). A server runs either locally as a
child process over stdio or remotely over HTTP. One server works in every client
that speaks MCP.

## Principles

1. **Knowledge first, tools second.** Cheap text that every AI reads beats an
   integration that only some clients load. Layers L1–L4 below help every
   assistant; L5 (MCP) helps chat apps.
2. **One source of truth for AI-facing knowledge.** The docs on nera.js.org are
   the truth. Everything an AI reads — `llms.txt`, the skill, the MCP server's
   resources — is generated from them or points to them, never a hand-kept copy.
   Hand-kept copies drift; this workspace has paid for that more than once
   (vendored templates, the website plugin catalog).
3. **Short in-project instructions, deep docs elsewhere.** The `AGENTS.md` in a
   site holds only what is stable and what an agent gets wrong without it
   (folders, commands, the traps). Everything else is a link.
4. **The CLI stays the engine room.** The MCP server calls the same code paths
   as `nera new/build/validate/check`; it adds no second implementation.
5. **Safe by default.** The MCP server writes only inside a folder the user
   chose, never runs arbitrary shell commands, and never publishes anything
   without an explicit tool call the user sees.

## Layers

### L1 — Agent instructions in every new site

`nera new` writes two more files into the site:

- **`AGENTS.md`** — the cross-tool convention read by Codex, Cursor, Copilot,
  Gemini CLI and others. Content, at most ~120 lines:
  - what Nera is, in two sentences, and the link to https://nera.js.org/llms.txt
  - the folder map: `pages/` (Markdown + frontmatter), `theme/views/` (Pug),
    `theme/assets/`, `config/*.yaml`, `plugins/` (local plugins), `public/`
    (generated, **never edit**)
  - the commands: `npm run dev`, `npm run build`, `npx nera validate`,
    `npx nera check`, and `--json` (L3) for machine-readable results
  - the traps, each one line: a page needs `layout` in its frontmatter or it is
    silently skipped; `public/` is wiped on every build; plugins come from npm as
    `@nera-static/plugin-*` and are configured in `config/<name>.yaml`; plugin
    templates are copied with `publish-template` and included by hand; a theme
    file is overridden by a site file at the same path
  - "after every change: run `nera validate`, then `nera build --check`, and fix
    what they report"
  - how to add a plugin, in four steps, with the link to the plugin catalog
- **`CLAUDE.md`** — one line, `@AGENTS.md`, so Claude Code loads the same text
  (Claude Code reads `CLAUDE.md`, not `AGENTS.md`, and follows `@` imports).

A test in `nera-cli` asserts that every `nera <command>` the template's
`AGENTS.md` mentions exists in the CLI's usage text, so the instructions cannot
silently go stale when a command changes.

**Existing sites** get the files via `nera update --agents` (see open question
Q2), which writes them only where they are missing.

### L2 — AI-readable docs on nera.js.org

`nera-website` publishes:

- **`/llms.txt`** — the [llms.txt](https://llmstxt.org) convention: an H1, a
  one-paragraph summary, then linked sections (Docs, Tutorials, Plugins, CLI,
  Themes), each link with a one-line description. English only.
- **`/llms-full.txt`** — the complete English docs and tutorials as one Markdown
  file, frontmatter stripped, pages in navigation order.
- **`/<page>.md`** next to each English docs page — the raw Markdown, so an
  agent following a link gets text, not HTML (optional, slice 2b).

Generated at build time by a local plugin in `nera-website/plugins/llms-txt/`
that reads the Markdown sources from `pages/docs/` and `pages/tutorials/`
(ordered by `pagination_order`) and hands the files to core through
`getAssets` — writing into `public/` directly would be lost, since `public/` is
deleted after plugins run. No hand-maintained text beyond the summary paragraph.
If it proves useful to other sites, it graduates later to
`@nera-static/plugin-llms-txt` (see "Later").

Plus one docs page, **"Using Nera with AI"**, in all three languages: how to
point Claude Code / Codex / Cursor at a site, the `AGENTS.md` files, the MCP
server once it exists, and a set of example prompts.

### L3 — Machine-readable CLI output

An agent fixes its own mistakes only if it can read the results reliably.
`@nera-static/validate` already returns structured findings
(`{file, line, severity, rule, message}`); the CLI only prints them as text.

- `nera validate --json`, `nera check --json`, `nera build --check --json` print
  `{ "ok": bool, "results": [...] }` on stdout and nothing else (build logs go
  to stderr in JSON mode). Exit codes unchanged.
- Every message stays actionable on its own: what is wrong, where, and what to
  do. A review pass over existing messages is part of this slice.
- `nera new` must run fully non-interactively (it does today — keep it so;
  `--no-install` and `--theme` exist). Any future prompt gets a flag.

### L4 — A Nera skill

An Agent Skill is a folder with a `SKILL.md` (name, description, instructions)
plus optional reference files and scripts that an agent loads **on demand** when
the task matches. Claude Code and Claude Desktop support skills; other clients
are adopting the format (see open question Q4 — verify at implementation time).

`skills/nera/` in this repo:

- `SKILL.md` — when to use it ("creating, changing or deploying a Nera site")
  and the workflow: scaffold → choose theme/starter → content → plugins →
  validate/check → deploy.
- `recipes/` — short task guides: business site, blog, portfolio, add a contact
  form, add search, add images, multilingual site, deploy to GitHub Pages.
- Links to `llms-full.txt` for depth rather than copying the docs (principle 2).

Distribution: shipped in the template at `.claude/skills/nera/` (so it is there
whenever an agent works in a Nera site) and as a downloadable zip on nera.js.org
for people starting from a chat app with no site yet.

### L5 — MCP server (`@nera-static/mcp`)

A separate package in a new `nera-mcp/` repo, not a `nera mcp` subcommand: it
must work **before a site exists** (the user's first sentence is "make me a
website"), and it pulls in the MCP SDK, which no site should have to install.
It depends on `@nera-static/nera` and calls its functions in-process.

Transport: **stdio**, run as `npx -y @nera-static/mcp --root <folder>`. `--root`
is the folder the server may create and edit sites in; every path is resolved
and checked against it.

**Tools** (first version):

| Tool | Does | Notes |
|---|---|---|
| `create_site` | `nera new` with name, optional theme/starter | installs dependencies |
| `list_sites` | sites under the root | |
| `get_site` | config, pages tree, plugins, theme of one site | the model's map |
| `list_themes` / `list_plugins` | catalog with descriptions | from the npm registry, filtered to `@nera-static/*` |
| `add_plugin` | install + default `config/<name>.yaml` + publish its templates | shows what to include in the layout |
| `write_page` / `read_page` / `delete_page` | Markdown + frontmatter | validates frontmatter (`layout` present) |
| `write_file` / `read_file` | config, views, assets | inside the site only |
| `build` | `nera build --check` | returns JSON results (L3) |
| `validate` | `nera validate` | JSON results |
| `preview` | starts `nera dev`, returns the URL | one server per site, stopped on exit |

**Resources:** the docs (`llms-full.txt` as bundled at release time, so it
matches the installed version), the plugin catalog, and the open site's
`AGENTS.md`.

**Prompts:** "New business website", "New blog", "Add a page", "Get my site
online".

**Packaging for non-developers:** a **Claude Desktop extension** (`.mcpb`
bundle) — one-click install, with Node bundled, and the root folder chosen in
a settings dialog. Without it the user edits a JSON config file and needs Node
installed, which defeats "effortless". Published as a GitHub release asset and
linked from the docs.

**Deploying** is deliberately not a tool in the first version (open question
Q6): it needs credentials, and publishing is the one step the user must see.

### L6 — The parts an AI needs to assemble

Not AI work, but the reason L1–L5 would disappoint without it. Each item gets
its own spec in its own repo, as usual; this list only orders them.

- **P1 — Deploy workflow in new sites.** `nera new` writes
  `.github/workflows/deploy.yml` for GitHub Pages (modelled on `nera-website`'s),
  plus a docs section on `base_path` for project pages
  (`user.github.io/repo`). Belongs to this spec (slice 6) because it is template
  work.
- **P2 — Starters.** `nera new --starter business|blog|portfolio`: a theme plus
  sample pages, config and plugins wired up. Needs at least two real themes
  beyond `theme-example`. Spec: extend `generator/ROADMAP-themes.md` with a
  starters section (open question Q5).
- **P3 — `@nera-static/plugin-sitemap`** — `sitemap.xml` (+ `robots.txt`
  pointer). Every business site wants it.
- **P4 — `@nera-static/plugin-feed`** — RSS/Atom for blogs, per language.

## Semver

- L1, P1, the skill in the template: new files in **new** sites only →
  `@nera-static/nera` **minor**.
- `nera update --agents`: new flag → **minor**.
- L3 `--json`: new flag → **minor**. Moving build logs to stderr *only in JSON
  mode* leaves the default output untouched.
- `@nera-static/mcp`: new package, 1.0.0 bootstrap-published by hand, then a
  real 1.0.1 via CI OIDC within two days so the Trusted Publisher does not
  expire (the `nera-plugin-images` lesson).
- `nera-website` changes are never released.

## Slice plan

0. **Baseline.** Run the "cold agent test" (see "Acceptance criteria") with
   Claude Code and Codex *before* any change, record the transcripts' failure
   points in this file. They decide what `AGENTS.md` must say.
1. **L1 — `AGENTS.md` + `CLAUDE.md` in the template**, with the
   command-consistency test. Release `nera` minor.
2. **L2 — `llms.txt` + `llms-full.txt`** in `nera-website` via the local
   plugin; the "Using Nera with AI" page in en/de/es.
3. **L3 — `--json`** for validate/check/build, message review. Release `nera`
   minor (can ship together with slice 1).
4. **L4 — skill** with recipes; in the template and as a download.
5. **P1 — deploy workflow** in the template + `base_path` docs.
6. Re-run the cold agent test; record the result here.
7. **L5 — MCP server**: package, tools, resources, prompts, tests against a temp
   root; then the Desktop extension bundle; docs.
8. **Field test**: a non-developer builds a real site through Claude Desktop
   with only the extension installed. Record what broke.

P2–P4 run in parallel in their own repos; slice 7's `create_site` gains
`starter` when P2 lands.

## Acceptance criteria

The **cold agent test**: an empty folder, a fresh session with no Nera context,
Node installed, and one prompt:

```text
Create a website for my bakery "Brot & Zeit" in Berlin with Nera
(https://nera.js.org): home, about us, opening hours, contact form, imprint
and privacy page. Get it ready to put online with GitHub Pages.
```

Passes when, without the human correcting the agent:

- the site builds; `nera validate` reports no errors and `nera check` no errors
- every requested page renders (none skipped for a missing `layout`)
- nothing was hand-written into `public/`
- the contact form uses `@nera-static/plugin-contact-form`, not invented markup
- a deploy workflow exists and would publish `public/`
- the agent never confused Nera with another generator

Run with Claude Code and Codex after slices 1–5 (agent route) and with Claude
Desktop + the MCP extension after slice 7 (chat route).

## Open questions

- **Q1 — Ship `AGENTS.md` by default, or behind `nera new --agents`?**
  Proposal: by default. Two small text files cost nothing; a beginner would not
  know to ask for them.
- **Q2 — Existing sites:** `nera update --agents`, or a separate `nera agents`
  command? Proposal: the `update` flag, to avoid growing the command list.
- **Q3 — `llms-full.txt` languages:** English only (proposal — models translate
  freely, and three copies triple the size), or all three?
- **Q4 — Skill locations:** which clients read skills from which folder
  (`.claude/skills/` for Claude; Codex and others to be verified at
  implementation time). Ship one copy per client folder, or only Claude's?
- **Q5 — Starters vs. themes:** is a starter a theme plus sample content (in the
  theme package), or a separate template in `nera-cli`? Decides where P2's spec
  lives.
- **Q6 — Deploy in MCP:** leave deploy to the generated GitHub workflow (the
  user pushes), or add a `deploy` tool later (needs a GitHub token in the
  extension's settings)? Proposal: later, together with Nera Pro.
- **Q7 — ChatGPT:** as of writing, ChatGPT connects to **remote** MCP servers
  rather than local stdio ones (to verify at slice 7). A remote server means
  hosting and accounts — that is Nera Pro's territory. Proposal: v1 targets
  Claude Desktop and coding agents; ChatGPT through Nera Pro.

## Later

- `@nera-static/plugin-llms-txt` — the website's generator as a plugin, so every
  Nera site can publish its own `llms.txt` (useful for the sites' own visitors'
  AIs, not just for Nera's docs).
- A remote MCP endpoint on Nera Pro (`nera-platform/`), reusing the L5 tool
  definitions, so ChatGPT and claude.ai users need no local install.
- MCP tools for images (`plugin-images` presets) and translations
  (add a language to a site).
- A listing in the public MCP server registries once v1 is stable.
