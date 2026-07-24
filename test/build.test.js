import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    })
})
