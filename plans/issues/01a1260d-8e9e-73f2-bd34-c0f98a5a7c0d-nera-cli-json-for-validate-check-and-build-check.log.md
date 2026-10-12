# Work log — 01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d-nera-cli-json-for-validate-check-and-build-check

- **Issue:** `01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d`

## Issue snapshot (2026-10-12)

- **Id:** `01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d`
- **Type:** feature
- **Group:** S3 JSON output
- **Status:** in_progress
- **Title:** [nera-cli] --json for validate, check and build --check

Spec: `nera-cli/ROADMAP-ai.md` — L3.

One JSON object on stdout (`{ ok, results }`), logs to stderr, exit codes unchanged. Tests per command. Can share a release with S1.

## Cloud launch (2026-10-12)

- **Worked in a Claude Code cloud session**, outside the local plan → implement → review → approve loop (to use the cloud credit). The gate was not armed.
- **Brief:** `plans/cloud/01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d-brief.md` · **Branch:** `issue/01a1260d-json-output` · **Session:** launched by the user via `! claude --cloud …` (the Bash tool has no TTY); URL to be added
- **On return:** `/work-issue-cloud 01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d` — verify locally, triage, merge, reconcile, resolve.

## Cloud result (2026-10-12)

- **Branch:** `issue/01a1260d-json-output` (same commit also pushed as `claude/json-output-validate-check-fkqde9`) · 7 commits · result file `plans/cloud/01a1260d-8e9e-73f2-bd34-c0f98a5a7c0d-result.md`
- **Summary:** `--json` on `nera validate`, `nera check`, `nera build` via one helper `src/json-output.js` (`runJson`): console.log/info/debug and raw `process.stdout.write` go to stderr while the command runs, then one object `{ ok, results }` or `{ ok: false, error, results: [] }` goes to stdout. Usage lines, `template/AGENTS.md`, README document it; `test/json-output.test.js` (17 tests) incl. child-process pure-stdout proofs.
- **Verified locally:** Node 22.22.0, `npm ci && npm run lint && npx vitest run` → lint clean, 9 files / 123 tests pass.
- **Verified locally:** script in a scaffolded temp site, 8 cases (check without public/, validate clean/error, build --check warn/error, check warn/error, plain build): whole stdout `JSON.parse`s every time, exit code with `--json` equals text mode in each, build log (10 lines) on stderr.
- **Review findings:** none blocking. Only stderr line on validate/check is dotenv's `injected env` banner from core 4.15.0 (lockfile); text mode prints the same, stderr only.

### Decisions
- JSON mode also re-routes raw `process.stdout.write` to stderr; the object is written through the restored stdout afterwards. `console.warn`/`error` untouched.
- `runJson` stays sync for a sync body, so `runValidate`/`runCheck` keep returning a number.
- `ok = !hasErrors(results)`, exit `ok ? 0 : 1`; a thrown error → `ok: false`, exit 1, not rethrown (no `❌` line).
- `build --check --json` calls `validateOutput` directly inside the JSON body (not `runCheck`, which would print a second object).
- `results` passed through unchanged, so it carries extra fields the installed validate adds (`source` on check findings); docs name the five guaranteed fields.
- The bin sets `process.exitCode` for validate/check instead of `process.exit()`, so a large object written to a pipe is not cut off.
- `--json` sits on each command's own usage line (the consistency test only reads those).
- `test/scaffold.test.js`: AGENTS.md line cap 120 → 124; "no `--json`" assertion dropped since it exists now.

### Carry forward
- `template/AGENTS.md` at 124 lines, over L1's "at most ~120".
- `src/commands/build.js` text mode calls `runCheck()` without `cwd` (relies on process.cwd(), as core does).
- Slice 8: an in-process MCP caller will want the `{ ok, results }` value returned, not printed.
- Lockfile pins core 4.15.0 / validate 1.2.0 (npm: 4.15.2 / 1.4.1); untested against the newer ones.

## Triage (2026-10-12)

| # | item | from | disposition | why |
|---|---|---|---|---|
| 1 | `template/AGENTS.md` at 124 lines, over L1's "at most ~120" | cloud result | fix | default: keep the 4-line bullet and the 124 cap, write "at most ~125" into ROADMAP-ai.md L1 with the reason (trimming would drop the shape agents need) |
| 2 | lockfile pins core 4.15.0 / validate 1.2.0, npm has 4.15.2 / 1.4.1 | local review | fix | lockfile-only `npm update @nera-static/core @nera-static/validate`, re-run lint + tests, so `--json` is proven against the current validator; no release |

Already done / elsewhere: `build.js` runCheck() without cwd (works, cwd is core's too); MCP wants the value returned (slice 8, goes into the spec note).

## Reconciled (2026-10-12)

- Triage approved as classified: L1 cap ~125 written into ROADMAP-ai.md; lockfile on core 4.15.2 / validate 1.4.1 (`8a3d692`), tests 123/123.
- Merged into `main` by fast-forward; `chore(release): 1.9.0` (version + CHANGELOG); ROADMAP-ai.md "Slice 3 — progress" + status header + slice plan.
- Release: tag `v1.9.0` handed to the maintainer, not pushed.
