import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import {
    agentTemplateDir,
    classifyProject,
    neraDeps,
    raisedRange,
    runUpdate,
} from '../src/commands/update.js'
import { templateDir as packageTemplateDir } from '../src/scaffold.js'
import { skillSourceDir } from '../src/skill.js'

// The range a new or migrated site gets for this CLI: its own version.
const OWN_RANGE = `^${JSON.parse(fssync.readFileSync(new URL('../package.json', import.meta.url), 'utf-8')).version}`

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

describe('raisedRange', () => {
    it.each([
        ['^1.0.0', '1.14.1', '^1.14.1'],
        ['^1.14.1', '1.14.2', '^1.14.2'],
        ['^3.1.0', '3.1.0', null],
        ['^3.2.0', '3.1.9', null],
        ['^1.0.0', '2.0.0', null],
        ['^0.3.0', '0.3.5', null],
        ['~1.0.0', '1.0.5', null],
        ['1.0.0', '1.0.0', null],
        ['latest', '1.2.3', null],
        ['^1.0.0', '1.2.0-beta.1', null],
        ['github:owner/repo', '1.0.0', null],
        [undefined, '1.0.0', null],
    ])('%s with %s installed → %s', (range, version, expected) => {
        expect(raisedRange(range, version)).toBe(expected)
    })
})

const writeInstalled = async (name, version) => {
    const dir = path.join(cwd, 'node_modules', ...name.split('/'))
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version }))
}

