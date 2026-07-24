import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { scaffoldProject } from '../src/scaffold.js'
import { runValidate } from '../src/commands/validate.js'

// `nera validate` delegates to @nera-static/validate. These prove the wiring and
// the exit-code contract without a live process.exit.

let workdir

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-validate-'))
})

afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('nera validate', () => {
    it('returns 0 for a freshly scaffolded (valid) site', async () => {
        const target = await scaffoldProject('ok', { cwd: workdir, install: false })
        expect(runValidate({ cwd: target })).toBe(0)
    })

    it('returns 1 when a page layout does not resolve', async () => {
        const target = await scaffoldProject('bad', { cwd: workdir, install: false })
        await fs.writeFile(
            path.join(target, 'pages', 'index.md'),
            '---\nlayout: pages/nope.pug\n---\n# x\n'
        )
        expect(runValidate({ cwd: target })).toBe(1)
    })
})
