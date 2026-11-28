import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import {
    validateStarterSpec,
    starterSource,
    packStarter,
    fetchStarter,
    readStarterManifest,
    applyStarter,
    listStarters,
    firstStepsSection,
} from '../src/starter.js'
import { BUNDLED_STARTERS } from '../src/starters.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/starter-minimal', import.meta.url))

let workdir

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-starter-test-'))
})

afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('validateStarterSpec', () => {
    it('accepts the four forms', () => {
        for (const spec of [
            'blank',
            'my-blog',
            '@acme/starter-x',
            'nera-starter-x',
            'https://github.com/owner/repo',
            'https://github.com/owner/repo.git',
            'https://github.com/owner/repo#v1.2.0',
            'https://github.com/my-org/nera-starter-shop.git#feature/x',
            'github:owner/repo',
            'github:owner/repo#main',
            './my-starter',
            '../starters/x',
            '.',
            '/abs/path/to/starter',
        ]) {
            expect(validateStarterSpec(spec)).toBe(spec)
        }
    })

    it('refuses junk and unsafe values, naming the four forms', () => {
        for (const spec of [
            '',
            'a b',
            '-x',
            'Blank',
            '@acme',
            'foo; rm -rf /',
            'http://github.com/o/r',
            'https://gitlab.com/o/r',
            'https://github.com/o',
            'https://github.com/o/r#-x',
            'github:o',
            'git+ssh://git@github.com/o/r.git',
            'file:../x',
            undefined,
        ]) {
            expect(() => validateStarterSpec(spec)).toThrow(
                /Invalid starter .*starter name \(blank\).*package name.*GitHub URL.*local path/,
            )
        }
    })
})

describe('starterSource', () => {
    it.each([
        ['blank', { kind: 'npm', spec: '@nera-static/starter-blank' }],
        ['stack', { kind: 'npm', spec: '@nera-static/starter-stack' }],
        ['ansitz', { kind: 'npm', spec: '@nera-static/starter-ansitz' }],
        ['umwege', { kind: 'npm', spec: '@nera-static/starter-umwege' }],
        ['@acme/starter-x', { kind: 'npm', spec: '@acme/starter-x' }],
        ['nera-starter-x', { kind: 'npm', spec: 'nera-starter-x' }],
        ['https://github.com/o/r', { kind: 'npm', spec: 'github:o/r' }],
        ['https://github.com/o/r.git#ref', { kind: 'npm', spec: 'github:o/r#ref' }],
        ['github:o/r#v2', { kind: 'npm', spec: 'github:o/r#v2' }],
        ['./x', { kind: 'local', path: './x' }],
        ['/abs/x', { kind: 'local', path: '/abs/x' }],
    ])('%s', (spec, expected) => {
        expect(starterSource(spec)).toEqual(expected)
    })
})

