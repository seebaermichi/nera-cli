import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import YAML from 'yaml'
import {
    scaffoldProject,
    setAppValue,
    addLangTranslations,
    validateSiteName,
    validateLang,
    validateProjectName,
    validateThemeSpec,
    themePackageName,
    projectNameFromDir,
    templateDir,
    probeNpmVersion,
    assertNpmCanInstall,
} from '../src/scaffold.js'
import { skillSourceDir } from '../src/skill.js'
import { parseNewArgs } from '../src/commands/new.js'

// The range a new or migrated site gets for this CLI: its own version.
const OWN_RANGE = `^${JSON.parse(fssync.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version}`

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
            'pages/imprint.md',
            'pages/privacy.md',
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
        expect(pkg.dependencies).toEqual({ '@nera-static/nera': OWN_RANGE })
        expect(OWN_RANGE).not.toBe('^1.0.0')
        expect(pkg.scripts).toMatchObject({
            dev: 'nera dev',
            build: 'nera build',
            serve: 'nera serve',
            validate: 'nera validate',
            check: 'nera build --check',
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

    it('accepts a folder holding only AGENTS.md and CLAUDE.md and keeps both', async () => {
        const dir = path.join(workdir, 'agent')
        await fs.mkdir(dir)
        await fs.writeFile(path.join(dir, 'AGENTS.md'), 'my agents\n')
        await fs.writeFile(path.join(dir, 'CLAUDE.md'), 'my claude\n')
        const logs = []
        const spy = vi.spyOn(console, 'log').mockImplementation((m) => logs.push(m))
        try {
            await inPlace(dir)
        } finally {
            spy.mockRestore()
        }
        expect(await read(dir, 'AGENTS.md')).toBe('my agents\n')
        expect(await read(dir, 'CLAUDE.md')).toBe('my claude\n')
        for (const rel of ['package.json', 'config/app.yaml', 'pages/index.md']) {
            expect(fssync.existsSync(path.join(dir, rel))).toBe(true)
        }
        for (const name of ['AGENTS.md', 'CLAUDE.md']) {
            expect(logs.filter((m) => m === `  • Kept your existing ${name}`))
                .toHaveLength(1)
        }
    })

    it('still refuses AGENTS.md next to another file, or in another case', async () => {
        for (const files of [['AGENTS.md', 'notes.txt'], ['agents.md']]) {
            const dir = await fs.mkdtemp(path.join(workdir, 'busy-'))
            for (const f of files) await fs.writeFile(path.join(dir, f), 'x')
            await expect(inPlace(dir)).rejects.toThrow(/not empty/)
            expect((await fs.readdir(dir)).sort()).toEqual([...files].sort())
        }
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
        for (const rel of ['pages/index.md', 'pages/imprint.md', 'pages/privacy.md', 'theme/assets/.gitkeep']) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(true)
        }
    })

    it('hints that the legal placeholders need a link from the theme, only with --theme', async () => {
        const logs = []
        const spy = vi.spyOn(console, 'log').mockImplementation((m) => logs.push(m))
        try {
            const themed = await scaffoldProject('themed', {
                cwd: workdir,
                install: false,
                theme: 'example',
            })
            expect(fssync.existsSync(path.join(themed, 'pages/imprint.md'))).toBe(true)
            expect(fssync.existsSync(path.join(themed, 'pages/privacy.md'))).toBe(true)
            const using = logs.findIndex((l) => l.includes('Using theme "example"'))
            expect(using).toBeGreaterThanOrEqual(0)
            expect(logs[using + 1]).toMatch(/imprint\.md and pages\/privacy\.md are placeholders/)
            expect(logs[using + 1]).toContain('legal-imprint-link and legal-privacy-link')

            logs.length = 0
            await scaffoldProject('plain', { cwd: workdir, install: false })
            expect(logs.some((l) => l.includes('are placeholders'))).toBe(false)
        } finally {
            spy.mockRestore()
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
            '@nera-static/nera': OWN_RANGE,
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

    // ROADMAP-ai.md L1 says "at most ~120 lines"; the --json bullet (L3)
    // took the file to 124, the `nera new` bullet (L5) to 127.
    it('keeps AGENTS.md within 127 lines', async () => {
        const lines = (await read(templateDir(), 'AGENTS.md')).split('\n')
        expect(lines.at(-1)).toBe('')
        expect(lines.length - 1).toBeLessThanOrEqual(127)
    })

    it('links the docs, llms.txt and llms-full.txt', async () => {
        const text = await read(templateDir(), 'AGENTS.md')
        expect(text).toContain('https://nera.js.org')
        expect(text).toContain('https://nera.js.org/llms.txt')
        expect(text).toContain('https://nera.js.org/llms-full.txt')
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
        expect(text).not.toMatch(/nera publish/)
        expect(text).not.toMatch(/(^|[^/])\bplugins\/<name>/m)
    })
})

describe('scaffoldProject Nera skill (.agents/skills/nera, .claude/skills/nera)', () => {
    // Every file under dir, relative to it.
    const listFiles = async (dir) =>
        (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
            .filter((e) => e.isFile())
            .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
            .sort()

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
        it(`copies the skill into both folders of ${mode}`, async () => {
            const target = await scaffold()
            const expected = await listFiles(skillSourceDir())
            expect(expected).toContain('SKILL.md')
            for (const folder of ['.agents/skills/nera', '.claude/skills/nera']) {
                const dir = path.join(target, folder)
                expect(await listFiles(dir)).toEqual(expected)
                for (const file of expected) {
                    expect(await read(dir, file)).toBe(await read(skillSourceDir(), file))
                }
            }
        })
    }

    it('keeps the user\'s .claude settings when scaffolding in place', async () => {
        const dir = path.join(workdir, 'here')
        await fs.mkdir(path.join(dir, '.claude'), { recursive: true })
        await fs.writeFile(path.join(dir, '.claude', 'settings.json'), '{}\n')
        await scaffoldProject('.', { cwd: dir, install: false })

        expect(await read(dir, '.claude/settings.json')).toBe('{}\n')
        expect(fssync.existsSync(path.join(dir, '.claude/skills/nera/SKILL.md'))).toBe(true)
    })

    it('says so, and the .gitignore does not hide the skill', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        const target = await scaffoldProject('said', { cwd: workdir, install: false })
        const output = log.mock.calls.map((c) => c.join(' ')).join('\n')
        log.mockRestore()

        expect(output).toContain(
            '✓ Added the Nera skill for AI assistants (.agents/skills/nera, .claude/skills/nera)'
        )
        const ignored = (await read(target, '.gitignore')).split('\n').map((l) => l.trim())
        for (const line of ignored) {
            expect(line).not.toMatch(/^\/?\.(agents|claude)\b|^skills\b|^\.\*/)
        }
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
            yes: false,
            install: true,
        })
    })

    it('reads --theme=<spec> and --no-install', () => {
        expect(parseNewArgs(['site', '--theme=example', '--no-install'])).toEqual({
            projectName: 'site',
            theme: 'example',
            yes: false,
            install: false,
        })
    })

    it('leaves theme undefined when not given', () => {
        expect(parseNewArgs(['site']).theme).toBeUndefined()
    })

    it('reads --starter, --name and --lang in both forms, and --yes', () => {
        expect(
            parseNewArgs(['site', '--starter', 'blank', '--name', 'Brot & Zeit', '--lang', 'de', '--yes'])
        ).toEqual({
            projectName: 'site',
            starter: 'blank',
            name: 'Brot & Zeit',
            lang: 'de',
            yes: true,
            install: true,
        })
        expect(
            parseNewArgs(['--starter=./s', '--name=A=B', '--lang=pt-BR', 'site'])
        ).toEqual({
            projectName: 'site',
            starter: './s',
            name: 'A=B',
            lang: 'pt-BR',
            yes: false,
            install: true,
        })
    })

    it('leaves the new options undefined when not given', () => {
        const parsed = parseNewArgs(['site'])
        expect(parsed.starter).toBeUndefined()
        expect(parsed.name).toBeUndefined()
        expect(parsed.lang).toBeUndefined()
    })
})

