import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { watchTargets } from '../src/commands/dev.js'

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
})
