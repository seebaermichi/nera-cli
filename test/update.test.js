import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import {
    classifyProject,
    neraDeps,
    runUpdate,
} from '../src/commands/update.js'

let cwd

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-update-'))
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
})

const writePkg = (obj) =>
    fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify(obj, null, 4))

const writeVendoredEngine = async () => {
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true })
    await fs.writeFile(path.join(cwd, 'src', 'core.js'), '// engine')
    await fs.writeFile(path.join(cwd, 'src', 'render.js'), '// engine')
    await fs.writeFile(path.join(cwd, 'index.js'), 'run()')
}

describe('classifyProject', () => {
    it('is thin when @nera-static/nera is a dependency', () => {
        const pkg = { dependencies: { '@nera-static/nera': '^1.0.0' } }
        expect(classifyProject(pkg, cwd)).toBe('thin')
    })

    it('is legacy when the engine is vendored and the CLI is absent', async () => {
        await writeVendoredEngine()
        expect(classifyProject({ dependencies: {} }, cwd)).toBe('legacy')
    })

    it('is unknown otherwise', () => {
        expect(classifyProject({ dependencies: {} }, cwd)).toBe('unknown')
    })
})

describe('neraDeps', () => {
    it('selects only @nera-static packages', () => {
        const pkg = {
            dependencies: {
                '@nera-static/nera': '^1.0.0',
                '@nera-static/plugin-tags': '^3.0.0',
                'markdown-it': '^14.0.0',
            },
        }
        expect(neraDeps(pkg).sort()).toEqual([
            '@nera-static/nera',
            '@nera-static/plugin-tags',
        ])
    })
})

describe('runUpdate', () => {
    it('npm-updates only the Nera packages of a thin site', async () => {
        await writePkg({
            dependencies: {
                '@nera-static/nera': '^1.0.0',
                lodash: '^4.0.0',
            },
        })
        const calls = []
        await runUpdate([], { cwd, runNpm: (args) => calls.push(args) })

        expect(calls).toHaveLength(1)
        expect(calls[0]).toEqual(['update', '@nera-static/nera'])
    })

    it('does not migrate a legacy site without --migrate', async () => {
        await writePkg({ dependencies: {} })
        await writeVendoredEngine()
        const calls = []
        await runUpdate([], { cwd, runNpm: (args) => calls.push(args) })

        // Guidance only — nothing installed, engine untouched.
        expect(calls).toHaveLength(0)
        expect(fssync.existsSync(path.join(cwd, 'src'))).toBe(true)
    })

    it('migrates a legacy site with --migrate', async () => {
        await writePkg({
            name: 'old-site',
            scripts: { render: 'node index.js', dev: 'concurrently ...' },
            nera: { version: '4.5.0' },
            dependencies: {},
        })
        await writeVendoredEngine()
        // A local plugin that must survive the migration.
        await fs.mkdir(path.join(cwd, 'src', 'plugins', 'my-plugin'), {
            recursive: true,
        })
        await fs.writeFile(
            path.join(cwd, 'src', 'plugins', 'my-plugin', 'index.js'),
            'export function getAppData () {}'
        )

        const calls = []
        await runUpdate(['--migrate'], { cwd, runNpm: (args) => calls.push(args) })

        const pkg = JSON.parse(
            await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')
        )
        // Thin now.
        expect(pkg.dependencies['@nera-static/nera']).toBeDefined()
        expect(pkg.scripts.build).toBe('nera build')
        expect(pkg.scripts.render).toBeUndefined()
        expect(pkg.nera).toBeUndefined()
        // Engine gone, local plugins preserved.
        expect(fssync.existsSync(path.join(cwd, 'src'))).toBe(false)
        expect(fssync.existsSync(path.join(cwd, 'index.js'))).toBe(false)
        expect(
            fssync.existsSync(path.join(cwd, 'plugins', 'my-plugin', 'index.js'))
        ).toBe(true)
        // Installed.
        expect(calls).toContainEqual(['install'])
    })

    it('throws on a directory that is not a Nera site', async () => {
        await writePkg({ dependencies: {} })
        await expect(
            runUpdate([], { cwd, runNpm: () => {} })
        ).rejects.toThrow(/does not look like a Nera site/)
    })
})