describe('setAppValue', () => {
    const yaml = '# top\nlang: en\nname: My Nera Site\n\ntranslations:\n  en:\n    name: nested\n'

    it('replaces the top-level line and keeps everything else', () => {
        expect(setAppValue(yaml, 'name', '"Brot & Zeit"')).toBe(
            '# top\nlang: en\nname: "Brot & Zeit"\n\ntranslations:\n  en:\n    name: nested\n'
        )
        expect(setAppValue(yaml, 'lang', 'de')).toBe(yaml.replace('lang: en', 'lang: de'))
    })

    it('appends the line when there is none', () => {
        expect(setAppValue('robots: none', 'lang', 'de')).toBe('robots: none\nlang: de\n')
        expect(setAppValue('', 'lang', 'de')).toBe('\nlang: de\n')
    })

    it('treats $ in the value literally', () => {
        expect(setAppValue('name: x\n', 'name', '"$& $1"')).toBe('name: "$& $1"\n')
    })
})

describe('addLangTranslations', () => {
    const yaml =
        'lang: de\n\ntranslations:\n  en:\n    a: A # note\n\n    b: B\n  fr:\n    a: Ah\n\nrobots: none\n'

    it('copies the old language entry to the end of the block', () => {
        expect(addLangTranslations(yaml, 'en', 'de')).toBe(
            'lang: de\n\ntranslations:\n  en:\n    a: A # note\n\n    b: B\n  fr:\n    a: Ah\n' +
                '  de:\n    a: A # note\n\n    b: B\n\nrobots: none\n'
        )
        expect(YAML.parse(addLangTranslations(yaml, 'fr', 'pt-BR')).translations['pt-BR']).toEqual({
            a: 'Ah',
        })
    })

    it('changes nothing when there is nothing to copy or the entry exists', () => {
        expect(addLangTranslations(yaml, 'en', 'fr')).toBe(yaml)
        expect(addLangTranslations(yaml, 'es', 'de')).toBe(yaml)
        expect(addLangTranslations(yaml, undefined, 'de')).toBe(yaml)
        expect(addLangTranslations('lang: de\n', 'en', 'de')).toBe('lang: de\n')
        const flow = 'translations: { en: { a: A } }\n'
        expect(addLangTranslations(flow, 'en', 'de')).toBe(flow)
    })

    it('handles a block at the end of the file', () => {
        const out = addLangTranslations('translations:\n  en:\n    a: A\n', 'en', 'de')
        expect(YAML.parse(out).translations).toEqual({ en: { a: 'A' }, de: { a: 'A' } })
    })
})

