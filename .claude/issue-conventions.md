# Issue conventions

Review rules for work on `@nera-static/nera` (the Nera CLI), run through Snagio from
`nera-cli/`. The Snagio project **"Nera AI"** tracks `ROADMAP-ai.md`; its issues
carry the target repo as a title prefix (`[nera-cli]`, `[nera-website]`,
`[nera-validate]`, `[nera-mcp]`, …). **Work an issue only from the repo it names** —
the step skills commit in the current repo. An issue for another repo stays open
here until that repo has the skills installed (same token, one shared board).

The workspace `../CLAUDE.md` holds the fleet-wide rules (semver, CHANGELOG,
releases, plugin contract); this file only adds what a reviewer checks per diff.

## Non-negotiables

- **`ROADMAP-ai.md` is the spec and the single source of truth.** An issue links to
  its section instead of restating it. A decision made while working an issue is
  written back into the ROADMAP (Decisions or the slice's "Done" note) in the same
  commit — never only into the issue.
- **Semver + `CHANGELOG.md` in the same commit as the change** (Keep a Changelog,
  four-space bullets, `**BREAKING**:` prefix). Bump with
  `npm version <bump> --no-git-tag-version`, never by hand-editing `package.json`.
  Template changes that only affect *new* sites are minor; anything that changes an
  existing site on `nera update` is judged by what that site would notice.
- **Never publish or push.** No `npm publish`, no `git push`, no tags pushed, no
  posts on GitHub, Netlify or anywhere public. Releases go out by the maintainer
  pushing a `v*` tag; the session hands over the exact commands.
- **Never ask in non-interactive mode.** Every question `nera new` / `nera publish`
  asks has a flag; without a TTY or with `--yes` nothing is ever prompted
  (ROADMAP principle 5). A prompt an agent cannot answer is a bug.
- **Secrets:** tokens (GitHub, Netlify, Snagio) are never logged, printed, written
  into a site's files or committed. Tests use fakes, never real tokens or accounts.
- **`nera update` never overwrites what the user owns:** the part of `AGENTS.md`
  below the "Notes for this site" marker, an `AGENTS.md` without the marker,
  pages, config, views.
- Paste-ready text for the maintainer (release notes, comments) goes in a fenced
  code block between `----- START: … -----` and `----- END -----` lines, never in a
  blockquote.

## Framework correctness

- ESM only, Node `^20.19.0 || >=22.12.0`; eslint style: 4-space indent, no
  semicolons, single quotes. No new runtime dependency without a stated reason —
  every site installs this package.
- Commands return an exit code; only `bin/nera.js` calls `process.exit`, so the
  `run*` functions stay testable.
- Heavy dependencies (vite, chokidar, future GitHub/Netlify clients, keychain) are
  imported lazily inside the command that needs them.
- `--json` output: exactly one JSON object on stdout, logs on stderr, exit codes
  identical to text mode.
- The CLI, the wizard and the future MCP tools call the same functions; no logic
  duplicated in a command handler (ROADMAP principle 4).
- Anything the template's `AGENTS.md` claims about Nera must be true for the
  `@nera-static/core` version the template depends on — check against `../generator`.

## UI / template rules

- The scaffold `template/` (`.pug`, CSS) is the first thing a new user sees: it must
  build with `nera build`, pass `nera validate` and `nera check` with no errors, and
  keep its starter marker comment on the first line of starter templates.
- Template markup in `theme/views/` is site-owned after scaffolding, so changing it
  only affects new sites (minor), never existing ones.
- Interface language of the CLI and of `AGENTS.md`/skill texts: English. Messages
  say what is wrong, where, and what to do.

## UI walkthrough

- Browser tooling: Playwright MCP (`mcp__playwright__browser_navigate`,
  `mcp__playwright__browser_click`, `mcp__playwright__browser_snapshot`,
  `mcp__playwright__browser_console_messages`).
- Boot (a throwaway site from the *local* checkout, never from npm):
  `R=$PWD; T=$(mktemp -d) && cd "$T" && node "$R/bin/nera.js" new site --no-install && cd site && npm install "$R" && npx nera build && npx nera serve --port 3123`
  (`nera new` takes a plain name, not a path; `nera serve` opens a browser tab on
  its own; Node 22 for the install if npm crashes:
  `PATH=~/.nvm/versions/node/v22.22.0/bin:$PATH`). Verified 2026-10-10: a fresh
  site builds, validates clean and has 3 `nera check` warnings. Delete `$T`
  afterwards.
- Base URL / login: http://localhost:3123/, no login.
- Surfaces:
    | surface | url | role | how to open |
    |---|---|---|---|
    | `template/theme/views/layouts/layout.pug`, `pages/default.pug` | `/` | visitor | open the start page |
    | starter templates (later, `--starter`) | `/` and each sample page | visitor | scaffold with `--starter <name>` in the boot command |

## Tests & hygiene

- `npx vitest run && npm run lint` must pass (`npm test` is watch mode — never use
  it here). Run from the package root.
- New behaviour has a test in `test/`, in the style of the neighbouring file
  (temp-dir projects for scaffold/update; no network — stub fetch/registry calls).
- Instruments: unit tests prove argument parsing, file writes and exit codes; the
  temp-site boot above proves a scaffolded site really builds and renders; the
  ROADMAP's **cold agent test** (slices 0, 7) proves an AI can actually use it —
  green unit tests say nothing about that.

## Reconciliation steps (run when resolving an issue)

- Version bump + `CHANGELOG.md` entry in the change's commit, if it ships in the
  tarball (`bin/`, `src/`, `template/`); none for ROADMAP, tests, CI or `.claude/`.
- Update `ROADMAP-ai.md`: mark the slice item done with the date and any choice
  made on the way.
- If the README's command list or options changed, update `README.md` (and the
  CLI docs page in `../nera-website/pages/docs/cli.md` gets its own issue).
- Hand over the release commands (`git push`, `git tag -a v<x.y.z> …`) — do not run
  them.
