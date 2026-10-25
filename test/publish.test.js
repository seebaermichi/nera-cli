import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { parsePublishArgs, runPublish, REVOKE_URL } from '../src/commands/publish.js'
import { assertAdapter, createRegistry, TARGETS } from '../src/publish/targets.js'
import {
    readPublishConfig,
    writePublishConfig,
    publishConfigFile,
} from '../src/publish/site-config.js'

// The `nera publish` contract (ROADMAP-ai.md L6): flags, the TTY rule, the
// target registry, config/publish.yaml and the --json object. The pipeline is
// a fake throughout; no test touches the network, the keychain or a token.

// Resolved from this file, so the test passes whatever vitest's cwd is.
const CLI = fileURLToPath(new URL('../bin/nera.js', import.meta.url))

// A complete adapter with the given id; the methods are never called here.
const fakeAdapter = (id = 'fake-host', overrides = {}) => ({
    id,
    label: 'Fake Host',
    setUp: async () => {},
    deployJob: () => ({}),
    liveUrl: () => `https://${id}.example`,
    ...overrides,
})

const tty = { isTTY: true }
const pipe = { isTTY: false }

let site, stdout, log, error

beforeEach(async () => {
    site = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-publish-'))
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    log = vi.spyOn(console, 'log').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
    stdout.mockRestore()
    log.mockRestore()
    error.mockRestore()
    await fs.rm(site, { recursive: true, force: true })
})

// Everything written to stdout, parsed as one JSON document.
const printedJson = () => JSON.parse(stdout.mock.calls.map(([chunk]) => String(chunk)).join(''))
const logged = () => log.mock.calls.flat().join('\n')

// runPublish over the temp site with a fake registry and pipeline; the
// pipeline records the context it was called with.
function publishWith(args, overrides = {}) {
    const calls = []
    const publish = async (ctx) => {
        calls.push(ctx)
        return { url: 'https://fake-host.example', repository: 'me/site' }
    }
    const result = runPublish(args, {
        cwd: site,
        stdin: pipe,
        stdout: pipe,
        env: {},
        targets: createRegistry([fakeAdapter()]),
        publish,
        ...overrides,
    })
    return { result, calls }
}

describe('parsePublishArgs', () => {
    it('defaults: every switch off, no values', () => {
        expect(parsePublishArgs([])).toEqual({ private: false, yes: false, json: false, signOut: false })
    })

    it('reads every flag, values as `--opt v` and `--opt=v`', () => {
        expect(parsePublishArgs([
            '--target', 'github-pages', '--repo=my-site', '--private', '--yes', '--json', '--sign-out',
        ])).toEqual({
            target: 'github-pages',
            repo: 'my-site',
            private: true,
            yes: true,
            json: true,
            signOut: true,
        })
    })

    it('a value option without a value is an error', () => {
        expect(() => parsePublishArgs(['--target'])).toThrow('--target needs a value')
        expect(() => parsePublishArgs(['--repo='])).toThrow('--repo needs a value')
        expect(() => parsePublishArgs(['--repo', '--yes'])).toThrow('--repo needs a value')
    })

    it('an unknown flag or a stray argument is an error', () => {
        expect(() => parsePublishArgs(['--repos', 'x'])).toThrow('Unknown argument for nera publish: --repos')
        expect(() => parsePublishArgs(['my-site'])).toThrow('Unknown argument for nera publish: my-site')
        expect(() => parsePublishArgs(['--yes=1'])).toThrow('Unknown argument')
    })
})

describe('target registry', () => {
    it('registers no real target yet', () => {
        expect(TARGETS).toEqual([])
        expect(createRegistry().ids()).toEqual([])
    })

    it('resolves a registered adapter by id', () => {
        const a = fakeAdapter('a-host')
        const registry = createRegistry([a, fakeAdapter('b-host')])
        expect(registry.ids()).toEqual(['a-host', 'b-host'])
        expect(registry.resolve('a-host')).toBe(a)
    })

    it('an unknown or missing id names the registered ids', () => {
        const registry = createRegistry([fakeAdapter('a-host'), fakeAdapter('b-host')])
        expect(() => registry.resolve('nope')).toThrow(
            'Unknown publish target "nope". Available targets: a-host, b-host.'
        )
        expect(() => registry.resolve(undefined)).toThrow(
            'Name a target with --target <id>. Available targets: a-host, b-host.'
        )
    })

    it('with nothing registered, says so', () => {
        expect(() => createRegistry([]).resolve('github-pages')).toThrow(
            'No publish target is available in this version of Nera yet.'
        )
    })

    it('rejects an adapter without the interface, naming what is missing', () => {
        expect(() => assertAdapter(null)).toThrow('must be an object')
        expect(() => assertAdapter(fakeAdapter('Bad Id'))).toThrow('lowercase letters')
        expect(() => assertAdapter(fakeAdapter('x', { label: '' }))).toThrow('"x" needs a label')
        for (const method of ['setUp', 'deployJob', 'liveUrl']) {
            expect(() => assertAdapter(fakeAdapter('x', { [method]: undefined }))).toThrow(
                `"x" needs a ${method}() function`
            )
        }
    })

    it('rejects an id registered twice', () => {
        expect(() => createRegistry([fakeAdapter('x'), fakeAdapter('x')])).toThrow('registered twice')
    })
})