describe('validateSiteName / validateLang', () => {
    it('accepts names and language codes', () => {
        expect(validateSiteName('Brot & Zeit: "Bäckerei" #1')).toBe('Brot & Zeit: "Bäckerei" #1')
        for (const lang of ['en', 'de', 'gsw', 'pt-BR', 'zh-Hant-TW']) {
            expect(validateLang(lang)).toBe(lang)
        }
    })

    it('refuses empty names, line breaks and bad codes', () => {
        for (const name of ['', '  ', 'a\nb', undefined]) {
            expect(() => validateSiteName(name)).toThrow(/Invalid site name/)
        }
        for (const lang of ['', 'DE', 'deutsch', 'de_DE', 'e', 'de-', undefined]) {
            expect(() => validateLang(lang)).toThrow(/Invalid language/)
        }
    })
})

const FIXTURE = fileURLToPath(new URL('./fixtures/starter-minimal', import.meta.url))

// Every file under dir, relative to it.
const filesUnder = async (dir) =>
    (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
        .sort()

describe('scaffoldProject with --name / --lang, no starter', () => {
    it('sets name and lang, and both round-trip through a YAML parser', async () => {
        const name = 'Brot & Zeit: "Bäckerei" #1'
        const target = await scaffoldProject('named', {
            cwd: workdir,
            install: false,
            name,
            lang: 'de',
        })
        const yaml = await read(target, 'config/app.yaml')
        expect(yaml).toMatch(/^name: "Brot & Zeit: \\"Bäckerei\\" #1"$/m)
        expect(yaml).toMatch(/^lang: de$/m)
        const parsed = YAML.parse(yaml)
        expect(parsed.name).toBe(name)
        expect(parsed.lang).toBe('de')
        // The new language gets a copy of the template's `en` translations,
        // so `t('app_description')` never renders the raw key.
        expect(parsed.translations.en.app_description).toBe('A static site built with Nera')
        expect(parsed.translations.de).toEqual(parsed.translations.en)
    })

    it('leaves translations alone when only the name changes', async () => {
        const target = await scaffoldProject('named', {
            cwd: workdir,
            install: false,
            name: 'Brot & Zeit',
        })
        const yaml = await read(target, 'config/app.yaml')
        expect(Object.keys(YAML.parse(yaml).translations)).toEqual(['en'])
        expect(yaml.split('\n').length).toBe(
            (await read(templateDir(), 'config/app.yaml')).split('\n').length
        )
    })

    it('rejects a bad --lang or --name before creating anything', async () => {
        await expect(
            scaffoldProject('bad', { cwd: workdir, install: false, lang: 'Deutsch' })
        ).rejects.toThrow(/Invalid language "Deutsch"/)
        await expect(
            scaffoldProject('bad', { cwd: workdir, install: false, name: '' })
        ).rejects.toThrow(/Invalid site name/)
        expect(await fs.readdir(workdir)).toEqual([])
    })
})

describe('scaffoldProject with a starter', () => {
    const scaffoldQuiet = async (name, options) => {
        const logs = []
        const spy = vi.spyOn(console, 'log').mockImplementation((...m) => logs.push(m.join(' ')))
        try {
            const target = await scaffoldProject(name, { cwd: workdir, install: false, ...options })
            return { target, logs }
        } finally {
            spy.mockRestore()
        }
    }

    it('lays the starter over the template, starter files winning', async () => {
        const { target } = await scaffoldQuiet('s', { starter: FIXTURE })
        expect(await read(target, 'pages/index.md')).toBe(await read(FIXTURE, 'pages/index.md'))
        expect(await read(target, 'pages/about.md')).toBe(await read(FIXTURE, 'pages/about.md'))
        expect(await read(target, 'config/app.yaml')).toBe(await read(FIXTURE, 'config/app.yaml'))
        expect(await read(target, 'theme/views/pages/about.pug')).toBe(
            await read(FIXTURE, 'theme/views/pages/about.pug')
        )
        expect(fssync.existsSync(path.join(target, 'theme/assets/css/starter.css'))).toBe(true)
        // The base template's views stay: the starter sets no theme.
        for (const rel of STARTERS) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(true)
        }
    })

    it('copies none of the decoys, and keeps the template\'s AGENTS.md', async () => {
        const { target } = await scaffoldQuiet('s', { starter: FIXTURE })
        expect(fssync.existsSync(path.join(target, 'scripts'))).toBe(false)
        expect(fssync.existsSync(path.join(target, 'README.md'))).toBe(false)
        expect(fssync.existsSync(path.join(target, '.claude/settings.json'))).toBe(false)
        expect(await read(target, 'AGENTS.md')).toBe(await read(templateDir(), 'AGENTS.md'))
        // The skill is still there.
        expect(fssync.existsSync(path.join(target, '.claude/skills/nera/SKILL.md'))).toBe(true)
    })

    it('merges the starter\'s dependencies, never its own nera entry or anything else', async () => {
        const { target } = await scaffoldQuiet('s', { starter: FIXTURE })
        const pkg = JSON.parse(await read(target, 'package.json'))
        const template = JSON.parse(await read(templateDir(), 'package.json'))
        expect(pkg.name).toBe('s')
        expect(pkg.dependencies).toEqual({
            '@nera-static/nera': OWN_RANGE,
            '@nera-static/plugin-navigation': '^1.0.0',
        })
        expect(pkg.devDependencies).toBeUndefined()
        expect(pkg.scripts).toEqual(template.scripts)
    })

    it('prints only the starter README\'s First steps after Done, before the next steps', async () => {
        const { logs } = await scaffoldQuiet('s', { starter: FIXTURE })
        const done = logs.indexOf('✅ Done!')
        const next = logs.findIndex((l) => l.startsWith('👉 Next steps:'))
        expect(done).toBeGreaterThan(-1)
        expect(next).toBe(done + 2)
        expect(logs[done + 1]).toBe(
            '\n## First steps\n\nEdit `pages/about.md` to tell visitors who you are.\n\n' +
                '### Then\n\nRun `npm run dev`.\n'
        )
        expect(logs.join('\n')).not.toMatch(/Minimal starter|img\.shields\.io|## License/)
        expect(logs).toContain('  ✓ Applied the "Minimal" starter (nera-starter-minimal)')
    })

    it('prints nothing from a starter README without First steps', async () => {
        const starter = path.join(workdir, 'no-first-steps')
        await fs.cp(FIXTURE, starter, { recursive: true })
        await fs.writeFile(path.join(starter, 'README.md'), '# Starter\n\n## Usage\n\nRead me.\n')
        const { logs } = await scaffoldQuiet('s', { starter })
        const done = logs.indexOf('✅ Done!')
        expect(logs[done + 1]).toMatch(/^👉 Next steps:/)
        expect(logs.join('\n')).not.toContain('Read me.')
    })

    it('applies --name and --lang over the starter\'s config', async () => {
        const { target } = await scaffoldQuiet('s', {
            starter: FIXTURE,
            name: 'Brot & Zeit',
            lang: 'de',
        })
        const yaml = await read(target, 'config/app.yaml')
        expect(yaml).toMatch(/^name: "Brot & Zeit"$/m)
        expect(yaml).toMatch(/^lang: de$/m)
        expect(yaml).toMatch(/^# The minimal starter's site settings\.$/m)
        // The starter's own language (fr) is copied to the new one.
        const parsed = YAML.parse(yaml)
        expect(Object.keys(parsed.translations)).toEqual(['fr', 'en', 'de'])
        expect(parsed.translations.de).toEqual(parsed.translations.fr)
    })

    it('reads a relative local path from cwd', async () => {
        const rel = path.relative(workdir, FIXTURE)
        const spec = rel.startsWith('.') ? rel : `./${rel}`
        const { target } = await scaffoldQuiet('rel', { starter: spec })
        expect(fssync.existsSync(path.join(target, 'pages/about.md'))).toBe(true)
    })

    it('leaves out the scaffold-default views when the starter sets a theme', async () => {
        const themed = path.join(workdir, 'themed-starter')
        await fs.cp(FIXTURE, themed, { recursive: true })
        await fs.appendFile(path.join(themed, 'config/app.yaml'), '\ntheme: example\n')
        const { target } = await scaffoldQuiet('t', { starter: themed })
        for (const rel of STARTERS) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(false)
        }
        // The starter's own view override is copied.
        expect(fssync.existsSync(path.join(target, 'theme/views/pages/about.pug'))).toBe(true)
    })

    it('refuses --starter together with --theme before creating anything', async () => {
        await expect(
            scaffoldProject('x', { cwd: workdir, install: false, starter: FIXTURE, theme: 'example' })
        ).rejects.toThrow('A starter brings its own theme; use --starter or --theme, not both.')
        expect(await fs.readdir(workdir)).toEqual([])
    })

    it('refuses an invalid starter spec before creating anything', async () => {
        await expect(
            scaffoldProject('x', { cwd: workdir, install: false, starter: 'a b' })
        ).rejects.toThrow(/Invalid starter "a b"/)
        expect(await fs.readdir(workdir)).toEqual([])
    })

    it('refuses a package that is not a starter and leaves no target folder', async () => {
        const notStarter = path.join(workdir, 'not-starter')
        await fs.mkdir(path.join(notStarter, 'pages'), { recursive: true })
        await fs.writeFile(path.join(notStarter, 'package.json'), '{"name":"plain"}')
        await expect(
            scaffoldProject('x', { cwd: workdir, install: false, starter: './not-starter' })
        ).rejects.toThrow('"./not-starter" is not a Nera starter: its package.json has no `nera.starter` field.')
        expect(fssync.existsSync(path.join(workdir, 'x'))).toBe(false)
    })

    it('removes the folder it created when a later step fails', async () => {
        const broken = path.join(workdir, 'broken')
        await fs.cp(FIXTURE, broken, { recursive: true })
        // A config file where the site has a folder makes the copy fail.
        await fs.rm(path.join(broken, 'pages'), { recursive: true })
        await fs.writeFile(path.join(broken, 'pages'), 'not a folder')
        await expect(scaffoldQuiet('x', { starter: './broken' })).rejects.toThrow()
        expect(fssync.existsSync(path.join(workdir, 'x'))).toBe(false)
    })

    it('in place, lists what was written when a later step fails', async () => {
        const broken = path.join(workdir, 'broken')
        await fs.cp(FIXTURE, broken, { recursive: true })
        await fs.rm(path.join(broken, 'pages'), { recursive: true })
        await fs.writeFile(path.join(broken, 'pages'), 'not a folder')
        const here = path.join(workdir, 'here')
        await fs.mkdir(here)
        const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await expect(
                scaffoldProject('.', { cwd: here, install: false, starter: '../broken' })
            ).rejects.toThrow(/Already written to the current folder: .*package\.json.*Remove them/)
        } finally {
            logs.mockRestore()
        }
    })

    it('fetches a package starter through the injected fetchStarter and cleans up', async () => {
        const tmp = await fs.mkdtemp(path.join(workdir, 'pack-'))
        const dir = path.join(tmp, 'package')
        await fs.cp(FIXTURE, dir, { recursive: true })
        const cleanup = vi.fn(() => fs.rm(tmp, { recursive: true, force: true }))
        const fetchStarter = vi.fn(async () => ({ dir, cleanup }))

        const { target } = await scaffoldQuiet('pkg', { starter: 'blank', fetchStarter })

        expect(fetchStarter).toHaveBeenCalledWith('blank', { cwd: workdir })
        expect(cleanup).toHaveBeenCalledOnce()
        expect(fssync.existsSync(tmp)).toBe(false)
        expect(fssync.existsSync(path.join(target, 'pages/about.md'))).toBe(true)
    })

    it('cleans up the download when the package is no starter', async () => {
        const tmp = await fs.mkdtemp(path.join(workdir, 'pack-'))
        await fs.writeFile(path.join(tmp, 'package.json'), '{"name":"@nera-static/theme-x"}')
        const cleanup = vi.fn(() => fs.rm(tmp, { recursive: true, force: true }))
        await expect(
            scaffoldProject('pkg', {
                cwd: workdir,
                install: false,
                starter: '@nera-static/theme-x',
                fetchStarter: async () => ({ dir: tmp, cleanup }),
            })
        ).rejects.toThrow(/is not a Nera starter/)
        expect(cleanup).toHaveBeenCalledOnce()
        expect(fssync.existsSync(path.join(workdir, 'pkg'))).toBe(false)
    })
})

