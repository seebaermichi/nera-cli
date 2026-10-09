import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { scaffoldProject } from '../src/scaffold.js'
import { runCheck } from '../src/commands/check.js'

// `nera check` delegates to validateOutput from @nera-static/validate. These
// prove the wiring, the "build first" error and the exit-code contract against
// a hand-written public/, without a build or a live process.exit.

// A built page that is clean except for its missing `lang` (a11y-html-lang).
const page = (htmlAttrs) =>
    `<!DOCTYPE html>\n<html${htmlAttrs}>\n  <head>\n    <title>T</title>\n  </head>\n  <body>\n    <a href="#main">Skip</a><main id="main"><h1>Hi</h1></main><footer><a href="/imprint.html">Imprint</a> <a href="/privacy.html">Privacy</a></footer>\n  </body>\n</html>\n`

let workdir, target, log

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-cli-check-'))
    target = await scaffoldProject('site', { cwd: workdir, install: false })
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    log.mockRestore()
    await fs.rm(workdir, { recursive: true, force: true })
})

const writePublic = async (html) => {
    await fs.mkdir(path.join(target, 'public'), { recursive: true })
    await fs.writeFile(path.join(target, 'public', 'index.html'), html)
}

const printed = () => log.mock.calls.map((c) => c.join(' ')).join('\n')

describe('nera check', () => {
    it('says to build first when public/ is missing', () => {
        expect(() => runCheck({ cwd: target })).toThrow('run `nera build` first')
    })

    it('returns 0 for a clean output and still ends with the note', async () => {
        await writePublic(page(' lang="en"'))
        expect(runCheck({ cwd: target })).toBe(0)
        expect(printed()).toContain('No problems found.')
        expect(printed()).toContain('not proof of compliance')
    })

    it('returns 0 when there are warnings only', async () => {
        await writePublic(page(''))
        expect(runCheck({ cwd: target })).toBe(0)
        expect(printed()).toContain('a11y-html-lang')
        expect(printed()).toContain('0 error(s), 1 warning(s)')
    })

    it('returns 1 when a rule promoted to error fires', async () => {
        await writePublic(page(''))
        await fs.writeFile(
            path.join(target, 'config', 'validate.yaml'),
            'rules:\n  a11y-html-lang: error\n'
        )
        expect(runCheck({ cwd: target })).toBe(1)
        expect(printed()).toContain('1 error(s), 0 warning(s)')
    })
})
