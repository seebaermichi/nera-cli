import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import {
    validateStarterSpec,
    starterSource,
    packStarter,
    fetchStarter,
    readStarterManifest,
    listStarters,
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
                /Invalid starter .*starter name \(blank\).*package name.*GitHub URL.*local path/
            )
        }
    })
})

describe('starterSource', () => {
    it.each([
        ['blank', { kind: 'npm', spec: '@nera-static/starter-blank' }],
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
    // Stands in for `npm pack` + `tar`: writes a tarball name, then
    // "extracts" the fixture to <out>/package.
    const fakeExec = (calls) => (cmd, args) => {
        calls.push([cmd, ...args])
        if (cmd === 'npm') {
            const dest = args[args.indexOf('--pack-destination') + 1]
            fssync.writeFileSync(path.join(dest, 'starter-1.0.0.tgz'), '')
        } else if (cmd === 'tar') {
            const out = args[args.indexOf('-C') + 1]
            fssync.cpSync(FIXTURE, path.join(out, 'package'), { recursive: true })
        }
    }

    it('packs with --ignore-scripts, extracts package/ and cleans up', async () => {
        const calls = []
        const { dir, cleanup } = await packStarter('github:o/r#v1', { exec: fakeExec(calls) })

        expect(calls[0].slice(0, 4)).toEqual(['npm', 'pack', 'github:o/r#v1', '--ignore-scripts'])
        expect(calls[1][0]).toBe('tar')
        expect(calls[1]).toContain('-xzf')
        expect(path.basename(dir)).toBe('package')
        expect((await readStarterManifest(dir)).nera.starter.label).toBe('Minimal')

        const tmp = path.dirname(path.dirname(dir))
        expect(path.dirname(tmp)).toBe(os.tmpdir())
        await cleanup()
        expect(fssync.existsSync(tmp)).toBe(false)
    })

    it('says the starter could not be downloaded and leaves no temp folder', async () => {
        const before = await fs.readdir(os.tmpdir())
        const exec = () => {
            const err = new Error('Command failed')
            err.stderr = 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@nera-static%2fstarter-nope\n'
            throw err
        }
        await expect(packStarter('@nera-static/starter-nope', { spec: 'nope', exec })).rejects.toThrow(
            /Could not download the starter "nope" \(npm pack @nera-static\/starter-nope failed: 404 Not Found - GET https:\/\/registry\.npmjs\.org\/@nera-static%2fstarter-nope\)\. Check the starter name for typos and your network/
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
            /Starter folder "\.\/nope" not found \(looked in .*nope\)/
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
})

describe('readStarterManifest', () => {
    it('refuses a package without nera.starter', async () => {
        await fs.writeFile(path.join(workdir, 'package.json'), '{"name":"x"}')
        await expect(readStarterManifest(workdir, './x')).rejects.toThrow(
            '"./x" is not a Nera starter: its package.json has no `nera.starter` field.'
        )
    })

    it('refuses a folder without package.json', async () => {
        await expect(readStarterManifest(workdir, './x')).rejects.toThrow(
            /"\.\/x" is not a Nera starter: it has no readable package\.json/
        )
    })
})

describe('listStarters', () => {
    const response = (body, { ok = true, status = 200 } = {}) => ({
        ok,
        status,
        json: async () => body,
    })
    const result = (name, description) => ({ package: { name, description } })

    it('asks the registry for keyword nera-starter, with a timeout', async () => {
        const fetch = vi.fn(async () => response({ objects: [] }))
        expect(await listStarters({ fetch })).toEqual([])
        const [url, init] = fetch.mock.calls[0]
        expect(url).toBe('https://registry.npmjs.org/-/v1/search?text=keywords:nera-starter&size=50')
        expect(init.signal).toBeInstanceOf(AbortSignal)
    })

    it('puts official starters first, then sorts by name', async () => {
        const fetch = async () =>
            response({
                objects: [
                    result('nera-starter-zebra', 'Zebra'),
                    result('@acme/starter-shop', 'A shop'),
                    result('@nera-static/starter-blog', 'A blog'),
                    result('@nera-static/starter-blank', 'Blank'),
                    result('cool-site', 'Not reachable as a --starter spec'),
                ],
            })
        expect(await listStarters({ fetch })).toEqual([
            { name: 'blank', package: '@nera-static/starter-blank', description: 'Blank' },
            { name: 'blog', package: '@nera-static/starter-blog', description: 'A blog' },
            { name: '@acme/starter-shop', package: '@acme/starter-shop', description: 'A shop' },
            { name: 'nera-starter-zebra', package: 'nera-starter-zebra', description: 'Zebra' },
        ])
    })

    const bundled = BUNDLED_STARTERS.map(({ name, package: pkg, label, description }) => ({
        name,
        package: pkg,
        description: `${label}: ${description}`,
    }))

    it('falls back to the bundled list when fetch throws', async () => {
        const fetch = async () => {
            throw new TypeError('fetch failed')
        }
        expect(await listStarters({ fetch })).toEqual(bundled)
        expect(bundled[0].package).toBe('@nera-static/starter-blank')
    })

    it('falls back on a non-200 and on bad JSON', async () => {
        expect(await listStarters({ fetch: async () => response({}, { ok: false, status: 503 }) }))
            .toEqual(bundled)
        expect(await listStarters({ fetch: async () => response({ nope: 1 }) })).toEqual(bundled)
        const badJson = async () => ({ ok: true, json: async () => JSON.parse('{') })
        expect(await listStarters({ fetch: badJson })).toEqual(bundled)
    })
})