describe('packStarter', () => {
    let log
    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {})
    })
    afterEach(() => log.mockRestore())

    // Stands in for `npm pack` + `tar`: writes a tarball name, then
    // "extracts" the fixture to <out>/package, resolving `-C` against the
    // call's cwd the way tar does.
    const fakeExec = (calls, optionsSeen = []) => (cmd, args, options = {}) => {
        calls.push([cmd, ...args])
        optionsSeen.push(options)
        if (cmd === 'npm') {
            const dest = args[args.indexOf('--pack-destination') + 1]
            fssync.writeFileSync(path.join(dest, 'starter-1.0.0.tgz'), '')
        } else if (cmd === 'tar') {
            const out = path.resolve(options.cwd ?? process.cwd(), args[args.indexOf('-C') + 1])
            fssync.cpSync(FIXTURE, path.join(out, 'package'), { recursive: true })
        }
    }

    it('packs with --ignore-scripts, extracts package/ and cleans up', async () => {
        const calls = []
        const { dir, cleanup } = await packStarter('github:o/r#v1', { exec: fakeExec(calls) })

        expect(calls[0].slice(0, 4)).toEqual(['npm', 'pack', 'github:o/r#v1', '--ignore-scripts'])
        expect(log).toHaveBeenCalledWith('📦 Downloading the starter "github:o/r#v1"...')
        expect(path.basename(dir)).toBe('package')
        expect((await readStarterManifest(dir)).nera.starter.label).toBe('Minimal')

        const tmp = path.dirname(path.dirname(dir))
        expect(path.dirname(tmp)).toBe(os.tmpdir())
        await cleanup()
        expect(fssync.existsSync(tmp)).toBe(false)
    })

    // No drive letter ever reaches tar (Git-for-Windows' GNU tar reads `C:`
    // as a remote host): it runs in the pack folder with relative paths only.
    it('runs tar inside the pack folder with relative paths', async () => {
        const calls = []
        const optionsSeen = []
        const { dir, cleanup } = await packStarter('github:o/r#v1', { exec: fakeExec(calls, optionsSeen) })
        const tmp = path.dirname(path.dirname(dir))

        expect(calls[1]).toEqual(['tar', '-xzf', 'starter-1.0.0.tgz', '-C', '../out'])
        expect(optionsSeen[1]).toEqual({ cwd: path.join(tmp, 'pack'), stdio: 'pipe', env: process.env })
        await cleanup()
    })

    it('hands env and signal to npm pack and tar, process.env by default', async () => {
        const env = { PATH: '/shim/bin' }
        const signal = new AbortController().signal
        const optionsSeen = []
        const { cleanup } = await packStarter('github:o/r#v1', {
            exec: fakeExec([], optionsSeen),
            env,
            signal,
        })
        expect(optionsSeen.map((o) => [o.env, o.signal])).toEqual([[env, signal], [env, signal]])
        await cleanup()

        const defaults = []
        await (await packStarter('github:o/r#v1', { exec: fakeExec([], defaults) })).cleanup()
        expect(defaults.map((o) => o.env)).toEqual([process.env, process.env])
    })

    // A real async exec that aborts mid-download: whatever npm pack rejects
    // with, the caller gets the abort reason, not "Could not download".
    it('rejects with the abort reason mid-pack and leaves no temp folder', async () => {
        const before = await fs.readdir(os.tmpdir())
        const controller = new AbortController()
        const reason = new DOMException('cancelled', 'AbortError')
        const exec = vi.fn(async (cmd) => {
            controller.abort(reason)
            const err = new Error(`Command failed: ${cmd}`)
            err.stderr = 'npm error 404 Not Found\n'
            throw err
        })
        await expect(
            packStarter('github:o/r#v1', { exec, signal: controller.signal }),
        ).rejects.toBe(reason)
        expect(exec).toHaveBeenCalledTimes(1)
        const after = await fs.readdir(os.tmpdir())
        expect(after.filter((n) => n.startsWith('nera-starter-') && !before.includes(n))).toEqual([])
    })

    it('rejects with the abort reason when the signal aborts during tar', async () => {
        const before = await fs.readdir(os.tmpdir())
        const controller = new AbortController()
        const pack = fakeExec([])
        const exec = async (cmd, args, options) => {
            await pack(cmd, args, options)
            if (cmd === 'tar') controller.abort()
        }
        const err = await packStarter('github:o/r#v1', { exec, signal: controller.signal }).catch((e) => e)
        expect(err.name).toBe('AbortError')
        const after = await fs.readdir(os.tmpdir())
        expect(after.filter((n) => n.startsWith('nera-starter-') && !before.includes(n))).toEqual([])
    })

    it('rejects with the abort reason when tar fails after an abort', async () => {
        const controller = new AbortController()
        const reason = new Error('cancelled')
        const pack = fakeExec([])
        const exec = async (cmd, args, options) => {
            await pack(cmd, args, options)
            if (cmd === 'tar') {
                controller.abort(reason)
                throw new Error('tar: Unexpected EOF')
            }
        }
        await expect(packStarter('github:o/r#v1', { exec, signal: controller.signal })).rejects.toBe(reason)
    })

    it('starts nothing when the signal is already aborted', async () => {
        const exec = vi.fn()
        const signal = AbortSignal.abort()
        await expect(packStarter('github:o/r#v1', { exec, signal })).rejects.toBe(signal.reason)
        expect(exec).not.toHaveBeenCalled()
        expect(log).not.toHaveBeenCalled()
    })

    it('removes the temp folder when tar fails', async () => {
        const before = await fs.readdir(os.tmpdir())
        const pack = fakeExec([])
        const exec = (cmd, args, options) => {
            if (cmd === 'tar') throw new Error('tar: Error opening archive')
            return pack(cmd, args, options)
        }
        await expect(packStarter('github:o/r#v1', { exec })).rejects.toThrow('tar: Error opening archive')
        const after = await fs.readdir(os.tmpdir())
        expect(after.filter((n) => n.startsWith('nera-starter-') && !before.includes(n))).toEqual([])
    })

    // The default exec for real: npm (through src/npm.js) packs the local
    // fixture folder, offline, and the system tar unpacks it.
    it('packs and unpacks a local folder with the real npm and tar', async () => {
        const { dir, cleanup } = await packStarter(FIXTURE, { spec: 'minimal' })

        expect(path.basename(dir)).toBe('package')
        expect((await readStarterManifest(dir)).nera.starter.label).toBe('Minimal')
        await cleanup()
        expect(fssync.existsSync(path.dirname(path.dirname(dir)))).toBe(false)
    }, 30000)

    it('says the starter could not be downloaded and leaves no temp folder', async () => {
        const before = await fs.readdir(os.tmpdir())
        const exec = () => {
            const err = new Error('Command failed')
            err.stderr = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@nera-static%2fstarter-nope\n'
            throw err
        }
        await expect(packStarter('@nera-static/starter-nope', { spec: 'nope', exec })).rejects.toThrow(
            /Could not download the starter "nope" \(npm pack @nera-static\/starter-nope failed: 404 Not Found - GET https:\/\/registry\.npmjs\.org\/@nera-static%2fstarter-nope\)\. Check the starter name for typos and your network/,
        )
        const after = await fs.readdir(os.tmpdir())
        expect(after.filter((n) => n.startsWith('nera-starter-') && !before.includes(n))).toEqual([])
    })
})

