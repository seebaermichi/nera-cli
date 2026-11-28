import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import { nera } from '@nera-static/test-utils'
import { scaffoldProject } from '../src/scaffold.js'
import { runValidate } from '../src/commands/validate.js'

// This repo, `@nera-static/nera` itself: `nera()` runs its own bin/nera.js.
const REPO = path.resolve(import.meta.dirname, '..')

const STARTER_FIXTURE = path.resolve(import.meta.dirname, 'fixtures/starter-minimal')

// End-to-end proof of the developer loop: `nera new` then `nera build` produces
// a rendered page. The build runs this repo's CLI as a child in the site, as
// a user runs it: core reads the site relative to the working directory.

let workdir

// `nera build ...args` in `target`, with this repo's bin/nera.js.
const build = (target, args = []) => nera(target, ['build', ...args], { root: REPO })

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-build-'))
})

afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('new → build', () => {
    it('scaffolds a site and renders it to public/index.html', async () => {
        const target = await scaffoldProject('site', {
            cwd: workdir,
            install: false,
        })

        expect((await build(target)).code).toBe(0)

        const out = path.join(target, 'public', 'index.html')
        expect(fssync.existsSync(out)).toBe(true)

        const html = await fs.readFile(out, 'utf-8')
        expect(html).toContain('Welcome to Nera')
        expect(html).toContain('<title>')
        expect(html).toContain('<a class="skip-link" href="#main">Skip to content</a>')
        expect(html).toContain('<main id="main">')
        // AGENTS.md / CLAUDE.md sit at the site root, outside pages/.
        const built = await fs.readdir(path.join(target, 'public'))
        expect(built.filter((n) => /^(AGENTS|CLAUDE)\./.test(n))).toEqual([])
    })

    it('builds a site scaffolded from a starter, with --name and --lang', async () => {
        // A copy without the plugin dependency: it cannot be installed offline.
        const starter = path.join(workdir, 'starter')
        await fs.cp(STARTER_FIXTURE, starter, { recursive: true })
        const pkgPath = path.join(starter, 'package.json')
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
        delete pkg.dependencies['@nera-static/plugin-navigation']
        await fs.writeFile(pkgPath, JSON.stringify(pkg))

        vi.spyOn(console, 'log').mockImplementation(() => {})
        const target = await scaffoldProject('site', {
            cwd: workdir,
            install: false,
            starter,
            name: 'Brot & Zeit',
            lang: 'de',
        })
        expect((await build(target)).code).toBe(0)

        const index = await fs.readFile(path.join(target, 'public', 'index.html'), 'utf-8')
        expect(index).toContain('Hello from the minimal starter')
        expect(index).toContain('<html lang="de">')
        expect(index).toMatch(/<title>Start \| Brot &amp; Zeit<\/title>/)
        const built = await fs.readdir(path.join(target, 'public'), { recursive: true })
        const about = built.find((f) => /^about(\/index)?\.html$/.test(f))
        expect(about).toBeDefined()
        const aboutHtml = await fs.readFile(path.join(target, 'public', about), 'utf-8')
        expect(aboutHtml).toContain('<main class="about">')
    })

    describe('--check', () => {
        // The tests that need a finding bring their own instead of relying on
        // a scaffold defect: a page with an image without `alt` (a11y-img-alt).
        const addPageWithoutAlt = (target) => fs.writeFile(
            path.join(target, 'pages', 'photo.md'),
            '---\nlayout: pages/default.pug\ntitle: Photo\n---\n# Photo\n\n<img src="/photo.jpg">\n',
        )

        it('builds, then checks the output; warnings alone return 0', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            await addPageWithoutAlt(target)

            const { code, stdout } = await build(target, ['--check'])

            expect(code).toBe(0)
            expect(fssync.existsSync(path.join(target, 'public', 'index.html')))
                .toBe(true)
            expect(stdout).toMatch(/public\/photo\.html\n( {2}.*\n)*.*a11y-img-alt/)
            expect(stdout).toContain('not proof of compliance')
        })

        // A fresh scaffold has a skip link, `main#main` and footer links to its
        // imprint and privacy placeholders, so both passes report nothing.
        it.each([
            ['a fresh scaffold', {}],
            ['a fresh scaffold with --name and --lang de', { name: 'Brot & Zeit', lang: 'de' }],
        ])('reports no problems on %s, in build --check and validate', async (_, opts) => {
            const log = vi.spyOn(console, 'log').mockImplementation(() => {})
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
                ...opts,
            })

            const { code, stdout } = await build(target, ['--check'])
            expect(code).toBe(0)
            expect(stdout).toContain('No problems found.')
            expect(stdout).not.toMatch(/(a11y|privacy|legal)-/)

            log.mockClear()
            expect(runValidate({ cwd: target })).toBe(0)
            expect(log.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('No problems found.')

            const imprint = await fs.readFile(path.join(target, 'public', 'imprint.html'), 'utf-8')
            expect(imprint).toContain('<strong>This is a placeholder.</strong>')
            expect(imprint).toContain('<a href="/imprint.html">Imprint</a>')
            expect(imprint).toContain('<a href="/privacy.html">Privacy</a>')
            expect(fssync.existsSync(path.join(target, 'public', 'privacy.html'))).toBe(true)
        })

        it('returns 1 when a rule promoted to error fires', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            await addPageWithoutAlt(target)
            await fs.writeFile(
                path.join(target, 'config', 'validate.yaml'),
                'rules:\n  a11y-img-alt: error\n',
            )

            const { code, stdout } = await build(target, ['--check'])
            expect(code).toBe(1)
            expect(stdout).toContain('a11y-img-alt')
        })

        it('does not check without the flag', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            await addPageWithoutAlt(target)

            const { code, stdout } = await build(target)
            expect(code).toBe(0)
            expect(stdout).not.toContain('a11y-img-alt')
        })
    })
})
