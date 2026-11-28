import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { parseAddArgs, runAdd, ADD_USAGE } from '../src/commands/add.js'

// The `nera add` contract: its arguments, the text summary and the --json
// object. npm and node are fakes throughout; no test reaches the registry.
// What addPlugin itself does (config, templates, refusals) is plugin.test.js.

// Resolved from this file, so the test passes whatever vitest's cwd is.
const CLI = path.resolve(import.meta.dirname, '../bin/nera.js')
const PKG = '@nera-static/plugin-x'
const JSON_STDIO = ['ignore', 2, 2]

let workdir, site, stdout, stderr, log

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-add-'))
    site = path.join(workdir, 'site')
    await writeJson(path.join(site, 'package.json'), {
        name: 'site',
        dependencies: { '@nera-static/nera': '^1.25.0' },
    })
    await fs.mkdir(path.join(site, 'config'), { recursive: true })
    await fs.writeFile(path.join(site, 'config', 'app.yaml'), 'name: Site\n')
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(workdir, { recursive: true, force: true })
})

async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(value, null, 4)}\n`)
}

// A fake `npm install` that lays plugin-x into the site's node_modules, with
// or without a default config and a template bin.
function fakeNpm({ config = true, bin = true } = {}) {
    return vi.fn(async (args, { cwd }) => {
        const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x')
        await writeJson(path.join(dir, 'package.json'), {
            name: PKG,
            version: '1.0.0',
            ...(bin ? { bin: { 'nera-x': 'bin/publish-template.js' } } : {}),
        })
        if (config) {
            await fs.mkdir(path.join(dir, 'config'), { recursive: true })
            await fs.writeFile(path.join(dir, 'config', 'x.yaml'), 'enabled: true\n')
        }
        if (bin) {
            await fs.mkdir(path.join(dir, 'bin'), { recursive: true })
            await fs.writeFile(path.join(dir, 'bin', 'publish-template.js'), '')
        }
        return ''
    })
}

const printed = (spy) => spy.mock.calls.map(([chunk]) => String(chunk)).join('')
const printedJson = () => JSON.parse(printed(stdout))
const logged = () => log.mock.calls.flat().join('\n')

describe('parseAddArgs', () => {
    it('takes one plugin, with --json before or after it', () => {
        expect(parseAddArgs(['sitemap'])).toEqual({ json: false, spec: 'sitemap' })
        expect(parseAddArgs(['--json', 'sitemap'])).toEqual({ json: true, spec: 'sitemap' })
        expect(parseAddArgs(['@nera-static/plugin-feed', '--json'])).toEqual({
            json: true,
            spec: '@nera-static/plugin-feed',
        })
    })

    it('a missing plugin is an error naming the usage', () => {
        expect(() => parseAddArgs([])).toThrow(`nera add needs a plugin. ${ADD_USAGE}`)
        expect(() => parseAddArgs(['--json'])).toThrow(ADD_USAGE)
    })

    it('an unknown flag or a second plugin is an error', () => {
        expect(() => parseAddArgs(['sitemap', '--force'])).toThrow('Unknown argument for nera add: --force')
        expect(() => parseAddArgs(['-y', 'sitemap'])).toThrow('Unknown argument for nera add: -y')
        expect(() => parseAddArgs(['sitemap', 'feed'])).toThrow('nera add takes one plugin, got 2')
    })
})

describe('runAdd, text mode', () => {
    it('adds the plugin with inherited stdio and prints a summary, exit 0', async () => {
        const runNpm = fakeNpm()
        const runNode = vi.fn(async () => '')
        expect(await runAdd(['x'], { cwd: site, runNpm, runNode })).toBe(0)

        expect(runNpm).toHaveBeenCalledWith(['install', PKG], expect.objectContaining({ cwd: site, stdio: 'inherit' }))
        expect(runNode).toHaveBeenCalledWith([expect.stringMatching(/publish-template\.js$/)], expect.objectContaining({ cwd: site, stdio: 'inherit' }))
        expect(logged()).toContain(`📦 Installing ${PKG}...`)
        expect(logged()).toContain(`✅ Added ${PKG}`)
        expect(logged()).toContain('Config:    config/x.yaml (copied from the plugin\'s defaults)')
        expect(logged()).toContain('Templates: published by the plugin')
        expect(await fs.readFile(path.join(site, 'config', 'x.yaml'), 'utf-8')).toBe('enabled: true\n')
    })

    it('summarizes a kept config, and a plugin without config or templates', async () => {
        await fs.writeFile(path.join(site, 'config', 'x.yaml'), 'mine: true\n')
        await runAdd(['x'], { cwd: site, runNpm: fakeNpm(), runNode: vi.fn() })
        expect(logged()).toContain('Config:    config/x.yaml (kept, the site already had one)')

        log.mockClear()
        await fs.rm(path.join(site, 'config', 'x.yaml'))
        await fs.rm(path.join(site, 'node_modules'), { recursive: true })
        await runAdd(['x'], { cwd: site, runNpm: fakeNpm({ config: false, bin: false }), runNode: vi.fn() })
        expect(logged()).toContain('Config:    none (the plugin ships no default)')
        expect(logged()).toContain('Templates: none')
    })

    it('throws for a missing or foreign plugin before npm runs', async () => {
        const runNpm = vi.fn()
        await expect(runAdd([], { cwd: site, runNpm })).rejects.toThrow(ADD_USAGE)
        await expect(runAdd(['@other/x'], { cwd: site, runNpm })).rejects.toThrow('"@other/x" is not a Nera plugin')
        expect(runNpm).not.toHaveBeenCalled()
    })
})

describe('runAdd, --json', () => {
    it('prints exactly one object, children and logs on stderr, exit 0', async () => {
        const runNpm = fakeNpm()
        const runNode = vi.fn(async () => '')
        expect(await runAdd(['x', '--json'], { cwd: site, runNpm, runNode })).toBe(0)

        expect(printedJson()).toEqual({
            ok: true,
            plugin: PKG,
            config: { file: 'config/x.yaml', status: 'copied' },
            templates: 'published',
        })
        expect(runNpm.mock.calls[0][1].stdio).toEqual(JSON_STDIO)
        expect(runNode.mock.calls[0][1].stdio).toEqual(JSON_STDIO)
        expect(printed(stderr)).toContain(`✅ Added ${PKG}`)
        expect(log).not.toHaveBeenCalled()
    })

    it.each([
        [[], ADD_USAGE],
        [['@other/x'], '"@other/x" is not a Nera plugin'],
        [['x', 'y'], 'nera add takes one plugin, got 2'],
    ])('%j fails as one { ok: false, error } object, exit 1, before npm runs', async (args, message) => {
        const runNpm = vi.fn()
        expect(await runAdd([...args, '--json'], { cwd: site, runNpm })).toBe(1)
        const result = printedJson()
        expect(Object.keys(result)).toEqual(['ok', 'error'])
        expect(result.ok).toBe(false)
        expect(result.error).toContain(message)
        expect(runNpm).not.toHaveBeenCalled()
    })

    it('a failing install is a failure object, exit 1', async () => {
        const runNpm = vi.fn(async () => {
            throw new Error('npm exited with code 1')
        })
        expect(await runAdd(['x', '--json'], { cwd: site, runNpm })).toBe(1)
        expect(printedJson()).toEqual({
            ok: false,
            error: `Installing ${PKG} failed: npm exited with code 1`,
        })
    })
})

describe('bin/nera.js add, as a child process', () => {
    const cli = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: site, encoding: 'utf-8' })

    // Every case fails before npm runs, so no child reaches the registry.
    it('is in the usage text; without a plugin it exits 1 naming the usage', () => {
        const help = cli([])
        expect(help.status).toBe(0)
        expect(help.stdout).toMatch(/^ {2}nera add <plugin> /m)

        const text = cli(['add'])
        expect(text.status).toBe(1)
        expect(text.stderr).toContain(`❌ nera add needs a plugin. ${ADD_USAGE}`)
    }, 30_000) // two node children; as in publish.test.js, startup is slow on a loaded machine

    it('--json: the whole stdout is one object, exit 1 as in text mode, no ❌ line', () => {
        const child = cli(['add', '--json'])
        expect(child.status).toBe(1)
        expect(JSON.parse(child.stdout)).toEqual({ ok: false, error: `nera add needs a plugin. ${ADD_USAGE}` })
        expect(child.stderr).not.toContain('❌')

        const foreign = cli(['add', '@other/x', '--json'])
        expect(foreign.status).toBe(1)
        expect(JSON.parse(foreign.stdout)).toMatchObject({ ok: false, error: expect.stringContaining('is not a Nera plugin') })
    }, 30_000)
})