describe('runUpdate', () => {
    it('raises the caret ranges of the Nera packages to what npm installed', async () => {
        await fs.writeFile(
            path.join(cwd, 'package.json'),
            `${JSON.stringify({
                dependencies: {
                    '@nera-static/nera': '^1.0.0',
                    '@nera-static/plugin-tags': '^3.4.0',
                    '@nera-static/theme-blog': '~1.0.0',
                    lodash: '^4.0.0',
                },
                devDependencies: { '@nera-static/validate': '^1.2.0' },
            }, null, 2)}\n`
        )
        await writeInstalled('@nera-static/nera', '1.15.0')
        await writeInstalled('@nera-static/plugin-tags', '3.4.0')
        await writeInstalled('@nera-static/theme-blog', '1.0.5')
        await writeInstalled('@nera-static/validate', '1.5.0')
        await writeInstalled('lodash', '4.17.21')
        const lock = {
            name: 'site',
            lockfileVersion: 3,
            packages: {
                '': {
                    dependencies: { '@nera-static/nera': '^1.0.0', lodash: '^4.0.0' },
                    devDependencies: { '@nera-static/validate': '^1.2.0' },
                },
                'node_modules/@nera-static/nera': { version: '1.15.0' },
            },
        }
        await fs.writeFile(path.join(cwd, 'package-lock.json'), `${JSON.stringify(lock, null, 2)}\n`)
        const log = vi.spyOn(console, 'log').mockImplementation(() => {})
        await runUpdate([], { cwd, runNpm: () => {} })
        const lines = log.mock.calls.map((c) => c[0])
        log.mockRestore()

        const text = await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')
        expect(JSON.parse(text)).toEqual({
            dependencies: {
                '@nera-static/nera': '^1.15.0',
                '@nera-static/plugin-tags': '^3.4.0',
                '@nera-static/theme-blog': '~1.0.0',
                lodash: '^4.0.0',
            },
            devDependencies: { '@nera-static/validate': '^1.5.0' },
        })
        expect(text).toMatch(/^ {2}"dependencies"/m)
        expect(text.endsWith('}\n')).toBe(true)
        expect(lines).toContain('  ✓ @nera-static/nera: ^1.0.0 → ^1.15.0 in package.json')

        const lockAfter = JSON.parse(await fs.readFile(path.join(cwd, 'package-lock.json'), 'utf-8'))
        expect(lockAfter.packages['']).toEqual({
            dependencies: { '@nera-static/nera': '^1.15.0', lodash: '^4.0.0' },
            devDependencies: { '@nera-static/validate': '^1.5.0' },
        })
        expect(lockAfter.packages['node_modules/@nera-static/nera']).toEqual({ version: '1.15.0' })
    })

    it('leaves package.json byte for byte when nothing is installed', async () => {
        const original = '{\n    "dependencies": { "@nera-static/nera": "^1.0.0" }\n}\n'
        await fs.writeFile(path.join(cwd, 'package.json'), original)
        await runUpdate([], { cwd, runNpm: () => {} })
        expect(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')).toBe(original)
    })

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
        expect(pkg.dependencies['@nera-static/nera']).toBe(OWN_RANGE)
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

const MARKER = '<!-- nera:site-notes — below is yours -->'

// A scaffold template with AGENTS.md / CLAUDE.md, at `dir` under cwd.
const writeTemplate = async (dir, nera) => {
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
        path.join(dir, 'AGENTS.md'),
        `${nera}\n${MARKER}\n## Notes for this site\n`
    )
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '@AGENTS.md\n')
}

const installedTemplate = () =>
    path.join(cwd, 'node_modules', '@nera-static', 'nera', 'template')

const read = (file) => fs.readFile(path.join(cwd, file), 'utf-8')

const exists = (file) => fssync.existsSync(path.join(cwd, file))

const thinPkg = { dependencies: { '@nera-static/nera': '^1.0.0' } }

describe('agentTemplateDir', () => {
    it('prefers the site\'s installed @nera-static/nera template', async () => {
        await writeTemplate(installedTemplate(), '# Installed')
        expect(agentTemplateDir(cwd, '/fallback')).toBe(installedTemplate())
    })

    it('falls back when nothing is installed', () => {
        expect(agentTemplateDir(cwd, '/fallback')).toBe('/fallback')
    })

    it('falls back when the installed version predates AGENTS.md', async () => {
        // 1.5.x: the package and its template exist, AGENTS.md does not.
        await fs.mkdir(installedTemplate(), { recursive: true })
        await fs.writeFile(path.join(installedTemplate(), 'package.json'), '{}')
        expect(agentTemplateDir(cwd, '/fallback')).toBe('/fallback')
    })
})

describe('runUpdate agent files', () => {
    let fallback
    let log

    beforeEach(async () => {
        fallback = path.join(cwd, 'fallback-template')
        await writeTemplate(fallback, '# Fallback')
        log = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        log.mockRestore()
    })

    const output = () => log.mock.calls.map((c) => c.join(' ')).join('\n')

    it('creates AGENTS.md and CLAUDE.md on a thin site that has neither', async () => {
        await writePkg(thinPkg)
        await runUpdate([], { cwd, runNpm: () => {}, templateDir: fallback })

        expect(await read('AGENTS.md')).toBe(
            `# Fallback\n${MARKER}\n## Notes for this site\n`
        )
        expect(await read('CLAUDE.md')).toBe('@AGENTS.md\n')
        expect(output()).toContain('✓ Created AGENTS.md')
        expect(output()).toContain('✓ Created CLAUDE.md')
    })

    it('refreshes the Nera part from the installed template, after npm ran', async () => {
        await writePkg(thinPkg)
        const siteNotes = `${MARKER}\n## Notes for this site\n\nMine, untouched.\n`
        await fs.writeFile(path.join(cwd, 'AGENTS.md'), `# Old Nera text\n${siteNotes}`)
        await fs.writeFile(path.join(cwd, 'CLAUDE.md'), 'my own CLAUDE.md\n')

        // The installed template appears only during `npm update` (which is
        // synchronous, like the real execFileSync), so the lookup must
        // happen after it.
        const runNpm = () => {
            fssync.mkdirSync(installedTemplate(), { recursive: true })
            fssync.writeFileSync(
                path.join(installedTemplate(), 'AGENTS.md'),
                `# Installed\n${MARKER}\n`
            )
        }
        await runUpdate([], { cwd, runNpm, templateDir: fallback })

        expect(await read('AGENTS.md')).toBe(`# Installed\n${siteNotes}`)
        expect(await read('CLAUDE.md')).toBe('my own CLAUDE.md\n')
        expect(output()).toContain('✓ Refreshed the Nera part of AGENTS.md')
        expect(output()).toContain('✓ CLAUDE.md unchanged')
    })

    it('leaves a marker-less AGENTS.md alone and prints a hint', async () => {
        await writePkg(thinPkg)
        await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'All mine.\n')
        await runUpdate([], { cwd, runNpm: () => {}, templateDir: fallback })

        expect(await read('AGENTS.md')).toBe('All mine.\n')
        expect(output()).toContain('Left AGENTS.md alone')
        expect(output()).toContain(
            `line from ${path.join('fallback-template', 'AGENTS.md')} directly above your own notes`
        )
    })

    it('names a template outside the site by its absolute path', async () => {
        await writePkg(thinPkg)
        await fs.writeFile(path.join(cwd, 'AGENTS.md'), 'All mine.\n')
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-tpl-'))
        await writeTemplate(outside, '# Outside')
        await runUpdate([], { cwd, runNpm: () => {}, templateDir: outside })

        expect(output()).toContain(`line from ${path.join(outside, 'AGENTS.md')} directly`)
        await fs.rm(outside, { recursive: true, force: true })
    })

    it('writes nothing for a legacy site without --migrate', async () => {
        await writePkg({ dependencies: {} })
        await writeVendoredEngine()
        await runUpdate([], { cwd, runNpm: () => {}, templateDir: fallback })

        expect(exists('AGENTS.md')).toBe(false)
        expect(exists('CLAUDE.md')).toBe(false)
    })

    it('creates both files after --migrate', async () => {
        await writePkg({ dependencies: {} })
        await writeVendoredEngine()
        await runUpdate(['--migrate'], { cwd, runNpm: () => {}, templateDir: fallback })

        expect(exists('AGENTS.md')).toBe(true)
        expect(exists('CLAUDE.md')).toBe(true)
    })

    it('writes nothing when npm update fails', async () => {
        await writePkg(thinPkg)
        const runNpm = () => {
            throw new Error('npm failed')
        }
        await expect(
            runUpdate([], { cwd, runNpm, templateDir: fallback })
        ).rejects.toThrow('npm failed')

        expect(exists('AGENTS.md')).toBe(false)
        expect(exists('CLAUDE.md')).toBe(false)
    })

    it('defaults to the package\'s own template', async () => {
        await writePkg(thinPkg)
        await runUpdate([], { cwd, runNpm: () => {} })

        expect(await read('AGENTS.md')).toBe(
            await fs.readFile(path.join(packageTemplateDir(), 'AGENTS.md'), 'utf-8')
        )
    })
})

