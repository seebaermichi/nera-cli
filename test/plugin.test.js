import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { addPlugin } from '../src/plugin.js'

const PKG = '@nera-static/plugin-x'
const DEFAULT_CONFIG = '# plugin-x defaults\nenabled: true\n'

let workdir, site, stdout, lines, log

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-plugin-'))
    site = path.join(workdir, 'site')
    await fs.mkdir(path.join(site, 'config'), { recursive: true })
    await writeJson(path.join(site, 'package.json'), {
        name: 'site',
        dependencies: { '@nera-static/nera': '^1.25.0' },
    })
    await fs.writeFile(path.join(site, 'config', 'app.yaml'), 'name: Site\n')
    stdout = vi.spyOn(process.stdout, 'write')
    lines = []
    log = (line) => lines.push(line)
})

afterEach(async () => {
    expect(stdout).not.toHaveBeenCalled()
    stdout.mockRestore()
    await fs.rm(workdir, { recursive: true, force: true })
})

async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify(value, null, 4)}\n`)
}

// A fake `npm install` that lays the package into the site's node_modules,
// the way npm would: with or without a default config and a template bin.
function fakeNpm({ config = true, bin = 'bin/publish-template.js', script = '' } = {}) {
    return vi.fn(async (args, { cwd }) => {
        const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x')
        await writeJson(path.join(dir, 'package.json'), {
            name: PKG,
            version: '1.0.0',
            ...(bin ? { bin: { 'nera-x': bin } } : {}),
        })
        if (config) {
            await fs.mkdir(path.join(dir, 'config'), { recursive: true })
            await fs.writeFile(path.join(dir, 'config', 'x.yaml'), DEFAULT_CONFIG)
        }
        if (bin && script !== null) {
            await fs.mkdir(path.dirname(path.join(dir, bin)), { recursive: true })
            await fs.writeFile(path.join(dir, bin), script)
        }
        return ''
    })
}

describe('addPlugin', () => {
    it('installs the plugin, copies its default config and publishes its templates', async () => {
        const runNpm = fakeNpm()
        const runNode = vi.fn(async () => '')
        const env = { PATH: process.env.PATH, MARK: '1' }
        const result = await addPlugin('x', { cwd: site, log, runNpm, runNode, env, stdio: 'pipe' })

        expect(result).toEqual({
            plugin: PKG,
            config: { file: 'config/x.yaml', status: 'copied' },
            templates: 'published',
        })
        expect(runNpm).toHaveBeenCalledTimes(1)
        expect(runNpm).toHaveBeenCalledWith(['install', PKG], { cwd: site, stdio: 'pipe', env, signal: undefined })
        const script = await fs.realpath(path.join(site, 'node_modules', '@nera-static', 'plugin-x', 'bin', 'publish-template.js'))
        expect(runNode).toHaveBeenCalledWith([script], { cwd: site, stdio: 'pipe', env, signal: undefined })
        expect(await fs.readFile(path.join(site, 'config', 'x.yaml'), 'utf-8')).toBe(DEFAULT_CONFIG)
        expect(lines.join('\n')).toMatch(/Installing @nera-static\/plugin-x[\s\S]*config\/x\.yaml[\s\S]*Added @nera-static\/plugin-x/)
    })

    it('keeps an existing config byte for byte', async () => {
        const own = Buffer.from('# my own settings\nenabled: false\nä\n')
        await fs.writeFile(path.join(site, 'config', 'x.yaml'), own)
        const result = await addPlugin('@nera-static/plugin-x', { cwd: site, log, runNpm: fakeNpm(), runNode: vi.fn() })

        expect(result.config).toEqual({ file: 'config/x.yaml', status: 'kept' })
        expect((await fs.readFile(path.join(site, 'config', 'x.yaml'))).equals(own)).toBe(true)
    })

    it('reports no config and no templates for a package without either', async () => {
        const runNode = vi.fn()
        const result = await addPlugin('plugin-x', { cwd: site, log, runNpm: fakeNpm({ config: false, bin: null }), runNode })

        expect(result).toEqual({ plugin: PKG, config: { file: 'config/x.yaml', status: 'none' }, templates: 'none' })
        expect(runNode).not.toHaveBeenCalled()
        await expect(fs.access(path.join(site, 'config', 'x.yaml'))).rejects.toThrow()
    })

    it('creates the config folder when the site has none', async () => {
        await fs.rm(path.join(site, 'config'), { recursive: true })
        const result = await addPlugin('x', { cwd: site, log, runNpm: fakeNpm({ bin: null }) })

        expect(result.config.status).toBe('copied')
        expect(await fs.readFile(path.join(site, 'config', 'x.yaml'), 'utf-8')).toBe(DEFAULT_CONFIG)
    })

    it('ignores a bin that is not publish-template.js, and accepts a string bin', async () => {
        const runNode = vi.fn()
        await addPlugin('x', { cwd: site, log, runNpm: fakeNpm({ bin: 'bin/other.js' }), runNode })
        expect(runNode).not.toHaveBeenCalled()

        const runNpm = vi.fn(async (args, { cwd }) => {
            const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x')
            await writeJson(path.join(dir, 'package.json'), { name: PKG, bin: 'publish-template.js' })
            await fs.writeFile(path.join(dir, 'publish-template.js'), '')
        })
        const result = await addPlugin('x', { cwd: site, log, runNpm, runNode })
        expect(result.templates).toBe('published')
        expect(runNode).toHaveBeenCalledTimes(1)
    })

    it('runs the template script with this node in the site folder', async () => {
        const script = [
            'import fs from \'fs\'',
            'fs.mkdirSync(\'views/vendor/plugin-x\', { recursive: true })',
            'fs.writeFileSync(\'views/vendor/plugin-x/x.pug\', \'p x\')',
            '',
        ].join('\n')
        const result = await addPlugin('x', { cwd: site, log, runNpm: fakeNpm({ script }), stdio: 'pipe' })

        expect(result.templates).toBe('published')
        expect(await fs.readFile(path.join(site, 'views', 'vendor', 'plugin-x', 'x.pug'), 'utf-8')).toBe('p x')
    })

    it('refuses a template script outside the package without running it', async () => {
        const runNode = vi.fn()
        await fs.writeFile(path.join(workdir, 'publish-template.js'), '')
        await expect(
            addPlugin('x', { cwd: site, log, runNpm: fakeNpm({ bin: '../../../../publish-template.js', script: null }), runNode }),
        ).rejects.toThrow(/@nera-static\/plugin-x is installed, but its template script .* outside the package/)
        expect(runNode).not.toHaveBeenCalled()
    })

    it('refuses a template script that is a symbolic link out of the package', async () => {
        const runNode = vi.fn()
        const outside = path.join(workdir, 'publish-template.js')
        await fs.writeFile(outside, '')
        const runNpm = vi.fn(async (args, { cwd }) => {
            await fakeNpm({ script: null })(args, { cwd })
            const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x', 'bin')
            await fs.mkdir(dir, { recursive: true })
            await fs.symlink(outside, path.join(dir, 'publish-template.js'))
        })
        await expect(addPlugin('x', { cwd: site, log, runNpm, runNode })).rejects.toThrow(/outside the package/)
        expect(runNode).not.toHaveBeenCalled()
    })

    it('copies no config that is a symbolic link out of the package', async () => {
        const outside = path.join(workdir, 'secret.yaml')
        await fs.writeFile(outside, 'secret: 1\n')
        const runNpm = vi.fn(async (args, { cwd }) => {
            await fakeNpm({ config: false, bin: null })(args, { cwd })
            const dir = path.join(cwd, 'node_modules', '@nera-static', 'plugin-x', 'config')
            await fs.mkdir(dir, { recursive: true })
            await fs.symlink(outside, path.join(dir, 'x.yaml'))
        })
        const result = await addPlugin('x', { cwd: site, log, runNpm })

        expect(result.config.status).toBe('none')
        await expect(fs.access(path.join(site, 'config', 'x.yaml'))).rejects.toThrow()
    })

    it.each(['x', 'plugin-x', '@nera-static/plugin-x'])('reads %s as the official plugin', async (spec) => {
        const runNpm = fakeNpm()
        const result = await addPlugin(spec, { cwd: site, log, runNpm, runNode: vi.fn(async () => '') })

        expect(result.plugin).toBe(PKG)
        expect(runNpm.mock.calls[0][0]).toEqual(['install', PKG])
    })

    it.each([
        'utils',
        'plugin-utils',
        '@nera-static/plugin-utils',
        '@other/x',
        '@nera-static/core',
        'x@1',
        '@nera-static/plugin-x@latest',
        '../x',
        './x',
        'X',
        '',
        undefined,
    ])('refuses %s without calling npm', async (spec) => {
        const runNpm = vi.fn()
        await expect(addPlugin(spec, { cwd: site, log, runNpm })).rejects.toThrow(
            /is not a Nera plugin.*nera\.js\.org\/plugins/,
        )
        expect(runNpm).not.toHaveBeenCalled()
        expect(lines).toEqual([])
    })

    it('refuses a folder that is no Nera site without calling npm', async () => {
        const runNpm = vi.fn()
        await writeJson(path.join(site, 'package.json'), { name: 'other', dependencies: { lodash: '^4' } })
        await expect(addPlugin('x', { cwd: site, log, runNpm })).rejects.toThrow(/is not a Nera site.*nera new/)

        await fs.rm(path.join(site, 'package.json'))
        await expect(addPlugin('x', { cwd: site, log, runNpm })).rejects.toThrow(/is not a Nera site/)
        expect(runNpm).not.toHaveBeenCalled()
        await expect(fs.access(path.join(site, 'package.json'))).rejects.toThrow()
    })

    it('refuses a package.json that is not JSON without calling npm', async () => {
        const runNpm = vi.fn()
        await fs.writeFile(path.join(site, 'package.json'), '{ nope')
        await expect(addPlugin('x', { cwd: site, log, runNpm })).rejects.toThrow(/package\.json is not valid JSON/)
        expect(runNpm).not.toHaveBeenCalled()
    })

    it('refuses a legacy site without calling npm', async () => {
        const runNpm = vi.fn()
        await writeJson(path.join(site, 'package.json'), { name: 'legacy' })
        await fs.mkdir(path.join(site, 'src'))
        await fs.writeFile(path.join(site, 'src', 'core.js'), '')
        await fs.writeFile(path.join(site, 'src', 'render.js'), '')
        await expect(addPlugin('x', { cwd: site, log, runNpm })).rejects.toThrow(/legacy Nera site.*nera update --migrate/)
        expect(runNpm).not.toHaveBeenCalled()
    })

    it('rejects a failing install with a message naming the package', async () => {
        const runNpm = vi.fn(async () => {
            throw Object.assign(new Error('Command failed: npm install @nera-static/plugin-x (exit code 1)\nE404'), { code: 1 })
        })
        const runNode = vi.fn()
        await expect(addPlugin('x', { cwd: site, log, runNpm, runNode })).rejects.toThrow(
            /^Installing @nera-static\/plugin-x failed: Command failed[\s\S]*E404/,
        )
        expect(runNode).not.toHaveBeenCalled()
        await expect(fs.access(path.join(site, 'config', 'x.yaml'))).rejects.toThrow()
    })

    it('rejects a failing template script with a message naming the package', async () => {
        const runNode = vi.fn(async () => {
            throw new Error('Command failed: node publish-template.js (exit code 2)')
        })
        await expect(addPlugin('x', { cwd: site, log, runNpm: fakeNpm(), runNode })).rejects.toThrow(
            /^@nera-static\/plugin-x is installed, but publishing its templates failed: Command failed/,
        )
    })

    it('rejects with the abort reason, before npm when already aborted', async () => {
        const runNpm = vi.fn()
        const controller = new AbortController()
        const reason = new Error('stop')
        controller.abort(reason)
        await expect(addPlugin('x', { cwd: site, log, runNpm, signal: controller.signal })).rejects.toBe(reason)
        expect(runNpm).not.toHaveBeenCalled()
    })

    it('rejects with the abort reason unchanged when aborted during the install', async () => {
        const controller = new AbortController()
        const reason = new Error('stop')
        const runNpm = vi.fn(async (args, { signal }) => {
            controller.abort(reason)
            throw signal.reason
        })
        await expect(addPlugin('x', { cwd: site, log, runNpm, signal: controller.signal })).rejects.toBe(reason)
    })
})
