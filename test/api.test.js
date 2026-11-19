import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import * as api from '@nera-static/nera'
import { BUNDLED_STARTERS as bundledStarters } from '../src/starters.js'

// The public entry point, imported by package name the way @nera-static/mcp
// does (a self-reference through the `exports` map).

const PACKAGE_ROOT = path.resolve(import.meta.dirname, '..')

let workdir, stdout

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-api-'))
    stdout = vi.spyOn(process.stdout, 'write')
})

afterEach(async () => {
    stdout.mockRestore()
    vi.restoreAllMocks()
    await fs.rm(workdir, { recursive: true, force: true })
})

// A built page that is clean except for its missing `lang` (a11y-html-lang).
const PAGE_WITHOUT_LANG =
    '<!DOCTYPE html>\n<html>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <a href="#main">Skip</a><main id="main"><h1>Hi</h1></main><footer><a href="/imprint.html">Imprint</a> <a href="/privacy.html">Privacy</a></footer>\n  </body>\n</html>\n'

describe('the @nera-static/nera entry point', () => {
    it('exports exactly the public API', () => {
        expect(Object.keys(api).sort()).toEqual([
            'BUNDLED_STARTERS',
            'CatalogError',
            'addPlugin',
            'check',
            'createSite',
            'hasErrors',
            'listCatalog',
            'listStarters',
            'validate',
        ])
        expect(api.BUNDLED_STARTERS).toBe(bundledStarters)
    })

    it('keeps @nera-static/nera/package.json resolvable, and the bin and skill by path', async () => {
        const require = createRequire(import.meta.url)
        const manifest = require.resolve('@nera-static/nera/package.json')
        expect(manifest).toBe(path.join(PACKAGE_ROOT, 'package.json'))
        const root = path.dirname(manifest)
        await expect(fs.access(path.join(root, 'bin', 'nera.js'))).resolves.toBeUndefined()
        await expect(fs.access(path.join(root, 'skills', 'nera', 'SKILL.md'))).resolves.toBeUndefined()
    })

    it('does not load vite or chokidar on import', () => {
        // A fresh process records every module the import resolves.
        const script = [
            'import { registerHooks } from "node:module"',
            'const urls = []',
            'registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); urls.push(r.url); return r } })',
            'await import("@nera-static/nera")',
            'process.stdout.write(JSON.stringify(urls))',
        ].join('\n')
        const urls = JSON.parse(
            execFileSync(process.execPath, ['--input-type=module', '-e', script], {
                cwd: PACKAGE_ROOT,
                encoding: 'utf8',
            })
        )
        expect(urls.some((url) => url.endsWith('/src/index.js'))).toBe(true)
        expect(urls.filter((url) => /\/node_modules\/(vite|chokidar)\//.test(url))).toEqual([])
    })
})

describe('createSite', () => {
    it('creates a site without writing to stdout, its log going to stderr', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const { dir, firstSteps } = await api.createSite('site', { cwd: workdir, install: false })
        expect(dir).toBe(path.join(workdir, 'site'))
        expect(firstSteps).toBeNull()
        await expect(fs.access(path.join(dir, 'config', 'app.yaml'))).resolves.toBeUndefined()
        expect(stdout).not.toHaveBeenCalled()
        expect(stderr.mock.calls.map(([chunk]) => chunk).join('')).toContain('✅ Done!')
    })

    it('sends every line to an injected log instead', async () => {
        const stderr = vi.spyOn(process.stderr, 'write')
        const lines = []
        await api.createSite('site', { cwd: workdir, install: false, log: (line) => lines.push(line) })
        expect(lines).toContain('✅ Done!')
        expect(stdout).not.toHaveBeenCalled()
        expect(stderr).not.toHaveBeenCalled()
    })

    it('runs npm install with stdin closed and its output on stderr', async () => {
        const calls = []
        const execNpm = (args, options) => {
            calls.push({ args, options })
            return '10.9.2\n'
        }
        await api.createSite('site', { cwd: workdir, execNpm, log: () => {} })
        const install = calls.find((call) => call.args[0] === 'install')
        expect(install.options.stdio).toEqual(['ignore', 2, 2])
        expect(stdout).not.toHaveBeenCalled()
    })

    it('passes env and signal to every npm call, and names a theme package on the install', async () => {
        const calls = []
        const execNpm = async (args, options) => {
            calls.push({ args, options })
            return '10.9.2\n'
        }
        const env = { PATH: '/shim' }
        const controller = new AbortController()
        await api.createSite('site', {
            cwd: workdir,
            theme: 'blog',
            env,
            signal: controller.signal,
            execNpm,
            log: () => {},
        })
        expect(calls.map((call) => call.args)).toEqual([['--version'], ['install', '@nera-static/theme-blog']])
        for (const { options } of calls) {
            expect(options.env).toBe(env)
            expect(options.signal).toBe(controller.signal)
        }
        expect(stdout).not.toHaveBeenCalled()
    })

    it('rejects with the reason of an aborted signal, writing nothing', async () => {
        const controller = new AbortController()
        const reason = new Error('stop')
        controller.abort(reason)
        const execNpm = vi.fn()
        await expect(
            api.createSite('site', { cwd: workdir, signal: controller.signal, execNpm, log: () => {} })
        ).rejects.toBe(reason)
        expect(execNpm).not.toHaveBeenCalled()
        await expect(fs.access(path.join(workdir, 'site'))).rejects.toThrow()
        expect(stdout).not.toHaveBeenCalled()
    })

    it('an abort during the install removes the new folder', async () => {
        const controller = new AbortController()
        const execNpm = async (args, { signal }) => {
            if (args[0] === '--version') return '10.9.2\n'
            controller.abort()
            signal.throwIfAborted()
        }
        await expect(
            api.createSite('site', { cwd: workdir, signal: controller.signal, execNpm, log: () => {} })
        ).rejects.toMatchObject({ name: 'AbortError' })
        await expect(fs.access(path.join(workdir, 'site'))).rejects.toThrow()
        expect(stdout).not.toHaveBeenCalled()
    })
})

describe('addPlugin', () => {
    let site

    beforeEach(async () => {
        site = path.join(workdir, 'site')
        await fs.mkdir(site)
        await fs.writeFile(
            path.join(site, 'package.json'),
            JSON.stringify({ name: 'site', dependencies: { '@nera-static/nera': '^1.25.0' } })
        )
    })

    // A fake `npm install` that lays a plugin with a default config and a
    // template bin into the site's node_modules.
    const runNpm = vi.fn(async (args, { cwd }) => {
        const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x')
        await fs.mkdir(path.join(dir, 'config'), { recursive: true })
        await fs.mkdir(path.join(dir, 'bin'))
        await fs.writeFile(
            path.join(dir, 'package.json'),
            JSON.stringify({ name: '@nera-static/plugin-x', bin: { 'nera-x': 'bin/publish-template.js' } })
        )
        await fs.writeFile(path.join(dir, 'config', 'x.yaml'), 'enabled: true\n')
        await fs.writeFile(path.join(dir, 'bin', 'publish-template.js'), '')
    })

    it('adds a plugin without writing to stdout, its children and log on stderr', async () => {
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const runNode = vi.fn(async () => '')
        const env = { PATH: '/shim' }
        const result = await api.addPlugin('x', { cwd: site, env, runNpm, runNode })
        expect(result).toEqual({
            plugin: '@nera-static/plugin-x',
            config: { file: 'config/x.yaml', status: 'copied' },
            templates: 'published',
        })
        for (const fake of [runNpm, runNode]) {
            expect(fake.mock.calls.at(-1)[1]).toMatchObject({ cwd: site, stdio: ['ignore', 2, 2], env })
        }
        expect(stdout).not.toHaveBeenCalled()
        expect(stderr.mock.calls.map(([chunk]) => chunk).join('')).toContain('✅ Added @nera-static/plugin-x')
    })

    it('sends every line to an injected log instead', async () => {
        const stderr = vi.spyOn(process.stderr, 'write')
        const lines = []
        await api.addPlugin('x', { cwd: site, runNpm, runNode: async () => '', log: (line) => lines.push(line) })
        expect(lines).toContain('✅ Added @nera-static/plugin-x')
        expect(stdout).not.toHaveBeenCalled()
        expect(stderr).not.toHaveBeenCalled()
    })
})

describe('validate and check', () => {
    let site

    beforeEach(async () => {
        site = (await api.createSite('site', { cwd: workdir, install: false, log: () => {} })).dir
    })

    it('validate returns the validator records for the site in cwd', async () => {
        expect(api.validate({ cwd: site })).toEqual([])
        await fs.writeFile(path.join(site, 'pages', 'index.md'), '---\nlayout: pages/nope.pug\n---\n# x\n')
        const results = api.validate({ cwd: site })
        expect(results).toContainEqual(
            expect.objectContaining({ file: 'pages/index.md', severity: 'error', rule: 'layout-unresolved' })
        )
        expect(api.hasErrors(results)).toBe(true)
        expect(stdout).not.toHaveBeenCalled()
    })

    it('check returns the output records, and throws before a build', async () => {
        expect(() => api.check({ cwd: site })).toThrow('run `nera build` first')
        await fs.mkdir(path.join(site, 'public'))
        await fs.writeFile(path.join(site, 'public', 'index.html'), PAGE_WITHOUT_LANG)
        const results = api.check({ cwd: site })
        expect(results).toContainEqual(expect.objectContaining({ rule: 'a11y-html-lang', severity: 'warning' }))
        expect(api.hasErrors(results)).toBe(false)
        expect(stdout).not.toHaveBeenCalled()
    })
})