describe('fetchStarter', () => {
    it('reads a local path in place, relative to cwd', async () => {
        const rel = path.relative(workdir, FIXTURE)
        const spec = rel.startsWith('.') ? rel : `./${rel}`
        const { dir, cleanup } = await fetchStarter(spec, { cwd: workdir })
        expect(dir).toBe(FIXTURE)
        await cleanup()
        expect(fssync.existsSync(FIXTURE)).toBe(true)
    })

    it('says where it looked for a missing local starter', async () => {
        await expect(fetchStarter('./nope', { cwd: workdir })).rejects.toThrow(
            /Starter folder "\.\/nope" not found \(looked in .*nope\)/,
        )
    })

    it('hands package and GitHub specs to pack in npm form', async () => {
        const pack = vi.fn(async () => ({ dir: FIXTURE, cleanup: async () => {} }))
        await fetchStarter('blank', { pack })
        await fetchStarter('https://github.com/o/r.git#main', { pack })
        expect(pack.mock.calls.map((c) => c[0])).toEqual([
            '@nera-static/starter-blank',
            'github:o/r#main',
        ])
    })

    it('passes its log on to pack', async () => {
        const log = () => {}
        const pack = vi.fn(async () => ({ dir: FIXTURE, cleanup: async () => {} }))
        await fetchStarter('blank', { pack, log })
        expect(pack).toHaveBeenCalledWith('@nera-static/starter-blank', { spec: 'blank', log })
    })

    it('passes env and signal on to pack', async () => {
        const env = { PATH: '/shim/bin' }
        const signal = new AbortController().signal
        const pack = vi.fn(async () => ({ dir: FIXTURE, cleanup: async () => {} }))
        await fetchStarter('blank', { pack, env, signal })
        expect(pack.mock.calls[0][1]).toMatchObject({ env, signal })
    })

    it('refuses an aborted signal before reading or downloading anything', async () => {
        const pack = vi.fn()
        const signal = AbortSignal.abort()
        await expect(fetchStarter('blank', { pack, signal })).rejects.toBe(signal.reason)
        expect(pack).not.toHaveBeenCalled()
    })
})

