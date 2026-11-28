import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { nera } from '@nera-static/test-utils'
import { validateSite, validateOutput } from '@nera-static/validate'
import { scaffoldProject } from '../src/scaffold.js'
import { runValidate } from '../src/commands/validate.js'
import { runCheck } from '../src/commands/check.js'
import { cliRoot } from './helpers/cli-root.js'

// `--json` (ROADMAP-ai.md L3): one JSON object on stdout, logs on stderr, the
// same exit code as text mode. In-process tests prove the shape and the exit
// codes of validate and check; `nera build`, which core runs in the working
// directory, and the whole-stdout proofs run this repo's CLI as a child in
// the site, with the engine's build log on stderr.

// `nera ...args` in the scaffolded site, with this repo's bin/nera.js.
const cli = (args) => nera(target, args, { root: cliRoot() })

// A built page that is clean except for its missing `lang` (a11y-html-lang).
const builtHtml = (htmlAttrs) =>
    `<!DOCTYPE html>\n<html${htmlAttrs}>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <a href="#main">Skip</a><main id="main"><h1>Hi</h1></main><footer><a href="/imprint.html">Imprint</a> <a href="/privacy.html">Privacy</a></footer>\n  </body>\n</html>\n`

let workdir, target, stdout, log, error

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-json-'))
    target = await scaffoldProject('site', { cwd: workdir, install: false })
    // Silence both modes; stdout is spied on to read the JSON object.
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    stdout.mockRestore()
    log.mockRestore()
    error.mockRestore()
    await fs.rm(workdir, { recursive: true, force: true })
})

// Everything written to stdout, parsed as one JSON document.
const printedJson = () => JSON.parse(stdout.mock.calls.map(([chunk]) => String(chunk)).join(''))

const writePublic = async (html) => {
    await fs.mkdir(path.join(target, 'public'), { recursive: true })
    await fs.writeFile(path.join(target, 'public', 'index.html'), html)
}

const promote = (rule) =>
    fs.writeFile(path.join(target, 'config', 'validate.yaml'), `rules:\n  ${rule}: error\n`)

// A page whose image has no `alt`, so `--check` has a known finding
// (a11y-img-alt) that does not depend on a scaffold defect.
const addPageWithoutAlt = () =>
    fs.writeFile(
        path.join(target, 'pages', 'photo.md'),
        '---\nlayout: pages/default.pug\ntitle: Photo\n---\n# Photo\n\n<img src="/photo.jpg">\n',
    )

describe('nera validate --json', () => {
    const cases = {
        clean: async () => {},
        'warnings-only': () =>
            fs.writeFile(path.join(target, 'pages', 'draft.md'), '---\ntitle: Draft\n---\n# x\n'),
        error: () =>
            fs.writeFile(
                path.join(target, 'pages', 'index.md'),
                '---\nlayout: pages/nope.pug\n---\n# x\n',
            ),
    }

    for (const [name, arrange] of Object.entries(cases)) {
        it(`${name}: same exit code as text mode, results as validateSite returns them`, async () => {
            await arrange()
            const textCode = runValidate({ cwd: target })
            stdout.mockClear()

            const code = runValidate({ cwd: target, json: true })
            const results = validateSite({ cwd: target })

            expect(code).toBe(textCode)
            expect(printedJson()).toEqual({ ok: code === 0, results })
            if (name === 'warnings-only') {
                expect(results.length).toBeGreaterThan(0)
                expect(results.every((r) => r.severity === 'warning')).toBe(true)
            }
        })
    }

    it('expected exit codes: 0, 0, 1', async () => {
        expect(runValidate({ cwd: target, json: true })).toBe(0)
        await cases['warnings-only']()
        expect(runValidate({ cwd: target, json: true })).toBe(0)
        await cases.error()
        expect(runValidate({ cwd: target, json: true })).toBe(1)
    })
})

describe('nera check --json', () => {
    const cases = {
        clean: () => writePublic(builtHtml(' lang="en"')),
        'warnings-only': () => writePublic(builtHtml('')),
        error: async () => {
            await writePublic(builtHtml(''))
            await promote('a11y-html-lang')
        },
    }
    const expected = { clean: 0, 'warnings-only': 0, error: 1 }

    for (const [name, arrange] of Object.entries(cases)) {
        it(`${name}: same exit code as text mode, results as validateOutput returns them`, async () => {
            await arrange()
            const textCode = runCheck({ cwd: target })
            stdout.mockClear()

            const code = runCheck({ cwd: target, json: true })

            expect(code).toBe(textCode)
            expect(code).toBe(expected[name])
            expect(printedJson()).toEqual({ ok: code === 0, results: validateOutput({ cwd: target }) })
        })
    }

    it('without public/: exit 1 and the failure shape instead of a throw', () => {
        expect(() => runCheck({ cwd: target })).toThrow('run `nera build` first')

        expect(runCheck({ cwd: target, json: true })).toBe(1)
        const out = printedJson()
        expect(out).toEqual({ ok: false, error: expect.any(String), results: [] })
        expect(out.error).toContain('run `nera build` first')
    })

    it('restores console.log and stdout afterwards', () => {
        const before = { log: console.log, write: process.stdout.write }
        runCheck({ cwd: target, json: true })
        expect(console.log).toBe(before.log)
        expect(process.stdout.write).toBe(before.write)
    })
})

