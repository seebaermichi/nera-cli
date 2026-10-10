import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import {
    scaffoldProject,
    validateProjectName,
    validateThemeSpec,
    themePackageName,
    projectNameFromDir,
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

describe('scaffoldProject in the current folder (`nera new .`)', () => {
    const inPlace = (dir, name = '.') =>
        scaffoldProject(name, { cwd: dir, install: false })

    it('scaffolds into an empty folder, named after it', async () => {
        const dir = path.join(workdir, 'bakery')
        await fs.mkdir(dir)
        expect(await inPlace(dir)).toBe(dir)
        const pkg = JSON.parse(await read(dir, 'package.json'))
        expect(pkg.name).toBe('bakery')
        for (const rel of ['config/app.yaml', 'pages/index.md', '.gitignore']) {
            expect(fssync.existsSync(path.join(dir, rel))).toBe(true)
        }
    })

    it('accepts ./ as well', async () => {
        const dir = path.join(workdir, 'site')
        await fs.mkdir(dir)
        await inPlace(dir, './')
        expect(fssync.existsSync(path.join(dir, 'package.json'))).toBe(true)
    })

    it('ignores dotfiles such as .git', async () => {
        const dir = path.join(workdir, 'repo')
        await fs.mkdir(path.join(dir, '.git'), { recursive: true })
        await inPlace(dir)
        expect(fssync.existsSync(path.join(dir, 'pages/index.md'))).toBe(true)
        expect(fssync.existsSync(path.join(dir, '.git'))).toBe(true)
    })

    it('keeps an existing .gitignore and says so', async () => {
        const dir = path.join(workdir, 'repo')
        await fs.mkdir(dir)
        await fs.writeFile(path.join(dir, '.gitignore'), 'mine\n')
        const logs = []
        const spy = vi.spyOn(console, 'log').mockImplementation((m) => logs.push(m))
        try {
            await inPlace(dir)
        } finally {
            spy.mockRestore()
        }
        expect(await read(dir, '.gitignore')).toBe('mine\n')
        expect(logs.filter((m) => /Kept your existing \.gitignore/.test(m)))
            .toHaveLength(1)
    })

    it('refuses a non-empty folder and writes nothing', async () => {
        const dir = path.join(workdir, 'busy')
        await fs.mkdir(dir)
        await fs.writeFile(path.join(dir, 'notes.txt'), 'x')
        await expect(inPlace(dir)).rejects.toThrow(/not empty \(notes\.txt\)/)
        expect(await fs.readdir(dir)).toEqual(['notes.txt'])
    })

    it('rejects an invalid theme before writing anything', async () => {
        const dir = path.join(workdir, 'empty')
        await fs.mkdir(dir)
        await expect(
            scaffoldProject('.', { cwd: dir, install: false, theme: 'a b' })
        ).rejects.toThrow(/Invalid theme/)
        expect(await fs.readdir(dir)).toEqual([])
    })

    it('normalises the folder name into a valid package name', async () => {
        const dir = path.join(workdir, 'My Site')
        await fs.mkdir(dir)
        await inPlace(dir)
        expect(JSON.parse(await read(dir, 'package.json')).name).toBe('my-site')
    })

    it('still rejects .., absolute paths and other dot spellings', async () => {
        for (const name of ['..', '../', './/', path.join(workdir, 'abs')]) {
            await expect(inPlace(workdir, name)).rejects.toThrow(
                /Invalid project name/
            )
        }
        expect(await fs.readdir(workdir)).toEqual([])
    })
})

describe('projectNameFromDir', () => {
    it.each([
        ['/x/My Site', 'my-site'],
        ['/x/Bäckerei Müller', 'backerei-muller'],
        ['/x/.hidden', 'hidden'],
        ['/x/--a  b--', 'a-b'],
        ['/x/site.v2_final', 'site.v2_final'],
        ['/x/___', 'nera-site'],
        ['/x/Straße', 'strasse'],
        ['/x/Ærø Øl', 'aero-ol'],
        ['/x/node_modules', 'nera-site'],
        ['/x/favicon.ico', 'nera-site'],
    ])('%s → %s', (dir, expected) => {
        expect(projectNameFromDir(dir)).toBe(expected)
        expect(validateProjectName(expected)).toBe(expected)
    })

    it('caps the name at npm\'s 214 characters, without a trailing dash', () => {
        const name = projectNameFromDir(`/x/${'a'.repeat(213)} b`)
        expect(name).toBe('a'.repeat(213))
        expect(projectNameFromDir(`/x/${'b'.repeat(300)}`)).toHaveLength(214)
    })
})

describe('scaffoldProject next steps', () => {
    const nextSteps = async (name, options) => {
        const logs = []
        const spy = vi
            .spyOn(console, 'log')
            .mockImplementation((m) => logs.push(m))
        try {
            await scaffoldProject(name, { cwd: workdir, ...options })
        } finally {
            spy.mockRestore()
        }
        return logs.find((m) => m.startsWith('👉 Next steps:'))
    }

    it('names cd, npm install and npm run dev for a new folder', async () => {
        expect(await nextSteps('my-site', { install: false })).toBe(
            '👉 Next steps:\n  cd my-site\n  npm install\n  npm run dev\n'
        )
    })

    it('leaves out cd in place', async () => {
        const dir = path.join(workdir, 'here')
        await fs.mkdir(dir)
        expect(await nextSteps('.', { cwd: dir, install: false })).toBe(
            '👉 Next steps:\n  npm install\n  npm run dev\n'
        )
    })

    it('never tells the user to run a global nera', async () => {
        expect(await nextSteps('x', { install: false })).not.toMatch(
            /^\s+nera /m
        )
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

describe('scaffoldProject agent instructions (AGENTS.md, CLAUDE.md)', () => {
    // `nera update` will split AGENTS.md on this line (ROADMAP-ai.md L1).
    const SITE_NOTES_MARKER = '<!-- nera:site-notes'

    const modes = {
        'a new folder': () =>
            scaffoldProject('plain', { cwd: workdir, install: false }),
        'a new folder with --theme': () =>
            scaffoldProject('themed', {
                cwd: workdir,
                install: false,
                theme: 'example',
            }),
        'the current folder': async () => {
            const dir = path.join(workdir, 'here')
            await fs.mkdir(dir)
            return scaffoldProject('.', { cwd: dir, install: false })
        },
    }

    for (const [mode, scaffold] of Object.entries(modes)) {
        it(`writes both files into ${mode}`, async () => {
            const target = await scaffold()
            expect(await read(target, 'CLAUDE.md')).toBe('@AGENTS.md\n')
            expect(await read(target, 'AGENTS.md')).toBe(
                await read(templateDir(), 'AGENTS.md')
            )
        })
    }

    it('keeps AGENTS.md within 120 lines', async () => {
        const lines = (await read(templateDir(), 'AGENTS.md')).split('\n')
        expect(lines.at(-1)).toBe('')
        expect(lines.length - 1).toBeLessThanOrEqual(120)
    })

    // https://nera.js.org/llms.txt is linked once it exists (slice 2, L2).
    it('links the docs, not llms.txt before it exists', async () => {
        const text = await read(templateDir(), 'AGENTS.md')
        expect(text).toContain('https://nera.js.org')
        expect(text).not.toContain('llms.txt')
    })

    it('ends with the owner\'s section, the marker directly above it', async () => {
        const lines = (await read(templateDir(), 'AGENTS.md')).split('\n')
        const markers = lines.filter((l) => l.includes(SITE_NOTES_MARKER))
        expect(markers).toHaveLength(1)
        expect(markers[0]).toMatch(/^<!-- nera:site-notes .* -->$/)

        const headings = lines.filter((l) => l.startsWith('## '))
        expect(headings.at(-1)).toBe('## Notes for this site')
        const at = lines.indexOf(markers[0])
        expect(lines[at + 1]).toBe('## Notes for this site')
    })

    it('names only commands and folders that exist today', async () => {
        const text = await read(templateDir(), 'AGENTS.md')
        expect(text).not.toMatch(/nera publish|--json/)
        expect(text).not.toMatch(/(^|[^/])\bplugins\/<name>/m)
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