describe('injected log', () => {
    let consoleLog
    beforeEach(() => {
        consoleLog = vi.spyOn(console, 'log')
    })
    afterEach(() => consoleLog.mockRestore())

    it('packStarter writes its message to log, not the console', async () => {
        const lines = []
        const exec = (cmd, args, options) => {
            if (cmd === 'npm') {
                const dest = args[args.indexOf('--pack-destination') + 1]
                fssync.writeFileSync(path.join(dest, 'starter-1.0.0.tgz'), '')
            } else {
                const out = path.resolve(options.cwd, args[args.indexOf('-C') + 1])
                fssync.cpSync(FIXTURE, path.join(out, 'package'), { recursive: true })
            }
        }
        const { cleanup } = await packStarter('github:o/r', { log: (l) => lines.push(l), exec })
        await cleanup()
        expect(lines).toEqual(['📦 Downloading the starter "github:o/r"...'])
        expect(consoleLog).not.toHaveBeenCalled()
    })

    it('applyStarter writes its message to log, not the console', async () => {
        const lines = []
        await fs.writeFile(path.join(workdir, 'package.json'), '{"name":"site"}')
        await applyStarter(workdir, FIXTURE, { log: (l) => lines.push(l) })
        expect(lines).toEqual(['  ✓ Applied the "Minimal" starter (nera-starter-minimal)'])
        expect(consoleLog).not.toHaveBeenCalled()
    })
})

describe('readStarterManifest', () => {
    it('refuses a package without nera.starter', async () => {
        await fs.writeFile(path.join(workdir, 'package.json'), '{"name":"x"}')
        await expect(readStarterManifest(workdir, './x')).rejects.toThrow(
            '"./x" is not a Nera starter: its package.json has no `nera.starter` field.',
        )
    })

    it('refuses a folder without package.json', async () => {
        await expect(readStarterManifest(workdir, './x')).rejects.toThrow(
            /"\.\/x" is not a Nera starter: it has no readable package\.json/,
        )
    })
})

describe('firstStepsSection', () => {
    const README = [
        '# Blog starter',
        '',
        '[![npm version](https://img.shields.io/npm/v/x)](https://www.npmjs.com/package/x)',
        '',
        '## First steps',
        '',
        '1. Edit `config/app.yaml`.',
        '',
        '### Writing posts',
        '',
        'Add a file to `pages/posts/`.',
        '',
        '## License',
        '',
        'MIT',
    ].join('\n')

    it('returns the section without badges or other sections', () => {
        expect(firstStepsSection(README)).toBe(
            '## First steps\n\n1. Edit `config/app.yaml`.\n\n' +
                '### Writing posts\n\nAdd a file to `pages/posts/`.',
        )
    })

    it('runs the last section to the end of the file', () => {
        expect(firstStepsSection('# X\n\n## First steps\n\nRun it.\n\n')).toBe(
            '## First steps\n\nRun it.',
        )
    })

    it('returns null when there is no First steps section', () => {
        expect(firstStepsSection('# X\n\n## Next steps\n\nRun it.\n')).toBeNull()
        expect(firstStepsSection('')).toBeNull()
        expect(firstStepsSection('### First steps\n\nToo deep.\n')).toBeNull()
    })

    it('reads a CRLF README and returns LF', () => {
        expect(firstStepsSection(README.replace(/\n/g, '\r\n'))).toBe(firstStepsSection(README))
    })

    it('ignores headings inside fenced code blocks', () => {
        const readme = [
            '# X',
            '',
            '```markdown',
            '## First steps',
            'not this one',
            '```',
            '',
            '## First steps',
            '',
            '~~~~',
            '## Not an end',
            '~~~',
            'still in the fence',
            '~~~~',
            '',
            'Done.',
            '',
            '## License',
        ].join('\n')
        expect(firstStepsSection(readme)).toBe(
            '## First steps\n\n~~~~\n## Not an end\n~~~\nstill in the fence\n~~~~\n\nDone.',
        )
    })

    it('matches the heading regardless of case and closing hashes', () => {
        expect(firstStepsSection('## First Steps ##\nGo.')).toBe('## First Steps ##\nGo.')
    })
})

