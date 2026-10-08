import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import {
    scaffoldProject,
    validateProjectName,
    validateThemeSpec,
    themePackageName,
    templateDir,
} from '../src/scaffold.js'
import { parseNewArgs } from '../src/commands/new.js'

let workdir

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-scaffold-'))
})

afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('validateProjectName', () => {
    it('accepts a normal name', () => {
        expect(validateProjectName('my-site')).toBe('my-site')
    })

    it('rejects empty, traversal and shell-unsafe names', () => {
        expect(() => validateProjectName('')).toThrow()
        expect(() => validateProjectName('../evil')).toThrow()
        expect(() => validateProjectName('.hidden')).toThrow()
        expect(() => validateProjectName('a b')).toThrow()
    })
})

describe('scaffoldProject', () => {
    it('creates a thin site from the template without installing', async () => {
        const target = await scaffoldProject('my-site', {
            cwd: workdir,
            install: false,
        })

        expect(target).toBe(path.join(workdir, 'my-site'))
        // Core structure copied.
        for (const rel of [
            'package.json',
            'config/app.yaml',
            'pages/index.md',
            'theme/views/layouts/layout.pug',
            'theme/views/pages/default.pug',
        ]) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(true)
        }
    })

    it('renames _gitignore to .gitignore and never ships _gitignore', async () => {
        const target = await scaffoldProject('g', { cwd: workdir, install: false })
        expect(fssync.existsSync(path.join(target, '.gitignore'))).toBe(true)
        expect(fssync.existsSync(path.join(target, '_gitignore'))).toBe(false)
    })

    it('personalizes package.json: one dependency, named after the project', async () => {
        const target = await scaffoldProject('acme', { cwd: workdir, install: false })
        const pkg = JSON.parse(
            await fs.readFile(path.join(target, 'package.json'), 'utf-8')
        )
        expect(pkg.name).toBe('acme')
        expect(Object.keys(pkg.dependencies)).toEqual(['@nera-static/nera'])
        expect(pkg.scripts).toMatchObject({
            dev: 'nera dev',
            build: 'nera build',
            serve: 'nera serve',
        })
    })

    it('refuses to overwrite an existing directory', async () => {
        await scaffoldProject('dup', { cwd: workdir, install: false })
        await expect(
            scaffoldProject('dup', { cwd: workdir, install: false })
        ).rejects.toThrow(/already exists/)
    })

    it('ships a _gitignore (not .gitignore) in the template so npm keeps it', () => {
        // npm strips a literal .gitignore from tarballs; the template must carry
        // the underscore form for scaffolding to reproduce it.
        expect(fssync.existsSync(path.join(templateDir(), '_gitignore'))).toBe(true)
        expect(fssync.existsSync(path.join(templateDir(), '.gitignore'))).toBe(false)
    })
})

const STARTERS = [
    'theme/views/layouts/layout.pug',
    'theme/views/pages/default.pug',
]

const read = (target, rel) => fs.readFile(path.join(target, rel), 'utf-8')

describe('scaffoldProject with a theme', () => {
    it('marks the starter templates when no theme is given', async () => {
        const target = await scaffoldProject('plain', {
            cwd: workdir,
            install: false,
        })
        for (const rel of STARTERS) {
            const firstLine = (await read(target, rel)).split('\n')[0]
            expect(firstLine).toContain('nera:scaffold-default')
        }
        expect(await read(target, 'config/app.yaml')).not.toMatch(/^theme:/m)
    })

    it('leaves the starters out so they cannot hide the theme', async () => {
        const target = await scaffoldProject('themed', {
            cwd: workdir,
            install: false,
            theme: 'example',
        })
        for (const rel of STARTERS) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(false)
        }
        // The rest of the scaffold is still there.
        for (const rel of ['pages/index.md', 'theme/assets/.gitkeep']) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(true)
        }
    })

    it('sets theme: in app.yaml and keeps the existing config', async () => {
        const target = await scaffoldProject('themed', {
            cwd: workdir,
            install: false,
            theme: 'example',
        })
        const yaml = await read(target, 'config/app.yaml')
        expect(yaml).toMatch(/^theme: example$/m)
        expect(yaml).toMatch(/^name: My Nera Site$/m)
        expect(yaml).toMatch(/^translations:$/m)
    })

    it('adds the theme package as a dependency', async () => {
        const target = await scaffoldProject('themed', {
            cwd: workdir,
            install: false,
            theme: 'example',
        })
        const pkg = JSON.parse(await read(target, 'package.json'))
        expect(pkg.dependencies).toEqual({
            '@nera-static/nera': expect.any(String),
            '@nera-static/theme-example': 'latest',
        })
    })

    it('adds no dependency for a local theme path', async () => {
        const target = await scaffoldProject('local', {
            cwd: workdir,
            install: false,
            theme: './my-theme',
        })
        const pkg = JSON.parse(await read(target, 'package.json'))
        expect(Object.keys(pkg.dependencies)).toEqual(['@nera-static/nera'])
        expect(await read(target, 'config/app.yaml')).toMatch(
            /^theme: \.\/my-theme$/m
        )
    })

    it('rejects an invalid theme before creating anything', async () => {
        await expect(
            scaffoldProject('bad', {
                cwd: workdir,
                install: false,
                theme: 'foo; rm -rf /',
            })
        ).rejects.toThrow(/Invalid theme/)
        expect(fssync.existsSync(path.join(workdir, 'bad'))).toBe(false)
    })
})

describe('validateThemeSpec / themePackageName', () => {
    it('accepts the three forms core accepts', () => {
        for (const spec of ['example', '@acme/my-theme', './my-theme', '../t', '.']) {
            expect(validateThemeSpec(spec)).toBe(spec)
        }
    })

    it('rejects empty and unsafe values', () => {
        for (const spec of ['', 'a b', '-x', '/abs/path', 'Example', '@acme']) {
            expect(() => validateThemeSpec(spec)).toThrow(/Invalid theme/)
        }
    })

    it('maps a spec to its package the way core does', () => {
        expect(themePackageName('example')).toBe('@nera-static/theme-example')
        expect(themePackageName('@acme/t')).toBe('@acme/t')
        expect(themePackageName('./t')).toBeNull()
    })
})

describe('parseNewArgs', () => {
    it('reads --theme <spec> without taking it for the project name', () => {
        expect(parseNewArgs(['--theme', 'example', 'site'])).toEqual({
            projectName: 'site',
            theme: 'example',
            install: true,
        })
    })

    it('reads --theme=<spec> and --no-install', () => {
        expect(parseNewArgs(['site', '--theme=example', '--no-install'])).toEqual({
            projectName: 'site',
            theme: 'example',
            install: false,
        })
    })

    it('leaves theme undefined when not given', () => {
        expect(parseNewArgs(['site']).theme).toBeUndefined()
    })
})