describe('scaffoldProject without a starter or flags', () => {
    it('matches the template file for file (today\'s behaviour)', async () => {
        const target = await scaffoldProject('plain', { cwd: workdir, install: false })
        const files = (await filesUnder(target)).filter((f) => !/^\.(agents|claude)\//.test(f))
        const template = (await filesUnder(templateDir())).map((f) =>
            f === '_gitignore' ? '.gitignore' : f
        ).sort()
        expect(files).toEqual(template)
        for (const rel of template.filter((f) => f !== 'package.json')) {
            const src = rel === '.gitignore' ? '_gitignore' : rel
            expect(await read(target, rel)).toBe(await read(templateDir(), src))
        }
    })
})

describe('the npm check before installing', () => {
    // A stand-in for execFileSync('npm', …): answers `--version` with
    // `version` (or throws when it is an Error) and records every call.
    const fakeNpm = (version) =>
        vi.fn((args) => {
            if (args[0] !== '--version') return null
            if (version instanceof Error) throw version
            return `${version}\n`
        })

    it('reads the version, or null when npm cannot be run or answers nonsense', () => {
        expect(probeNpmVersion(fakeNpm('10.9.0'))).toBe('10.9.0')
        expect(probeNpmVersion(fakeNpm(new Error('spawn npm ENOENT')))).toBe(null)
        expect(probeNpmVersion(fakeNpm('oops'))).toBe(null)
    })

    it('refuses npm below 10.9.0 and lets 10.9.0, 10.10 and 11 through', () => {
        for (const v of ['10.8.2', '10.8.99', '9.9.9', '8.19.4']) {
            expect(() => assertNpmCanInstall(v)).toThrow(`npm ${v} cannot install`)
        }
        for (const v of ['10.9.0', '10.9.4', '10.10.0', '11.0.0', '11.6.2', null]) {
            expect(() => assertNpmCanInstall(v)).not.toThrow()
        }
    })

    it('with npm 10.8.2, names the fix and creates nothing', async () => {
        const execNpm = fakeNpm('10.8.2')
        await expect(
            scaffoldProject('old-npm', { cwd: workdir, execNpm })
        ).rejects.toThrow(/Node\.js 22\.12 or later.*npm i -g npm@10\.9/)
        expect(fssync.existsSync(path.join(workdir, 'old-npm'))).toBe(false)
        expect(execNpm.mock.calls.map(([args]) => args)).toEqual([['--version']])
    })

    it('with npm 10.9.0, scaffolds and installs', async () => {
        const execNpm = fakeNpm('10.9.0')
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            const target = await scaffoldProject('new-npm', { cwd: workdir, execNpm })
            expect(fssync.existsSync(path.join(target, 'package.json'))).toBe(true)
            expect(execNpm).toHaveBeenLastCalledWith(['install'], {
                cwd: target,
                stdio: 'inherit',
            })
        } finally {
            log.mockRestore()
        }
    })

    it('goes ahead when the version cannot be read', async () => {
        const execNpm = fakeNpm(new Error('spawn npm ENOENT'))
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await scaffoldProject('no-npm', { cwd: workdir, execNpm })
            expect(execNpm).toHaveBeenLastCalledWith(['install'], expect.anything())
        } finally {
            log.mockRestore()
        }
    })

    it('does not run npm at all with --no-install', async () => {
        const execNpm = fakeNpm('10.8.2')
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        try {
            await scaffoldProject('offline', { cwd: workdir, install: false, execNpm })
        } finally {
            log.mockRestore()
        }
        expect(execNpm).not.toHaveBeenCalled()
        expect(fssync.existsSync(path.join(workdir, 'offline'))).toBe(true)
    })
})
