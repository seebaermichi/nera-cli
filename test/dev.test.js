import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { createRebuilder, watchTargets } from '../src/commands/dev.js'

describe('watchTargets', () => {
    let site
    const savedTheme = process.env.NERA_THEME

    const mkdirs = (...dirs) =>
        Promise.all(
            dirs.map((d) => fs.mkdir(path.join(site, d), { recursive: true }))
        )
    const setTheme = (theme) =>
        fs.writeFile(
            path.join(site, 'config', 'app.yaml'),
            theme ? `theme: ${theme}\n` : 'lang: en\n'
        )

    beforeEach(async () => {
        site = await fs.realpath(
            await fs.mkdtemp(path.join(os.tmpdir(), 'nera-dev-'))
        )
        await mkdirs('pages', 'config', 'theme/views')
        delete process.env.NERA_THEME
    })

    afterEach(async () => {
        await fs.rm(site, { recursive: true, force: true })
        if (savedTheme === undefined) delete process.env.NERA_THEME
        else process.env.NERA_THEME = savedTheme
    })

    it('watches pages, config and theme on a themeless site', async () => {
        await setTheme(null)
        expect(watchTargets(site)).toEqual(
            ['pages', 'config', 'theme'].map((d) => path.join(site, d))
        )
    })

    it('adds the payload folders of a local theme', async () => {
        await mkdirs('themes/classic/views', 'themes/classic/assets')
        await setTheme('./themes/classic')

        const targets = watchTargets(site)
        expect(targets).toContain(path.join(site, 'themes/classic/views'))
        expect(targets).toContain(path.join(site, 'themes/classic/assets'))
        // No config/ in this theme, so nothing to watch there.
        expect(targets).not.toContain(path.join(site, 'themes/classic/config'))
    })

    it('follows NERA_THEME over app.yaml', async () => {
        await mkdirs('themes/a/views', 'themes/b/views')
        await setTheme('./themes/a')
        process.env.NERA_THEME = './themes/b'

        const targets = watchTargets(site)
        expect(targets).toContain(path.join(site, 'themes/b/views'))
        expect(targets).not.toContain(path.join(site, 'themes/a/views'))
    })

    it('never watches the site root for `theme: .`', async () => {
        await mkdirs('views', 'public')
        await setTheme('.')

        const targets = watchTargets(site)
        expect(targets).not.toContain(site)
        expect(targets).not.toContain(path.join(site, 'public'))
    })

    it('leaves an installed theme package in node_modules alone', async () => {
        const pkg = path.join(site, 'node_modules/@nera-static/theme-x')
        await fs.mkdir(path.join(pkg, 'views'), { recursive: true })
        await fs.writeFile(
            path.join(pkg, 'package.json'),
            JSON.stringify({ name: '@nera-static/theme-x' })
        )
        await fs.writeFile(
            path.join(site, 'package.json'),
            JSON.stringify({ name: 'site' })
        )
        await setTheme('x')

        expect(watchTargets(site).some((d) => d.includes('node_modules'))).toBe(
            false
        )
    })

    describe('data folder', () => {
        const setDataFolder = (value) =>
            fs.writeFile(
                path.join(site, 'config', 'app.yaml'),
                `folders:\n    data: ${value}\n`
            )

        it('watches data/ by default', async () => {
            await setTheme(null)
            await mkdirs('data')
            expect(watchTargets(site)).toEqual(
                ['pages', 'config', 'theme', 'data'].map((d) =>
                    path.join(site, d)
                )
            )
        })

        it('watches folders.data from app.yaml instead of data/', async () => {
            await mkdirs('data', 'catalog')
            await setDataFolder('./catalog')

            const targets = watchTargets(site)
            expect(targets).toContain(path.join(site, 'catalog'))
            expect(targets).not.toContain(path.join(site, 'data'))
        })

        it('adds nothing when the data folder is missing', async () => {
            await setDataFolder('./catalog')
            expect(watchTargets(site)).toEqual(
                ['pages', 'config', 'theme'].map((d) => path.join(site, d))
            )
        })

        it.each([['42'], ['""'], ['"   "']])(
            'falls back to data/ for folders.data: %s',
            async (value) => {
                await mkdirs('data')
                await setDataFolder(value)
                expect(watchTargets(site)).toContain(path.join(site, 'data'))
            }
        )

        it.each([['.'], ['./public'], ['public/data'], ['..']])(
            'never watches the build output for folders.data: %s',
            async (value) => {
                await mkdirs('public/data')
                await setDataFolder(value)

                const targets = watchTargets(site)
                expect(targets).toEqual(
                    ['pages', 'config', 'theme'].map((d) => path.join(site, d))
                )
            }
        )

        it('never watches a data folder inside a custom folders.dist', async () => {
            await mkdirs('out/data')
            await fs.writeFile(
                path.join(site, 'config', 'app.yaml'),
                'folders:\n    dist: ./out\n    data: ./out/data\n'
            )
            expect(watchTargets(site)).not.toContain(
                path.join(site, 'out', 'data')
            )
        })

        it('picks up a data folder created after a first call', async () => {
            await setTheme(null)
            expect(watchTargets(site)).not.toContain(path.join(site, 'data'))

            await mkdirs('data')
            expect(watchTargets(site)).toContain(path.join(site, 'data'))
        })
    })
})

