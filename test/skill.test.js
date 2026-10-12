import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import { parse as parseYaml } from 'yaml'
import { installedSkillDir, skillSourceDir, syncSkill } from '../src/skill.js'

const RECIPES = [
    'business-site.md',
    'blog.md',
    'portfolio.md',
    'contact-form.md',
    'search.md',
    'images.md',
    'multilingual.md',
    'custom-domain.md',
]

// Every file under dir, as paths relative to it with `/`.
async function listFiles(dir, prefix = '') {
    const files = []
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
            files.push(...(await listFiles(path.join(dir, entry.name), rel)))
        } else {
            files.push(rel)
        }
    }
    return files.sort()
}

// The YAML between the opening `---` line and the next one, and the body.
function splitFrontmatter(text) {
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
    return match ? { frontmatter: match[1], body: match[2] } : null
}

// Markdown link targets that are neither URLs nor in-page anchors. Code
// blocks and code spans are examples for the site, not links, so they are
// left out.
function relativeLinks(text) {
    const prose = text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '')
    return [...prose.matchAll(/\]\(([^)\s]+)\)/g)]
        .map(([, target]) => target)
        .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#'))
}

describe('the skill source (skills/nera)', () => {
    it('is named after its folder', () => {
        expect(path.basename(skillSourceDir())).toBe('nera')
    })

    it('has portable frontmatter: name and description only', async () => {
        const text = await fs.readFile(path.join(skillSourceDir(), 'SKILL.md'), 'utf-8')
        const parts = splitFrontmatter(text)
        expect(parts).not.toBeNull()
        const meta = parseYaml(parts.frontmatter)

        expect(Object.keys(meta).sort()).toEqual(['description', 'name'])
        expect(meta.name).toBe(path.basename(skillSourceDir()))
        expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
        expect(meta.name.length).toBeLessThanOrEqual(64)
        expect(typeof meta.description).toBe('string')
        expect(meta.description.length).toBeGreaterThan(0)
        expect(meta.description.length).toBeLessThanOrEqual(1024)
    })

    it('keeps SKILL.md well under 500 lines', async () => {
        const text = await fs.readFile(path.join(skillSourceDir(), 'SKILL.md'), 'utf-8')
        expect(text.split('\n').length).toBeLessThan(200)
    })

    it('ships all eight recipes, each linked from SKILL.md', async () => {
        const text = await fs.readFile(path.join(skillSourceDir(), 'SKILL.md'), 'utf-8')
        const links = relativeLinks(text)
        for (const recipe of RECIPES) {
            expect(fssync.existsSync(path.join(skillSourceDir(), 'recipes', recipe))).toBe(true)
            expect(links).toContain(`recipes/${recipe}`)
        }
    })

    it('has only relative links that resolve to a file', async () => {
        const files = (await listFiles(skillSourceDir())).filter((f) => f.endsWith('.md'))
        const broken = []
        for (const file of files) {
            const text = await fs.readFile(path.join(skillSourceDir(), file), 'utf-8')
            for (const link of relativeLinks(text)) {
                const target = path.resolve(path.dirname(path.join(skillSourceDir(), file)), link.split('#')[0])
                if (!fssync.existsSync(target) || !fssync.statSync(target).isFile()) {
                    broken.push(`${file} → ${link}`)
                }
            }
        }
        expect(broken).toEqual([])
    })

    it('keeps every recipe short', async () => {
        for (const recipe of RECIPES) {
            const text = await fs.readFile(path.join(skillSourceDir(), 'recipes', recipe), 'utf-8')
            expect(text.split('\n').length, recipe).toBeLessThanOrEqual(80)
        }
    })

    it('is in the published files', async () => {
        const pkg = JSON.parse(
            await fs.readFile(path.join(skillSourceDir(), '..', '..', 'package.json'), 'utf-8')
        )
        expect(pkg.files).toContain('skills')
    })
})

describe('relativeLinks', () => {
    it('skips URLs and anchors', () => {
        const text = '[a](recipes/a.md) [b](https://x.org/b.md) [c](#c) [d](mailto:x@y.z)'
        expect(relativeLinks(text)).toEqual(['recipes/a.md'])
    })

    it('skips examples in code spans and code blocks', () => {
        const text = 'See [e](e.md), `![x](/x.jpg)`.\n\n```md\n[y](y.md)\n```\n'
        expect(relativeLinks(text)).toEqual(['e.md'])
    })
})

let cwd
let source

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-skill-'))
    source = path.join(cwd, 'source')
    await fs.mkdir(path.join(source, 'recipes'), { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), '---\nname: nera\n---\n')
    await fs.writeFile(path.join(source, 'recipes', 'blog.md'), '# Blog\n')
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
})

const site = (...parts) => path.join(cwd, 'site', ...parts)
const TARGETS = ['.agents/skills/nera', '.claude/skills/nera']