// The child runs below build the site once or twice each: past vitest's
// 5 s default under load.
describe('nera build --json', () => {
    it('without --check: { ok: true, results: [] }, the build log on stderr', async () => {
        const { code, stdout, stderr } = await cli(['build', '--json'])

        expect(code).toBe(0)
        // The whole stdout is the one object; the engine's log went to stderr.
        expect(JSON.parse(stdout)).toEqual({ ok: true, results: [] })
        expect(stderr).toContain('Found 3 page(s) to process')
        expect(stderr).toContain('HTML created')
    }, 30_000)

    for (const [name, rule, expectedCode] of [
        ['warnings-only', null, 0],
        ['error', 'a11y-img-alt', 1],
    ]) {
        it(`--check, ${name}: same exit code as text mode, one { ok, results } object`, async () => {
            await addPageWithoutAlt()
            if (rule) await promote(rule)
            const text = await cli(['build', '--check'])

            const { code, stdout, stderr } = await cli(['build', '--check', '--json'])

            expect(code).toBe(text.code)
            expect(code).toBe(expectedCode)
            const results = validateOutput({ cwd: target })
            expect(results.map((r) => r.rule)).toContain('a11y-img-alt')
            expect(JSON.parse(stdout)).toEqual({ ok: code === 0, results })
            expect(stderr).toContain('Found 4 page(s) to process')
        }, 30_000)
    }

    it('--check, clean: exit 0 and ok with no results', async () => {
        // The scaffold's two legal check warnings, switched off.
        await fs.writeFile(
            path.join(target, 'config', 'validate.yaml'),
            'rules:\n  legal-imprint-link: off\n  legal-privacy-link: off\n',
        )
        const text = await cli(['build', '--check'])

        const { code, stdout } = await cli(['build', '--check', '--json'])

        expect(code).toBe(text.code)
        expect(code).toBe(0)
        expect(JSON.parse(stdout)).toEqual({ ok: true, results: validateOutput({ cwd: target }) })
    }, 30_000)

    it('a failed build: exit 1 and the failure shape', async () => {
        // A `theme:` that does not resolve makes the engine's run() throw.
        await fs.appendFile(path.join(target, 'config', 'app.yaml'), '\ntheme: ./no-such-theme\n')
        // Text mode rethrows; the bin turns that into ❌ and exit 1.
        const text = await cli(['build', '--check'])
        expect(text.code).toBe(1)
        expect(text.stderr).toContain('❌')

        const { code, stdout, stderr } = await cli(['build', '--check', '--json'])

        expect(code).toBe(1)
        expect(JSON.parse(stdout)).toEqual({ ok: false, error: expect.any(String), results: [] })
        expect(stderr).not.toContain('❌')
    }, 30_000)
})

describe('bin/nera.js --json, as a child process', () => {
    it('validate --json and check --json print only JSON; exit codes match text mode', async () => {
        for (const command of ['validate', 'check']) {
            const json = await cli([command, '--json'])
            const text = await cli([command])
            expect(json.code).toBe(text.code)
            expect(() => JSON.parse(json.stdout)).not.toThrow()
        }
        // check without public/ ends 1 in both modes.
        expect((await cli(['check', '--json'])).code).toBe(1)

        await addPageWithoutAlt()
        await promote('a11y-img-alt')
        await cli(['build'])
        const json = await cli(['check', '--json'])
        expect(json.code).toBe(1)
        expect(json.code).toBe((await cli(['check'])).code)
        expect(JSON.parse(json.stdout).ok).toBe(false)
        // Eight CLI runs, one of them a build: past the 5 s default under load.
    }, 30_000)

    it('check --json without public/: the failure shape, no ❌ line', async () => {
        const { code, stdout, stderr } = await cli(['check', '--json'])

        expect(code).toBe(1)
        const out = JSON.parse(stdout)
        expect(out).toEqual({ ok: false, error: expect.any(String), results: [] })
        expect(out.error).toContain('run `nera build` first')
        expect(stderr).not.toContain('❌')
    })
})