describe('config/publish.yaml', () => {
    it('a missing or empty file reads as {}', async () => {
        expect(await readPublishConfig(site)).toEqual({})
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), '')
        expect(await readPublishConfig(site)).toEqual({})
    })

    it('writes the file and reads back target and repository', async () => {
        expect(await writePublishConfig({ target: 'fake-host' }, site)).toEqual({ target: 'fake-host' })
        expect(await writePublishConfig({ repository: 'me/site' }, site)).toEqual({
            target: 'fake-host',
            repository: 'me/site',
        })
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe(
            'target: fake-host\nrepository: me/site\n'
        )
    })

    it('keeps comments and unknown keys when writing', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), '# where the site goes\ntarget: a-host\nextra: 1\n')
        await writePublishConfig({ target: 'b-host' }, site)
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe(
            '# where the site goes\ntarget: b-host\nextra: 1\n'
        )
    })

    it('writes into a file that holds only a comment, keeping it', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), '# only a comment\n')
        expect(await writePublishConfig({ target: 'a-host' }, site)).toEqual({ target: 'a-host' })
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe('# only a comment\n\ntarget: a-host\n')
    })

    it('refuses an unknown key or an empty value', async () => {
        await expect(writePublishConfig({ token: 'x' }, site)).rejects.toThrow('Unknown config/publish.yaml key "token"')
        await expect(writePublishConfig({ target: '' }, site)).rejects.toThrow('non-empty string')
    })

    it('invalid YAML, a non-mapping or a non-text value is an error naming the file', async () => {
        await fs.mkdir(path.join(site, 'config'))
        const cases = [
            ['target: [unclosed\n', 'is not valid YAML'],
            ['- a\n- b\n', 'must be a mapping'],
            ['target: 3\n', '"target" must be a text value'],
        ]
        for (const [text, message] of cases) {
            await fs.writeFile(publishConfigFile(site), text)
            await expect(readPublishConfig(site)).rejects.toThrow('config/publish.yaml')
            await expect(readPublishConfig(site)).rejects.toThrow(message)
        }
    })
})