describe('syncSkill', () => {
    it('creates both folders as copies of the source', async () => {
        const results = await syncSkill({ cwd: site(), sourceDir: source })

        expect(results).toEqual(TARGETS.map((p) => ({ path: p, action: 'created' })))
        for (const target of TARGETS) {
            expect(await listFiles(site(target))).toEqual(['SKILL.md', 'recipes/blog.md'])
            expect(await fs.readFile(site(target, 'recipes', 'blog.md'), 'utf-8')).toBe('# Blog\n')
        }
    })

    it('is a no-op on a second run and leaves timestamps alone', async () => {
        await syncSkill({ cwd: site(), sourceDir: source })
        const old = new Date('2020-01-01T00:00:00Z')
        for (const target of TARGETS) {
            await fs.utimes(site(target, 'SKILL.md'), old, old)
        }

        const results = await syncSkill({ cwd: site(), sourceDir: source })

        expect(results).toEqual(TARGETS.map((p) => ({ path: p, action: 'unchanged' })))
        for (const target of TARGETS) {
            expect((await fs.stat(site(target, 'SKILL.md'))).mtime).toEqual(old)
        }
    })

    it('restores an edited file and leaves the other folder unchanged', async () => {
        await syncSkill({ cwd: site(), sourceDir: source })
        await fs.writeFile(site('.claude/skills/nera/recipes/blog.md'), 'edited\n')

        const results = await syncSkill({ cwd: site(), sourceDir: source })

        expect(results).toEqual([
            { path: '.agents/skills/nera', action: 'unchanged' },
            { path: '.claude/skills/nera', action: 'updated' },
        ])
        expect(await fs.readFile(site('.claude/skills/nera/recipes/blog.md'), 'utf-8')).toBe('# Blog\n')
    })

    it('follows a changed source', async () => {
        await syncSkill({ cwd: site(), sourceDir: source })
        await fs.writeFile(path.join(source, 'recipes', 'blog.md'), '# Blog, new\n')
        await fs.writeFile(path.join(source, 'recipes', 'search.md'), '# Search\n')

        const results = await syncSkill({ cwd: site(), sourceDir: source })

        expect(results.map((r) => r.action)).toEqual(['updated', 'updated'])
        for (const target of TARGETS) {
            expect(await listFiles(site(target))).toEqual([
                'SKILL.md',
                'recipes/blog.md',
                'recipes/search.md',
            ])
        }
    })

    it('removes stale files and folders inside nera/', async () => {
        await syncSkill({ cwd: site(), sourceDir: source })
        await fs.writeFile(site('.agents/skills/nera/recipes/old.md'), 'stale\n')
        await fs.mkdir(site('.agents/skills/nera/old'), { recursive: true })
        await fs.writeFile(site('.agents/skills/nera/old/x.md'), 'stale\n')

        const results = await syncSkill({ cwd: site(), sourceDir: source })

        expect(results[0]).toEqual({ path: '.agents/skills/nera', action: 'updated' })
        expect(await listFiles(site('.agents/skills/nera'))).toEqual(['SKILL.md', 'recipes/blog.md'])
    })

    it('replaces a file where a folder belongs, and the reverse', async () => {
        await fs.mkdir(site('.claude/skills/nera'), { recursive: true })
        await fs.writeFile(site('.claude/skills/nera/recipes'), 'a file\n')
        await fs.mkdir(site('.claude/skills/nera/SKILL.md'))

        await syncSkill({ cwd: site(), sourceDir: source })

        expect(await listFiles(site('.claude/skills/nera'))).toEqual(['SKILL.md', 'recipes/blog.md'])
    })

    it('never touches other skills or settings', async () => {
        await fs.mkdir(site('.claude/skills/other'), { recursive: true })
        await fs.writeFile(site('.claude/skills/other/SKILL.md'), 'other\n')
        await fs.writeFile(site('.claude/settings.json'), '{}\n')
        await fs.mkdir(site('.agents/skills/mine'), { recursive: true })
        await fs.writeFile(site('.agents/skills/mine/SKILL.md'), 'mine\n')
        const old = new Date('2020-01-01T00:00:00Z')
        await fs.utimes(site('.claude/settings.json'), old, old)

        await syncSkill({ cwd: site(), sourceDir: source })
        await syncSkill({ cwd: site(), sourceDir: source })

        expect(await fs.readFile(site('.claude/skills/other/SKILL.md'), 'utf-8')).toBe('other\n')
        expect(await fs.readFile(site('.agents/skills/mine/SKILL.md'), 'utf-8')).toBe('mine\n')
        expect(await fs.readFile(site('.claude/settings.json'), 'utf-8')).toBe('{}\n')
        expect((await fs.stat(site('.claude/settings.json'))).mtime).toEqual(old)
    })

    it('throws on a source without SKILL.md, before writing anything', async () => {
        await fs.rm(path.join(source, 'SKILL.md'))
        await expect(syncSkill({ cwd: site(), sourceDir: source })).rejects.toThrow(/no SKILL.md/)
        expect(fssync.existsSync(site('.agents'))).toBe(false)
    })

    it('copies the shipped skill exactly', async () => {
        await syncSkill({ cwd: site(), sourceDir: skillSourceDir() })
        const expected = await listFiles(skillSourceDir())
        for (const target of TARGETS) {
            expect(await listFiles(site(target))).toEqual(expected)
            for (const file of expected) {
                expect(await fs.readFile(site(target, file), 'utf-8')).toBe(
                    await fs.readFile(path.join(skillSourceDir(), file), 'utf-8')
                )
            }
        }
    })
})

describe('installedSkillDir', () => {
    const installed = () => path.join(cwd, 'node_modules', '@nera-static', 'nera', 'skills', 'nera')

    it('prefers the site\'s installed @nera-static/nera skill', async () => {
        await fs.mkdir(installed(), { recursive: true })
        await fs.writeFile(path.join(installed(), 'SKILL.md'), '---\nname: nera\n---\n')
        expect(installedSkillDir(cwd, '/fallback')).toBe(installed())
    })

    it('falls back when nothing is installed or the version has no skill', async () => {
        expect(installedSkillDir(cwd, '/fallback')).toBe('/fallback')
        await fs.mkdir(path.join(cwd, 'node_modules', '@nera-static', 'nera', 'template'), {
            recursive: true,
        })
        expect(installedSkillDir(cwd, '/fallback')).toBe('/fallback')
    })
})