describe('listStarters', () => {
    const response = (body, { ok = true, status = 200 } = {}) => ({
        ok,
        status,
        json: async () => body,
    })
    const result = (name, description) => ({ package: { name, version: '1.0.0', description } })
    // What `keywords:<keyword>` returns.
    const registry = (byKeyword) =>
        vi.fn(async (url) => {
            const keyword = new URL(url).searchParams.get('text').replace(/^keywords:/, '')
            return response({ objects: byKeyword[keyword] ?? [] })
        })

    it('asks the registry for keywords nera and nera-starter, with a 3 s timeout each', async () => {
        const fetch = registry({})
        const timeout = vi.spyOn(AbortSignal, 'timeout')
        try {
            expect(await listStarters({ fetch })).toEqual([])
            expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
                'https://registry.npmjs.org/-/v1/search?text=keywords%3Anera&size=250',
                'https://registry.npmjs.org/-/v1/search?text=keywords%3Anera-starter&size=250',
            ])
            for (const [, init] of fetch.mock.calls) expect(init.signal).toBeInstanceOf(AbortSignal)
            expect(timeout.mock.calls).toEqual([[3000], [3000]])
        } finally {
            timeout.mockRestore()
        }
    })

    it('puts official starters first, then sorts by name, offering only names --starter reads back', async () => {
        const fetch = registry({
            nera: [result('@nera-static/starter-blank', 'Blank'), result('@nera-static/plugin-tags', 'Tags')],
            'nera-starter': [
                result('nera-starter-zebra', 'Zebra'),
                result('@acme/starter-shop', 'A shop'),
                result('@nera-static/starter-blog', 'A blog'),
                result('cool-site', 'Not reachable as a --starter spec'),
            ],
        })
        const starters = await listStarters({ fetch })
        expect(starters).toEqual([
            { name: 'blank', package: '@nera-static/starter-blank', description: 'Blank' },
            { name: 'blog', package: '@nera-static/starter-blog', description: 'A blog' },
            { name: '@acme/starter-shop', package: '@acme/starter-shop', description: 'A shop' },
            { name: 'nera-starter-zebra', package: 'nera-starter-zebra', description: 'Zebra' },
        ])
        for (const { name, package: pkg } of starters) expect(starterSource(name).spec).toBe(pkg)
    })

    const bundled = BUNDLED_STARTERS.map(({ name, package: pkg, description }) => ({
        name,
        package: pkg,
        description,
    }))

    it('falls back to the bundled list when fetch throws', async () => {
        const fetch = async () => {
            throw new TypeError('fetch failed')
        }
        expect(await listStarters({ fetch })).toEqual(bundled)
        expect(bundled.map((starter) => starter.package)).toEqual([
            '@nera-static/starter-ansitz',
            '@nera-static/starter-blank',
            '@nera-static/starter-blog',
            '@nera-static/starter-business',
            '@nera-static/starter-portfolio',
            '@nera-static/starter-stack',
            '@nera-static/starter-umwege',
        ])
    })

    it('keeps every bundled starter resolvable by its name, sorted by package', () => {
        for (const { name, package: pkg } of BUNDLED_STARTERS) expect(starterSource(name).spec).toBe(pkg)
        const packages = BUNDLED_STARTERS.map((starter) => starter.package)
        expect(packages).toEqual([...packages].sort())
    })

    it('names the blog starters by what they are for', () => {
        const labels = Object.fromEntries(BUNDLED_STARTERS.map(({ name, label }) => [name, label]))
        expect(labels).toMatchObject({
            blog: 'Blog',
            stack: 'Blog for developers',
            ansitz: 'Photo blog',
            umwege: 'Travel blog',
        })
    })

    it('falls back on a non-200 and on bad JSON', async () => {
        expect(await listStarters({ fetch: async () => response({}, { ok: false, status: 503 }) }))
            .toEqual(bundled)
        expect(await listStarters({ fetch: async () => response({ nope: 1 }) })).toEqual(bundled)
        const badJson = async () => ({ ok: true, json: async () => JSON.parse('{') })
        expect(await listStarters({ fetch: badJson })).toEqual(bundled)
    })
})