describe('createRebuilder', () => {
    // A build that resolves only when the test says so, to land changes
    // mid-build.
    const deferred = () => {
        let resolve
        const promise = new Promise((r) => (resolve = r))
        return { promise, resolve }
    }

    it('reloads once after a successful build, never before it resolves', async () => {
        const events = []
        const gate = deferred()
        const rebuild = createRebuilder({
            build: async () => {
                events.push('build:start')
                await gate.promise
                events.push('build:end')
            },
            onBuilt: () => events.push('reload'),
        })

        const done = rebuild()
        await Promise.resolve()
        expect(events).toEqual(['build:start'])

        gate.resolve()
        await done
        expect(events).toEqual(['build:start', 'build:end', 'reload'])
    })

    it('does not reload after a build that throws', async () => {
        const onBuilt = vi.fn()
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const rebuild = createRebuilder({
            build: async () => {
                throw new Error('bad frontmatter')
            },
            onBuilt,
        })

        await rebuild()

        expect(onBuilt).not.toHaveBeenCalled()
        expect(error).toHaveBeenCalledWith('❌ Build error:', 'bad frontmatter')
        error.mockRestore()
    })

    it('coalesces changes during a build into one re-run and one more reload', async () => {
        const gates = [deferred(), deferred()]
        let calls = 0
        const build = vi.fn(() => gates[calls++].promise)
        const onBuilt = vi.fn()
        const rebuild = createRebuilder({ build, onBuilt })

        const first = rebuild()
        // Three changes land while the first build runs.
        await Promise.all([rebuild(), rebuild(), rebuild()])
        expect(build).toHaveBeenCalledTimes(1)
        expect(onBuilt).not.toHaveBeenCalled()

        gates[0].resolve()
        await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2))
        expect(onBuilt).toHaveBeenCalledTimes(1)

        gates[1].resolve()
        await first
        expect(build).toHaveBeenCalledTimes(2)
        expect(onBuilt).toHaveBeenCalledTimes(2)
    })

    it('runs afterBuild after every build, failed ones included', async () => {
        const events = []
        let fail = true
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        const rebuild = createRebuilder({
            build: async () => {
                events.push('build')
                if (fail) throw new Error('boom')
            },
            afterBuild: () => events.push('rewatch'),
            onBuilt: () => events.push('reload'),
        })

        await rebuild()
        fail = false
        await rebuild()

        expect(events).toEqual([
            'build',
            'rewatch',
            'build',
            'rewatch',
            'reload',
        ])
        error.mockRestore()
    })
})
