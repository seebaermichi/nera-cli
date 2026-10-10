import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import { scaffoldProject } from '../src/scaffold.js'
import { runBuild } from '../src/commands/build.js'

// End-to-end proof of the developer loop: `nera new` then `nera build` produces
// a rendered page. Requires @nera-static/core to be resolvable (linked locally
// until it is published).

let workdir, prevCwd

beforeEach(async () => {
    prevCwd = process.cwd()
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-build-'))
})

afterEach(async () => {
    process.chdir(prevCwd)
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('new → build', () => {
    it('scaffolds a site and renders it to public/index.html', async () => {
        const target = await scaffoldProject('site', {
            cwd: workdir,
            install: false,
        })
        process.chdir(target)

        await runBuild()

        const out = path.join(target, 'public', 'index.html')
        expect(fssync.existsSync(out)).toBe(true)

        const html = await fs.readFile(out, 'utf-8')
        expect(html).toContain('Welcome to Nera')
        expect(html).toContain('<title>')
        // AGENTS.md / CLAUDE.md sit at the site root, outside pages/.
        const built = await fs.readdir(path.join(target, 'public'))
        expect(built.filter((n) => /^(AGENTS|CLAUDE)\./.test(n))).toEqual([])
    })

    describe('--check', () => {
        let log

        beforeEach(() => {
            log = vi.spyOn(console, 'log').mockImplementation(() => {})
        })

        afterEach(() => {
            log.mockRestore()
        })

        const printed = () => log.mock.calls.map((c) => c.join(' ')).join('\n')

        it('builds, then checks the output; warnings alone return 0', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            process.chdir(target)

            expect(await runBuild(['--check'])).toBe(0)
            expect(fssync.existsSync(path.join(target, 'public', 'index.html')))
                .toBe(true)
            // The starter layout has no skip link.
            expect(printed()).toContain('a11y-skip-link')
            expect(printed()).toContain('not proof of compliance')
        })

        it('returns 1 when a rule promoted to error fires', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            await fs.writeFile(
                path.join(target, 'config', 'validate.yaml'),
                'rules:\n  a11y-skip-link: error\n'
            )
            process.chdir(target)

            expect(await runBuild(['--check'])).toBe(1)
        })

        it('does not check without the flag', async () => {
            const target = await scaffoldProject('site', {
                cwd: workdir,
                install: false,
            })
            process.chdir(target)

            expect(await runBuild()).toBe(0)
            expect(printed()).not.toContain('a11y-skip-link')
        })
    })
})