// A minimal Nera skill at `dir`, its SKILL.md naming `marker`.
const writeSkill = async (dir, marker) => {
    await fs.mkdir(path.join(dir, 'recipes'), { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: nera\n---\n# ${marker}\n`)
    await fs.writeFile(path.join(dir, 'recipes', 'blog.md'), `# Blog (${marker})\n`)
}

const installedSkill = () =>
    path.join(cwd, 'node_modules', '@nera-static', 'nera', 'skills', 'nera')

const SKILL_FOLDERS = ['.agents/skills/nera', '.claude/skills/nera']

describe('runUpdate Nera skill', () => {
    let fallbackTemplate
    let fallbackSkill
    let log

    beforeEach(async () => {
        fallbackTemplate = path.join(cwd, 'fallback-template')
        await writeTemplate(fallbackTemplate, '# Fallback')
        fallbackSkill = path.join(cwd, 'fallback-skill')
        await writeSkill(fallbackSkill, 'Fallback')
        log = vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        log.mockRestore()
    })

    const output = () => log.mock.calls.map((c) => c.join(' ')).join('\n')
    const update = (args = [], runNpm = () => {}) =>
        runUpdate(args, {
            cwd,
            runNpm,
            templateDir: fallbackTemplate,
            skillDir: fallbackSkill,
        })

    it('adds both folders from the fallback when nothing is installed', async () => {
        await writePkg(thinPkg)
        await update()

        for (const folder of SKILL_FOLDERS) {
            expect(await read(`${folder}/SKILL.md`)).toContain('# Fallback')
            expect(await read(`${folder}/recipes/blog.md`)).toBe('# Blog (Fallback)\n')
            expect(output()).toContain(`✓ Added the Nera skill in ${folder}`)
        }
    })

    it('syncs from the installed package, read after npm ran', async () => {
        await writePkg(thinPkg)
        await writeSkill(path.join(cwd, '.claude/skills/nera'), 'Old')
        await fs.writeFile(path.join(cwd, '.claude/skills/nera/recipes/gone.md'), 'stale\n')

        const runNpm = () => {
            fssync.mkdirSync(path.join(installedSkill(), 'recipes'), { recursive: true })
            fssync.writeFileSync(path.join(installedSkill(), 'SKILL.md'), '# Installed\n')
            fssync.writeFileSync(path.join(installedSkill(), 'recipes', 'blog.md'), '# Blog\n')
        }
        await update([], runNpm)

        for (const folder of SKILL_FOLDERS) {
            expect(await read(`${folder}/SKILL.md`)).toBe('# Installed\n')
        }
        expect(exists('.claude/skills/nera/recipes/gone.md')).toBe(false)
        expect(output()).toContain('✓ Added the Nera skill in .agents/skills/nera')
        expect(output()).toContain('✓ Refreshed the Nera skill in .claude/skills/nera')
    })

    it('reports both folders unchanged on a second run', async () => {
        await writePkg(thinPkg)
        await update()
        log.mockClear()
        await update()

        for (const folder of SKILL_FOLDERS) {
            expect(output()).toContain(`✓ ${folder} unchanged`)
        }
    })

    it('leaves other skills and settings alone', async () => {
        await writePkg(thinPkg)
        await fs.mkdir(path.join(cwd, '.claude/skills/other'), { recursive: true })
        await fs.writeFile(path.join(cwd, '.claude/skills/other/SKILL.md'), 'other\n')
        await fs.writeFile(path.join(cwd, '.claude/settings.json'), '{}\n')
        await update()

        expect(await read('.claude/skills/other/SKILL.md')).toBe('other\n')
        expect(await read('.claude/settings.json')).toBe('{}\n')
    })

    it('adds the skill after --migrate', async () => {
        await writePkg({ dependencies: {} })
        await writeVendoredEngine()
        await update(['--migrate'])

        for (const folder of SKILL_FOLDERS) {
            expect(exists(`${folder}/SKILL.md`)).toBe(true)
        }
    })

    it('writes nothing for a legacy site without --migrate', async () => {
        await writePkg({ dependencies: {} })
        await writeVendoredEngine()
        await update()

        expect(exists('.agents')).toBe(false)
        expect(exists('.claude')).toBe(false)
    })

    it('writes nothing when npm update fails', async () => {
        await writePkg(thinPkg)
        const runNpm = () => {
            throw new Error('npm failed')
        }
        await expect(update([], runNpm)).rejects.toThrow('npm failed')

        expect(exists('.agents')).toBe(false)
        expect(exists('.claude')).toBe(false)
    })

    it('defaults to the package\'s own skill', async () => {
        await writePkg(thinPkg)
        await runUpdate([], { cwd, runNpm: () => {}, templateDir: fallbackTemplate })

        expect(await read('.agents/skills/nera/SKILL.md')).toBe(
            await fs.readFile(path.join(skillSourceDir(), 'SKILL.md'), 'utf-8')
        )
    })
})