describe('runPublish', () => {
    it('resolves --target and hands the pipeline its context; exit 0, live URL printed', async () => {
        const { result, calls } = publishWith(['--target', 'fake-host', '--repo', 'my-site'])
        expect(await result).toBe(0)
        expect(calls).toHaveLength(1)
        const [ctx] = calls
        expect(ctx.cwd).toBe(site)
        expect(ctx.adapter.id).toBe('fake-host')
        expect(ctx.options.repo).toBe('my-site')
        expect(ctx.config).toEqual({})
        expect(logged()).toContain('Live at https://fake-host.example')
    })

    it('without --target, uses the target from config/publish.yaml', async () => {
        await writePublishConfig({ target: 'fake-host', repository: 'me/site' }, site)
        const { result, calls } = publishWith([])
        expect(await result).toBe(0)
        expect(calls[0].adapter.id).toBe('fake-host')
        expect(calls[0].config).toEqual({ target: 'fake-host', repository: 'me/site' })
    })

    it('an unknown target fails before the pipeline runs, naming the registered ids', async () => {
        const { result, calls } = publishWith(['--target', 'nope'])
        await expect(result).rejects.toThrow('Unknown publish target "nope". Available targets: fake-host.')
        expect(calls).toHaveLength(0)
    })

    it('no target anywhere: asks for --target', async () => {
        const { result } = publishWith([])
        await expect(result).rejects.toThrow('Name a target with --target <id>')
    })

    it('the default pipeline stops with a clear message', async () => {
        const result = runPublish(['--target', 'fake-host'], {
            cwd: site,
            targets: createRegistry([fakeAdapter()]),
        })
        await expect(result).rejects.toThrow('Publishing to Fake Host is not available in this version of Nera yet.')
    })

    describe('the TTY rule: interactive only on a terminal without --yes or --json', () => {
        const cases = [
            ['terminal', [], tty, tty, true],
            ['terminal with --yes', ['--yes'], tty, tty, false],
            ['terminal with --json', ['--json'], tty, tty, false],
            ['stdin piped', [], pipe, tty, false],
            ['stdout piped', [], tty, pipe, false],
        ]
        for (const [name, extra, stdin, out, expected] of cases) {
            it(`${name} → interactive ${expected}`, async () => {
                const { result, calls } = publishWith(['--target', 'fake-host', ...extra], {
                    stdin,
                    stdout: out,
                })
                await result
                expect(calls[0].interactive).toBe(expected)
            })
        }
    })

    describe('--sign-out', () => {
        it('deletes the stored token and says revoking is done on GitHub', async () => {
            const deleteToken = vi.fn(async () => true)
            const { result, calls } = publishWith(['--sign-out'], { deleteToken })
            expect(await result).toBe(0)
            expect(deleteToken).toHaveBeenCalledOnce()
            expect(calls).toHaveLength(0)
            expect(logged()).toContain('the GitHub token stored on this computer was removed')
            expect(logged()).toContain(REVOKE_URL)
        })

        it('with nothing stored, says so; a set NERA_GITHUB_TOKEN is named', async () => {
            const { result } = publishWith(['--sign-out'], {
                deleteToken: async () => false,
                env: { NERA_GITHUB_TOKEN: 'ghu_fake_env' },
            })
            expect(await result).toBe(0)
            expect(logged()).toContain('No GitHub token was stored on this computer.')
            expect(logged()).toContain('NERA_GITHUB_TOKEN is still set')
            expect(logged()).not.toContain('ghu_fake_env')
        })

        it('needs no target and ignores a broken config/publish.yaml', async () => {
            await fs.mkdir(path.join(site, 'config'))
            await fs.writeFile(publishConfigFile(site), '- not a mapping\n')
            const { result } = publishWith(['--sign-out'], {
                targets: createRegistry([]),
                deleteToken: async () => true,
            })
            expect(await result).toBe(0)
        })
    })

    describe('--json', () => {
        it('success: one { ok, url, repository } object on stdout, exit 0, logs on stderr', async () => {
            const { result } = publishWith(['--target', 'fake-host', '--json'], {
                publish: async () => {
                    console.log('a progress line')
                    return { url: 'https://fake-host.example', repository: 'me/site' }
                },
            })
            expect(await result).toBe(0)
            expect(printedJson()).toEqual({ ok: true, url: 'https://fake-host.example', repository: 'me/site' })
            expect(log).not.toHaveBeenCalled()
            expect(error.mock.calls.flat()).toContain('a progress line')
        })

        it('failure: { ok: false, error }, exit 1, the same code as text mode', async () => {
            const { result } = publishWith(['--target', 'nope', '--json'])
            expect(await result).toBe(1)
            expect(printedJson()).toEqual({
                ok: false,
                error: 'Unknown publish target "nope". Available targets: fake-host.',
            })
        })

        it('a bad flag is reported in the object too', async () => {
            const { result } = publishWith(['--json', '--repos', 'x'])
            expect(await result).toBe(1)
            expect(printedJson()).toEqual({ ok: false, error: 'Unknown argument for nera publish: --repos' })
        })

        it('--sign-out: { ok: true, signedOut }, the messages on stderr', async () => {
            const { result } = publishWith(['--sign-out', '--json'], { deleteToken: async () => true })
            expect(await result).toBe(0)
            expect(printedJson()).toEqual({ ok: true, signedOut: true })
            expect(error.mock.calls.flat().join('\n')).toContain(REVOKE_URL)
        })
    })
})

describe('bin/nera.js publish, as a child process', () => {
    const cli = (args) =>
        spawnSync(process.execPath, [CLI, ...args], {
            cwd: site,
            encoding: 'utf-8',
            env: { ...process.env, NERA_GITHUB_TOKEN: '' },
        })

    it('is dispatched, but not in the usage text yet', () => {
        const help = cli([])
        expect(help.status).toBe(0)
        expect(help.stdout).not.toContain('nera publish')

        const text = cli(['publish'])
        expect(text.status).toBe(1)
        expect(text.stderr).toContain('❌ Name a target with --target <id>.')
        expect(text.stderr).toContain('No publish target is available in this version of Nera yet.')
    })

    it('--json: the whole stdout is one object, exit 1 as in text mode, no ❌ line', () => {
        const child = cli(['publish', '--json'])
        expect(child.status).toBe(1)
        expect(JSON.parse(child.stdout)).toEqual({
            ok: false,
            error: 'Name a target with --target <id>. No publish target is available in this version of Nera yet.',
        })
        expect(child.stderr).not.toContain('❌')
    })
})
