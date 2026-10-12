import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { validateSite, validateOutput } from '@nera-static/validate'
import { scaffoldProject } from '../src/scaffold.js'
import { runValidate } from '../src/commands/validate.js'
import { runCheck } from '../src/commands/check.js'
import { runBuild } from '../src/commands/build.js'

// `--json` (ROADMAP-ai.md L3): one JSON object on stdout, logs on stderr, the
// same exit code as text mode. In-process tests prove the shape and the exit
// codes per command; the child-process tests prove that the whole stdout of
// the real CLI parses, with the engine's build log on stderr.

// Resolved from this file, so the test passes whatever vitest's cwd is.
const CLI = fileURLToPath(new URL('../bin/nera.js', import.meta.url))

// A built page that is clean except for its missing `lang` (a11y-html-lang).
const page = (htmlAttrs) =>
    `<!DOCTYPE html>\n<html${htmlAttrs}>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <a href="#main">Skip</a><main id="main"><h1>Hi</h1></main><footer><a href="/imprint.html">Imprint</a> <a href="/privacy.html">Privacy</a></footer>\n  </body>\n</html>\n`

let workdir, target, prevCwd, stdout, log, error

beforeEach(async () => {
    prevCwd = process.cwd()
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
    process.chdir(prevCwd)
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

describe('nera validate --json', () => {
    const cases = {
        clean: async () => {},
        'warnings-only': () =>
            fs.writeFile(path.join(target, 'pages', 'draft.md'), '---\ntitle: Draft\n---\n# x\n'),
        error: () =>
            fs.writeFile(
                path.join(target, 'pages', 'index.md'),
                '---\nlayout: pages/nope.pug\n---\n# x\n'
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
        clean: () => writePublic(page(' lang="en"')),
        'warnings-only': () => writePublic(page('')),
        error: async () => {
            await writePublic(page(''))
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

describe('nera build --json', () => {
    it('without --check: { ok: true, results: [] }, the build log not on stdout', async () => {
        process.chdir(target)
        expect(await runBuild(['--json'])).toBe(0)
        expect(printedJson()).toEqual({ ok: true, results: [] })
        // The engine's log went through console.log → stderr.
        expect(log).not.toHaveBeenCalled()
        expect(error.mock.calls.flat().join('\n')).toContain('Found 1 page(s) to process')
    })

    for (const [name, rule, expectedCode] of [
        ['warnings-only', null, 0],
        ['error', 'a11y-skip-link', 1],
    ]) {
        it(`--check, ${name}: same exit code as text mode, one { ok, results } object`, async () => {
            if (rule) await promote(rule)
            process.chdir(target)
            const textCode = await runBuild(['--check'])
            stdout.mockClear()

            const code = await runBuild(['--check', '--json'])

            expect(code).toBe(textCode)
            expect(code).toBe(expectedCode)
            expect(printedJson()).toEqual({ ok: code === 0, results: validateOutput({ cwd: target }) })
        })
    }

    it('--check, clean: exit 0 and ok with no results', async () => {
        // The starter's three check warnings, switched off.
        await fs.writeFile(
            path.join(target, 'config', 'validate.yaml'),
            'rules:\n  a11y-skip-link: off\n  legal-imprint-link: off\n  legal-privacy-link: off\n'
        )
        process.chdir(target)
        const textCode = await runBuild(['--check'])
        stdout.mockClear()

        const code = await runBuild(['--check', '--json'])

        expect(code).toBe(textCode)
        expect(code).toBe(0)
        expect(printedJson()).toEqual({ ok: true, results: validateOutput({ cwd: target }) })
    })

    it('a failed build: exit 1 and the failure shape', async () => {
        // A `theme:` that does not resolve makes the engine's run() throw.
        await fs.appendFile(path.join(target, 'config', 'app.yaml'), '\ntheme: ./no-such-theme\n')
        process.chdir(target)
        // Text mode rethrows; the bin turns that into ❌ and exit 1.
        await expect(runBuild(['--check'])).rejects.toThrow()

        const code = await runBuild(['--check', '--json'])
        const out = printedJson()

        expect(code).toBe(1)
        expect(out).toEqual({ ok: false, error: expect.any(String), results: [] })
    })
})

describe('bin/nera.js --json, as a child process', () => {
    const cli = (args) =>
        spawnSync(process.execPath, [CLI, ...args], { cwd: target, encoding: 'utf-8' })

    it('build --check --json: the whole stdout is one JSON object, the build log is on stderr', () => {
        const child = cli(['build', '--check', '--json'])

        expect(child.status).toBe(0)
        const out = JSON.parse(child.stdout)
        expect(out.ok).toBe(true)
        expect(out.results.map((r) => r.rule)).toContain('a11y-skip-link')
        expect(child.stderr).toContain('Found 1 page(s) to process')
        expect(child.stderr).toContain('HTML created')
    })

    it('validate --json and check --json print only JSON; exit codes match text mode', async () => {
        for (const command of ['validate', 'check']) {
            const json = cli([command, '--json'])
            const text = cli([command])
            expect(json.status).toBe(text.status)
            expect(() => JSON.parse(json.stdout)).not.toThrow()
        }
        // check without public/ ends 1 in both modes.
        expect(cli(['check', '--json']).status).toBe(1)

        await promote('a11y-skip-link')
        cli(['build'])
        const json = cli(['check', '--json'])
        expect(json.status).toBe(1)
        expect(json.status).toBe(cli(['check']).status)
        expect(JSON.parse(json.stdout).ok).toBe(false)
    })

    it('check --json without public/: the failure shape, no ❌ line', () => {
        const child = cli(['check', '--json'])

        expect(child.status).toBe(1)
        const out = JSON.parse(child.stdout)
        expect(out).toEqual({ ok: false, error: expect.any(String), results: [] })
        expect(out.error).toContain('run `nera build` first')
        expect(child.stderr).not.toContain('❌')
    })
})
