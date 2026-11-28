import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { writeFiles } from '@nera-static/test-utils'
import { parsePublishArgs, runPublish, publishSite, REVOKE_URL, NETLIFY_REVOKE_URL } from '../src/commands/publish.js'
import { assertAdapter, createRegistry, TARGETS } from '../src/publish/targets.js'
import {
    readPublishConfig,
    writePublishConfig,
    publishConfigFile,
} from '../src/publish/site-config.js'
import { GITHUB_API } from '../src/publish/github.js'
import { githubPages } from '../src/publish/pages.js'
import { netlify } from '../src/publish/netlify.js'
import { PUBLISH_STATE } from '../src/publish/commit.js'
import { WORKFLOW_PATH } from '../src/publish/status.js'
import { BUILD_STEPS, GENERATED_HEADER } from '../src/publish/workflow.js'
import { FAKE_TOKEN, fakeGitData, fakeGitHub, jsonResponse } from './helpers/fake-github.js'
import { fakeResolver } from './helpers/fake-dns.js'
import { fakeNetlify } from './helpers/fake-netlify.js'
import { NETLIFY_API } from '../src/publish/netlify-api.js'
import { DEVICE_PAGE, GITHUB_SIGN_IN } from '../src/publish/auth.js'
import { INSTALL_PAGE, GITHUB_APP_INSTALL } from '../src/publish/repository.js'
import { NETLIFY_CLIENT_ID, NETLIFY_SIGN_IN, authorizeUrl } from '../src/publish/netlify-auth.js'

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
            '--target', 'github-pages', '--repo=my-site', '--domain', 'Example.com', '--private', '--yes', '--json', '--sign-out',
        ])).toEqual({
            target: 'github-pages',
            repo: 'my-site',
            domain: 'example.com',
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
        expect(() => parsePublishArgs(['--domain'])).toThrow('--domain needs a value')
        expect(() => parsePublishArgs(['--domain='])).toThrow('--domain needs a value')
    })

    it('--domain is normalized while parsing, so a bad host fails before anything else', () => {
        expect(parsePublishArgs(['--domain=WWW.Example.com.']).domain).toBe('www.example.com')
        expect(() => parsePublishArgs(['--domain', 'https://x.de'])).toThrow('without the scheme')
    })

    it('an unknown flag or a stray argument is an error', () => {
        expect(() => parsePublishArgs(['--repos', 'x'])).toThrow('Unknown argument for nera publish: --repos')
        expect(() => parsePublishArgs(['my-site'])).toThrow('Unknown argument for nera publish: my-site')
        expect(() => parsePublishArgs(['--yes=1'])).toThrow('Unknown argument')
    })
})

describe('target registry', () => {
    it('registers GitHub Pages, the default when no target is named, then Netlify', () => {
        expect(TARGETS).toEqual([githubPages, netlify])
        expect(createRegistry().ids()).toEqual(['github-pages', 'netlify'])
        expect(createRegistry().resolve('github-pages')).toBe(githubPages)
        expect(createRegistry().resolve('netlify')).toBe(netlify)
        expect(createRegistry().resolve(undefined)).toBe(githubPages)
        expect(createRegistry().resolve('')).toBe(githubPages)
    })

    it('resolves a registered adapter by id', () => {
        const a = fakeAdapter('a-host')
        const registry = createRegistry([a, fakeAdapter('b-host')])
        expect(registry.ids()).toEqual(['a-host', 'b-host'])
        expect(registry.resolve('a-host')).toBe(a)
    })

    it('an unknown id names the registered ids', () => {
        const registry = createRegistry([fakeAdapter('a-host'), fakeAdapter('b-host')])
        expect(() => registry.resolve('nope')).toThrow(
            'Unknown publish target "nope". Available targets: a-host, b-host.',
        )
    })

    it('a missing or empty id resolves the first registered adapter', () => {
        const a = fakeAdapter('a-host')
        const registry = createRegistry([a, fakeAdapter('b-host')])
        expect(registry.resolve(undefined)).toBe(a)
        expect(registry.resolve('')).toBe(a)
    })

    it('with nothing registered, says so', () => {
        expect(() => createRegistry([]).resolve('github-pages')).toThrow(
            'No publish target is available in this version of Nera yet.',
        )
        expect(() => createRegistry([]).resolve(undefined)).toThrow(
            'Name a target with --target <id>. No publish target is available in this version of Nera yet.',
        )
    })

    it('rejects an adapter without the interface, naming what is missing', () => {
        expect(() => assertAdapter(null)).toThrow('must be an object')
        expect(() => assertAdapter([fakeAdapter('x')])).toThrow('must be an object')
        expect(() => assertAdapter(fakeAdapter('Bad Id'))).toThrow('lowercase letters')
        expect(() => assertAdapter(fakeAdapter('x', { label: '' }))).toThrow('"x" needs a label')
        for (const method of ['setUp', 'deployJob', 'liveUrl']) {
            expect(() => assertAdapter(fakeAdapter('x', { [method]: undefined }))).toThrow(
                `"x" needs a ${method}() function`,
            )
        }
    })

    it('accepts an optional leftBehind() function and refuses one that is not a function', () => {
        const leftBehind = () => []
        expect(assertAdapter(fakeAdapter('x', { leftBehind })).leftBehind).toBe(leftBehind)
        expect(() => assertAdapter(fakeAdapter('x', { leftBehind: ['a line'] }))).toThrow(
            'Publish target "x": leftBehind must be a function when it is set',
        )
    })

    it('accepts an optional uploadStep and refuses one that is not a step object or names itself', () => {
        const uploadStep = { uses: 'actions/upload-pages-artifact@v5', with: { path: 'public' } }
        expect(assertAdapter(fakeAdapter('x', { uploadStep })).uploadStep).toBe(uploadStep)
        expect(() => assertAdapter(fakeAdapter('x', { uploadStep: 'actions/upload-pages-artifact@v5' }))).toThrow(
            'Publish target "x": uploadStep must be a step object with uses when it is set',
        )
        expect(() => assertAdapter(fakeAdapter('x', { uploadStep: { name: 'Upload', ...uploadStep } }))).toThrow(
            'Publish target "x" must not set uploadStep.name; the workflow names it',
        )
    })

    it('accepts an optional summary and refuses one that is not a non-empty string', () => {
        expect(assertAdapter(fakeAdapter('x', { summary: 'for a blog' })).summary).toBe('for a blog')
        for (const summary of ['', 3]) {
            expect(() => assertAdapter(fakeAdapter('x', { summary }))).toThrow(
                'Publish target "x": summary must be a non-empty string when it is set',
            )
        }
    })

    it('both real targets say what they suit: GitHub Pages not for a business, Netlify for one', () => {
        const [pages, netlify] = TARGETS
        expect(pages.summary).toMatch(/not for running a business/)
        expect(netlify.summary).toMatch(/business sites/)
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
            'target: fake-host\nrepository: me/site\n',
        )
    })

    it('keeps comments and unknown keys when writing', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), '# where the site goes\ntarget: a-host\nextra: 1\n')
        await writePublishConfig({ target: 'b-host' }, site)
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe(
            '# where the site goes\ntarget: b-host\nextra: 1\n',
        )
    })

    it('writes into a file that holds only a comment, keeping it', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), '# only a comment\n')
        expect(await writePublishConfig({ target: 'a-host' }, site)).toEqual({ target: 'a-host' })
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe('# only a comment\n\ntarget: a-host\n')
    })

    it('writes and reads the netlify section, keeping its other keys', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), 'target: netlify\nnetlify:\n    note: mine\n')
        expect(await writePublishConfig({ netlify: { site_id: 'abc-123' } }, site)).toEqual({
            target: 'netlify',
            netlify: { site_id: 'abc-123' },
        })
        expect(await fs.readFile(publishConfigFile(site), 'utf-8')).toBe(
            'target: netlify\nnetlify:\n    note: mine\n    site_id: abc-123\n',
        )
        await fs.writeFile(publishConfigFile(site), 'netlify:\n')
        expect(await writePublishConfig({ netlify: { site_id: 'def' } }, site)).toEqual({ netlify: { site_id: 'def' } })
    })

    it('a netlify section that is not a mapping, or a site_id that is not text, is an error', async () => {
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(publishConfigFile(site), 'netlify: abc\n')
        await expect(readPublishConfig(site)).rejects.toThrow('config/publish.yaml: "netlify" must be a mapping')
        await expect(writePublishConfig({ netlify: { site_id: 'x' } }, site)).rejects.toThrow('"netlify" must be a mapping')
        await fs.writeFile(publishConfigFile(site), 'netlify:\n    site_id: 3\n')
        await expect(readPublishConfig(site)).rejects.toThrow('"netlify.site_id" must be a text value')
        await expect(writePublishConfig({ netlify: { token: 'x' } }, site)).rejects.toThrow('Unknown config/publish.yaml key "netlify.token"')
        await expect(writePublishConfig({ netlify: { site_id: '' } }, site)).rejects.toThrow('non-empty string')
        await expect(writePublishConfig({ netlify: 'x' }, site)).rejects.toThrow('"netlify" must be a mapping')
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
    const twoHosts = () => createRegistry([fakeAdapter('a-host'), fakeAdapter('b-host')])

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

    it('an invalid --domain fails before the target lookup and the pipeline', async () => {
        const { result, calls } = publishWith(['--target', 'nope', '--domain', 'https://x.de'])
        await expect(result).rejects.toThrow('--domain "https://x.de": pass the host name without the scheme')
        expect(calls).toHaveLength(0)
    })

    it('no target anywhere: the first registered target, the default', async () => {
        const { result, calls } = publishWith([], { targets: createRegistry([fakeAdapter('a-host'), fakeAdapter('b-host')]) })
        expect(await result).toBe(0)
        expect(calls[0].adapter.id).toBe('a-host')
    })

    describe('the target question (D1): only on a terminal, with a choice, and no target named', () => {
        it('asks on a terminal without --target and config target, and uses the answer', async () => {
            const pickTarget = vi.fn(async () => 'b-host')
            const { result, calls } = publishWith([], { stdin: tty, stdout: tty, targets: twoHosts(), pickTarget })
            expect(await result).toBe(0)
            expect(pickTarget).toHaveBeenCalledOnce()
            const [{ input, output, targets }] = pickTarget.mock.calls[0]
            expect(input).toBe(tty)
            expect(output).toBe(tty)
            expect(targets.map((t) => t.id)).toEqual(['a-host', 'b-host'])
            expect(calls[0].adapter.id).toBe('b-host')
            expect(calls[0].interactive).toBe(true)
            expect(calls[0].previous).toBeUndefined()
        })

        // [name, args, stdin, stdout, config/publish.yaml target, the target used]
        const noAsk = [
            ['--yes', ['--yes'], tty, tty, undefined, 'a-host'],
            ['--json', ['--json'], tty, tty, undefined, 'a-host'],
            ['no terminal', [], pipe, pipe, undefined, 'a-host'],
            ['stdin piped', [], pipe, tty, undefined, 'a-host'],
            ['--target', ['--target', 'b-host'], tty, tty, undefined, 'b-host'],
            ['a target in config/publish.yaml', [], tty, tty, 'b-host', 'b-host'],
        ]
        for (const [name, args, stdin, out, target, used] of noAsk) {
            it(`never asks with ${name}`, async () => {
                if (target) await writePublishConfig({ target }, site)
                const pickTarget = vi.fn(async () => 'b-host')
                const { result, calls } = publishWith(args, { stdin, stdout: out, targets: twoHosts(), pickTarget })
                await result
                expect(pickTarget).not.toHaveBeenCalled()
                expect(calls[0].adapter.id).toBe(used)
            })
        }

        it('never asks when only one target is registered', async () => {
            const pickTarget = vi.fn(async () => 'fake-host')
            const { result, calls } = publishWith([], { stdin: tty, stdout: tty, pickTarget })
            expect(await result).toBe(0)
            expect(pickTarget).not.toHaveBeenCalled()
            expect(calls[0].adapter.id).toBe('fake-host')
        })

        it('Ctrl-C at the question: the pipeline never runs, nothing is written', async () => {
            const pickTarget = vi.fn(async () => {
                throw new Error('Cancelled — nothing was published.')
            })
            const { result, calls } = publishWith([], { stdin: tty, stdout: tty, targets: twoHosts(), pickTarget })
            await expect(result).rejects.toThrow('Cancelled — nothing was published.')
            expect(calls).toHaveLength(0)
            await expect(fs.readdir(site)).resolves.toEqual([])
        })
    })

    describe('a move (D4): config/publish.yaml names another registered target', () => {
        it('--target <other> hands the pipeline the old adapter as previous', async () => {
            await writePublishConfig({ target: 'a-host' }, site)
            const { result, calls } = publishWith(['--target', 'b-host'], { targets: twoHosts() })
            expect(await result).toBe(0)
            expect(calls[0].adapter.id).toBe('b-host')
            expect(calls[0].previous.id).toBe('a-host')
        })

        it('the same target, or no target recorded, is no move', async () => {
            const same = publishWith(['--target', 'a-host'], { targets: twoHosts() })
            await same.result
            expect(same.calls[0].previous).toBeUndefined()

            await writePublishConfig({ target: 'a-host' }, site)
            const again = publishWith(['--target', 'a-host'], { targets: twoHosts() })
            await again.result
            expect(again.calls[0].previous).toBeUndefined()
        })

        it('an old target this version does not know is only a switch, no move', async () => {
            await writePublishConfig({ target: 'gone-host' }, site)
            const { result, calls } = publishWith(['--target', 'b-host'], { targets: twoHosts() })
            expect(await result).toBe(0)
            expect(calls[0].adapter.id).toBe('b-host')
            expect(calls[0].previous).toBeUndefined()
        })
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
        it('deletes the stored GitHub and Netlify tokens and says revoking is done on each host', async () => {
            const deleteToken = vi.fn(async () => true)
            const { result, calls } = publishWith(['--sign-out'], { deleteToken })
            expect(await result).toBe(0)
            expect(deleteToken.mock.calls).toEqual([[{ account: 'github' }], [{ account: 'netlify' }]])
            expect(calls).toHaveLength(0)
            expect(logged()).toContain('the GitHub token stored on this computer was removed')
            expect(logged()).toContain(REVOKE_URL)
            expect(logged()).toContain('the Netlify token stored on this computer was removed')
            expect(logged()).toContain(NETLIFY_REVOKE_URL)
        })

        it('a Netlify token alone: GitHub had none, the Netlify one is removed', async () => {
            const { result } = publishWith(['--sign-out', '--json'], {
                deleteToken: async ({ account }) => account === 'netlify',
            })
            expect(await result).toBe(0)
            expect(printedJson()).toEqual({ ok: true, signedOut: true, removed: ['netlify'] })
            const messages = error.mock.calls.flat().join('\n')
            expect(messages).toContain('No GitHub token was stored on this computer.')
            expect(messages).toContain(NETLIFY_REVOKE_URL)
        })

        it('with nothing stored, says so; a set NERA_GITHUB_TOKEN or NERA_NETLIFY_TOKEN is named', async () => {
            const { result } = publishWith(['--sign-out'], {
                deleteToken: async () => false,
                env: { NERA_GITHUB_TOKEN: 'ghu_fake_env', NERA_NETLIFY_TOKEN: 'nfp_fake_env' },
            })
            expect(await result).toBe(0)
            expect(logged()).toContain('No GitHub token was stored on this computer.')
            expect(logged()).toContain('No Netlify token was stored on this computer.')
            expect(logged()).not.toContain(NETLIFY_REVOKE_URL)
            expect(logged()).toContain('NERA_GITHUB_TOKEN is still set')
            expect(logged()).toContain('NERA_NETLIFY_TOKEN is still set')
            expect(logged()).not.toContain('ghu_fake_env')
            expect(logged()).not.toContain('nfp_fake_env')
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
            expect(printedJson()).toEqual({ ok: true, signedOut: true, removed: ['github', 'netlify'] })
            expect(error.mock.calls.flat().join('\n')).toContain(REVOKE_URL)
        })
    })
})

// A fake GitHub for the whole pipeline: the account, the app's installation,
// repository creation, the Git Data API (helpers/fake-github.js) and an
// Actions API that starts one run of the deploy workflow for every new head
// of main. `conclusion` is what that run ends with; `events` records the
// GitHub side of the D5 order next to the adapter's calls.
const OWNER = 'octo'
const REPO = 'my-site'
const REPOSITORY = `${OWNER}/${REPO}`
const TOKEN = FAKE_TOKEN

function pipelineGitHub({ conclusion = 'success' } = {}) {
    const git = fakeGitData({ repository: REPOSITORY, token: TOKEN })
    const events = []
    const runs = []
    let created = false
    let nextRun = 100
    // The repository's Pages site, once the github-pages adapter enabled it.
    let pages = null
    // The repository's Actions secrets as sent: { NAME: { encrypted_value, key_id } }.
    const secrets = {}
    const repoObject = () => ({
        full_name: REPOSITORY,
        owner: { login: OWNER },
        name: REPO,
        private: false,
        default_branch: 'main',
        html_url: `https://github.com/${REPOSITORY}`,
    })
    const notFound = [404, { message: 'Not Found' }]
    // A queued run for a head that has none yet, completed one poll later.
    const startRun = () => {
        if (!git.refs.main || runs.some((run) => run.head_sha === git.refs.main)) return
        const id = nextRun++
        runs.push({
            id,
            head_sha: git.refs.main,
            path: WORKFLOW_PATH,
            status: 'queued',
            conclusion: null,
            html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
        })
    }

    const routes = {
        'GET /user': () => [200, { login: OWNER, id: 4242 }],
        'GET /user/installations?per_page=100': () => {
            events.push('installation')
            return [200, { installations: [{ id: 1, app_slug: 'nera-static', account: { login: OWNER } }] }]
        },
        [`GET /repos/${REPOSITORY}`]: () => (created ? [200, repoObject()] : notFound),
        'POST /user/repos': () => {
            events.push('create repository')
            created = true
            git.autoInit()
            return [201, repoObject()]
        },
        [`GET /repos/${REPOSITORY}/pages`]: () => (pages ? [200, pages] : notFound),
        [`POST /repos/${REPOSITORY}/pages`]: (body) => {
            events.push('enable pages')
            pages = { html_url: `https://${OWNER}.github.io/${REPO}/`, build_type: body.build_type, cname: null }
            return [201, pages]
        },
        [`PUT /repos/${REPOSITORY}/pages`]: (body) => {
            if (body.https_enforced !== undefined) {
                events.push(`enforce https ${body.https_enforced}`)
                Object.assign(pages, { https_enforced: body.https_enforced })
                return [204]
            }
            events.push(`set domain ${body.cname}`)
            // GitHub reports http until the certificate for the domain is issued.
            Object.assign(pages, { cname: body.cname, html_url: `http://${body.cname}/` })
            return [204]
        },
        [`GET /repos/${REPOSITORY}/actions/secrets/public-key`]: () => [200, {
            key_id: 'fake-key-id',
            key: Buffer.alloc(32, 9).toString('base64'),
        }],
    }

    // The routes with a pattern, then the Git Data API.
    const fallback = async (url, init) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        const secret = route.match(/^PUT \/repos\/[^/]+\/[^/]+\/actions\/secrets\/([A-Z_]+)$/)
        if (secret) {
            events.push(`store secret ${secret[1]}`)
            secrets[secret[1]] = JSON.parse(init.body)
            return jsonResponse(201)
        }
        if (route.startsWith(`GET /repos/${REPOSITORY}/actions/runs?`)) {
            events.push('poll run')
            for (const run of runs) {
                if (run.status === 'queued') run.status = 'in_progress'
                else if (run.status === 'in_progress') Object.assign(run, { status: 'completed', conclusion })
            }
            startRun()
            // GitHub's own head_sha filter, so a wrong sha finds nothing.
            const sha = new URL(url).searchParams.get('head_sha')
            const found = runs.filter((run) => run.head_sha === sha).map((run) => ({ ...run }))
            return jsonResponse(200, { workflow_runs: found })
        }
        const jobs = route.match(/\/actions\/runs\/(\d+)\/jobs/)
        if (jobs) {
            const steps = [{ name: BUILD_STEPS.render, conclusion: 'failure' }]
            return jsonResponse(200, { jobs: [{ id: Number(jobs[1]) * 10, name: 'build', conclusion: 'failure', steps }] })
        }
        if (/\/actions\/jobs\/\d+\/logs$/.test(route)) {
            const log = '2026-10-26T10:00:01.0000000Z ##[error]Layout "post.pug" not found\n'
            return { ok: true, status: 200, statusText: 'OK', text: async () => log }
        }
        if (route === `PATCH /repos/${REPOSITORY}/git/refs/heads/main`) events.push('push')
        return git.fetch(url, init)
    }
    const { fetch } = fakeGitHub(routes, { token: TOKEN, fallback })
    return { fetch, git, events, runs, secrets }
}

// An adapter that records its calls into `events`.
function recordingAdapter(events) {
    const contexts = []
    const adapter = fakeAdapter('fake-host', {
        setUp: async (ctx) => {
            events.push('setUp')
            contexts.push(ctx)
        },
        deployJob: () => {
            events.push('deployJob')
            return { permissions: { pages: 'write' }, job: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo deploy' }] } }
        },
        liveUrl: (ctx) => {
            events.push('liveUrl')
            return `https://${ctx.repository.owner}.fake-host.example/${ctx.repository.name}/`
        },
    })
    return { adapter, contexts }
}

// The three files a published site needs, written into the test's `site`.
// A block body: beforeEach would read a returned value as its cleanup.
function writeSite() {
    writeFiles(site, {
        'package.json': '{ "name": "my-site", "private": true }\n',
        'config/app.yaml': 'name: My Site\n',
        'pages/index.md': '---\nlayout: pages/default.pug\n---\n# Hello\n',
    })
}

// runPublish with the real pipeline over `targets`; only GitHub, DNS, the
// token store and the clock are fakes, and commits go through the API
// path (no git needed).
const runPipeline = (args, github, targets, resolver) => runPublish(args, {
    cwd: site,
    stdin: pipe,
    stdout: pipe,
    env: {},
    targets,
    publish: (ctx) => publishSite(ctx, {
        fetch: github.fetch,
        readToken: async () => ({ accessToken: TOKEN, source: 'env' }),
        saveToken: async () => {
            throw new Error('an env token is never saved')
        },
        sleep: async () => {},
        now: () => 0,
        open: () => {
            throw new Error('no browser without a terminal')
        },
        useGit: false,
        resolver,
    }),
})

describe('publishSite — end to end over a fake GitHub', () => {
    // runPipeline with a recording fake-host adapter.
    function publishEndToEnd(args, github, adapterOverrides = {}) {
        const { adapter, contexts } = recordingAdapter(github.events)
        Object.assign(adapter, adapterOverrides)
        const result = runPipeline(['--target', 'fake-host', ...args], github, createRegistry([adapter]))
        return { result, contexts }
    }

    beforeEach(writeSite)

    it('first run: the D5 order, the repository and target recorded, the workflow committed, the live URL printed', async () => {
        const github = pipelineGitHub()
        const { result, contexts } = publishEndToEnd(['--repo', REPO], github)
        expect(await result).toBe(0)

        expect(github.events.filter((event, i, all) => event !== all[i - 1])).toEqual([
            'installation', 'create repository', 'setUp', 'deployJob', 'push', 'poll run', 'liveUrl',
        ])
        expect(contexts[0].repository).toMatchObject({ repository: REPOSITORY, created: true })
        expect(contexts[0].interactive).toBe(false)
        expect(await readPublishConfig(site)).toEqual({ repository: REPOSITORY, target: 'fake-host' })

        const published = github.git.filesOf(github.git.refs.main)
        expect(Object.keys(published).sort()).toEqual([
            '.github/workflows/deploy.yml', 'config/app.yaml', 'config/publish.yaml', 'package.json', 'pages/index.md',
        ])
        expect(published['.github/workflows/deploy.yml'].content.startsWith(GENERATED_HEADER)).toBe(true)
        expect(published['config/publish.yaml'].content).toContain(`repository: ${REPOSITORY}`)
        expect(published['config/publish.yaml'].content).toContain('target: fake-host')

        expect(logged()).toContain(`Deploying: https://github.com/${REPOSITORY}/actions/runs/100`)
        expect(logged()).toContain(`Live at https://${OWNER}.fake-host.example/${REPO}/`)
        expect(logged()).not.toContain(TOKEN)
    })

    it('a later run reuses the repository, publishes the change and polls the run for the new commit', async () => {
        const github = pipelineGitHub()
        expect(await publishEndToEnd(['--repo', REPO], github).result).toBe(0)
        const first = github.git.refs.main
        github.events.length = 0

        await fs.writeFile(path.join(site, 'pages/index.md'), '---\nlayout: pages/default.pug\n---\n# Changed\n')
        const { result, contexts } = publishEndToEnd([], github)
        expect(await result).toBe(0)

        expect(github.events).not.toContain('create repository')
        expect(contexts[0].repository.created).toBe(false)
        const second = github.git.refs.main
        expect(second).not.toBe(first)
        expect(github.git.filesOf(second)['pages/index.md'].content).toContain('# Changed')
        expect(JSON.parse(await fs.readFile(path.join(site, PUBLISH_STATE), 'utf-8')).sha).toBe(second)
        // The earlier run is still listed for the first sha; the new one is polled.
        expect(github.runs.map((run) => run.head_sha)).toEqual([first, second])
        expect(logged()).toContain(`Deploying: https://github.com/${REPOSITORY}/actions/runs/101`)
    })

    it('--json success: one { ok, url, repository, sha, run } object, exit 0', async () => {
        const github = pipelineGitHub()
        const { result } = publishEndToEnd(['--repo', REPO, '--json'], github)
        expect(await result).toBe(0)
        expect(printedJson()).toEqual({
            ok: true,
            url: `https://${OWNER}.fake-host.example/${REPO}/`,
            repository: REPOSITORY,
            sha: github.git.refs.main,
            run: `https://github.com/${REPOSITORY}/actions/runs/100`,
        })
        expect(log).not.toHaveBeenCalled()
    })

    it('a failed run: text mode throws the report; no live URL', async () => {
        const github = pipelineGitHub({ conclusion: 'failure' })
        const { result } = publishEndToEnd(['--repo', REPO], github)
        await expect(result).rejects.toThrow(`The deploy failed at the step "Render site" of the job "build": https://github.com/${REPOSITORY}/actions/runs/100`)
        expect(github.events).not.toContain('liveUrl')
        expect(logged()).not.toContain('Live at')
    })

    it('--json failure: { ok: false, error, repository, sha, deploy } with the excerpt and hint, exit 1', async () => {
        const github = pipelineGitHub({ conclusion: 'failure' })
        const { result } = publishEndToEnd(['--repo', REPO, '--json'], github)
        expect(await result).toBe(1)
        const object = printedJson()
        expect(object.ok).toBe(false)
        expect(object.repository).toBe(REPOSITORY)
        expect(object.sha).toBe(github.git.refs.main)
        expect(object.error).toContain('Error: Layout "post.pug" not found')
        expect(object.deploy).toEqual({
            run: `https://github.com/${REPOSITORY}/actions/runs/100`,
            job: 'build',
            step: BUILD_STEPS.render,
            excerpt: 'Error: Layout "post.pug" not found',
            hint: expect.stringContaining('Run nera build in the site folder'),
        })
    })

    it('--json failure before the push: the repository, no sha', async () => {
        const github = pipelineGitHub()
        const { result } = publishEndToEnd(['--repo', REPO, '--json'], github, {
            setUp: async () => {
                throw new Error('The host refused the site.')
            },
        })
        expect(await result).toBe(1)
        expect(printedJson()).toEqual({ ok: false, error: 'The host refused the site.', repository: REPOSITORY })
    })

    // An old host the site moves away from, with its removal hint.
    const oldHost = (overrides = {}) => fakeAdapter('old-host', {
        label: 'Old Host',
        leftBehind: (ctx) => [`${ctx.repository.repository} is still online on Old Host.`, 'Remove it there.'],
        ...overrides,
    })
    const publishMove = (args, github, old) => {
        const { adapter } = recordingAdapter(github.events)
        return runPipeline(['--target', 'fake-host', ...args], github, createRegistry([old, adapter]))
    }

    it('a move: after the deploy, the old host\'s hint is logged and --json reports movedFrom', async () => {
        await writePublishConfig({ target: 'old-host' }, site)
        const github = pipelineGitHub()
        expect(await publishMove(['--repo', REPO, '--json'], github, oldHost())).toBe(0)
        expect(printedJson()).toEqual({
            ok: true,
            url: `https://${OWNER}.fake-host.example/${REPO}/`,
            repository: REPOSITORY,
            sha: github.git.refs.main,
            run: `https://github.com/${REPOSITORY}/actions/runs/100`,
            movedFrom: 'old-host',
        })
        const stderr = error.mock.calls.flat().join('\n')
        expect(stderr).toContain('Moved from Old Host to Fake Host. The site on Old Host was left untouched.')
        expect(stderr).toContain(`  ${REPOSITORY} is still online on Old Host.\n  Remove it there.`)
        expect(await readPublishConfig(site)).toMatchObject({ target: 'fake-host' })
    })

    it('a move to a host without leftBehind still says the old one was left untouched', async () => {
        await writePublishConfig({ target: 'old-host' }, site)
        const github = pipelineGitHub()
        expect(await publishMove(['--repo', REPO], github, oldHost({ leftBehind: undefined }))).toBe(0)
        expect(logged()).toContain('Moved from Old Host to Fake Host. The site on Old Host was left untouched.')
    })

    it('a move whose deploy fails prints no hint', async () => {
        await writePublishConfig({ target: 'old-host' }, site)
        const github = pipelineGitHub({ conclusion: 'failure' })
        await expect(publishMove(['--repo', REPO], github, oldHost())).rejects.toThrow('The deploy failed')
        expect(logged()).not.toContain('Moved from')
    })

    it('no move: no hint', async () => {
        const github = pipelineGitHub()
        expect(await publishEndToEnd(['--repo', REPO], github).result).toBe(0)
        expect(logged()).not.toContain('Moved from')
    })

    it('target is written after setUp (D6): a failed set-up keeps the old target, so the next run is still a move', async () => {
        await writePublishConfig({ target: 'old-host' }, site)
        const github = pipelineGitHub()
        const seen = []
        const { adapter } = recordingAdapter(github.events)
        adapter.setUp = async () => {
            seen.push((await readPublishConfig(site)).target)
            throw new Error('The host refused the sign-in.')
        }
        const result = runPipeline(['--target', 'fake-host', '--repo', REPO], github, createRegistry([oldHost(), adapter]))
        await expect(result).rejects.toThrow('The host refused the sign-in.')
        expect(seen).toEqual(['old-host'])
        expect(await readPublishConfig(site)).toMatchObject({ target: 'old-host', repository: REPOSITORY })
    })

    it('--json failure before the repository is known: neither repository nor sha', async () => {
        const github = pipelineGitHub()
        const fetch = github.fetch
        github.fetch = async (url, init) => (url.endsWith('/user') ? jsonResponse(401, { message: 'Bad credentials' }) : fetch(url, init))
        const { result } = publishEndToEnd(['--repo', REPO, '--json'], github)
        expect(await result).toBe(1)
        expect(printedJson()).toEqual({ ok: false, error: 'GitHub answered 401 to GET /user: Bad credentials' })
    })
})

describe('publishSite with the github-pages adapter — end to end over a fake GitHub', () => {
    // As publishEndToEnd, with the real registry (github-pages, the default
    // target) and a DNS stub answering `records` (helpers/fake-dns.js).
    function publishToPages(args, github, records = {}) {
        const resolver = fakeResolver(records)
        return { result: runPipeline(args, github, createRegistry(), resolver), lookups: resolver.lookups }
    }
    const stderr = () => error.mock.calls.flat().join('\n')

    beforeEach(writeSite)

    it('enables Pages before the push, commits base_path and the Pages job, prints the Pages address', async () => {
        const github = pipelineGitHub()
        const { result, lookups } = publishToPages(['--repo', REPO], github)
        expect(await result).toBe(0)

        expect(github.events.filter((event, i, all) => event !== all[i - 1])).toEqual([
            'installation', 'create repository', 'enable pages', 'push', 'poll run',
        ])
        expect(await readPublishConfig(site)).toEqual({ repository: REPOSITORY, target: 'github-pages' })
        const published = github.git.filesOf(github.git.refs.main)
        expect(published['config/app.yaml'].content).toBe(`name: My Site\nbase_path: /${REPO}\n`)
        const workflow = published['.github/workflows/deploy.yml'].content
        expect(workflow).toContain('uses: actions/deploy-pages@v5')
        expect(workflow).toContain('name: github-pages')
        expect(lookups).toEqual([])
        expect(logged()).toContain(`Live at https://${OWNER}.github.io/${REPO}/`)
        expect(logged()).not.toContain(TOKEN)
    })

    it('--domain --json: the domain set before the push, no base_path, the DNS report on stderr only', async () => {
        const github = pipelineGitHub()
        const { result, lookups } = publishToPages(['--repo', REPO, '--domain', 'WWW.Example.com', '--json'], github, { A: ['203.0.113.7'] })
        expect(await result).toBe(0)

        expect(github.events.indexOf('set domain www.example.com')).toBeGreaterThan(github.events.indexOf('enable pages'))
        expect(github.events.indexOf('set domain www.example.com')).toBeLessThan(github.events.indexOf('push'))
        expect(github.git.filesOf(github.git.refs.main)['config/app.yaml'].content).toBe('name: My Site\n')
        expect(lookups.sort()).toEqual(['A www.example.com', 'AAAA www.example.com', 'CNAME www.example.com', 'SOA www.example.com'])

        expect(printedJson()).toEqual({
            ok: true,
            url: 'http://www.example.com/',
            repository: REPOSITORY,
            sha: github.git.refs.main,
            run: `https://github.com/${REPOSITORY}/actions/runs/100`,
        })
        expect(log).not.toHaveBeenCalled()
        expect(stderr()).toContain('DNS for www.example.com does not point to GitHub Pages yet: it has A 203.0.113.7.')
        expect(stderr()).toContain(`  CNAME  www.example.com  ${OWNER}.github.io`)
        // A domain set in this run has no certificate yet: HTTPS waits for a later run.
        expect(github.events).not.toContain('enforce https true')
        expect(stderr()).toContain('HTTPS is not enforced for www.example.com yet')
    })
})

describe('publishSite with the netlify adapter — end to end over a fake GitHub and Netlify', () => {
    const NETLIFY_TOKEN = 'nfp_fake_netlify_token'

    // runPublish with the real registry over one fetch that routes Netlify's
    // API to `netlifyHost` and everything else to `github`.
    const publishToNetlify = (args, github, netlifyHost) => runPublish(['--target', 'netlify', ...args], {
        cwd: site,
        stdin: pipe,
        stdout: pipe,
        env: {},
        publish: (ctx) => publishSite(ctx, {
            fetch: (url, init) => (url.startsWith(NETLIFY_API) ? netlifyHost : github).fetch(url, init),
            readToken: async () => ({ accessToken: TOKEN, source: 'env' }),
            readNetlifyToken: async () => ({ accessToken: NETLIFY_TOKEN, source: 'env' }),
            saveToken: async () => {
                throw new Error('an env token is never saved')
            },
            saveNetlifyToken: async () => {
                throw new Error('an env token is never saved')
            },
            sleep: async () => {},
            now: () => Date.UTC(2026, 10, 17),
            open: () => {
                throw new Error('no browser without a terminal')
            },
            useGit: false,
        }),
    })
    // The GitHub and Netlify events in one order: Netlify's are pushed into
    // GitHub's list as they happen.
    const linked = (github, netlifyHost) => {
        const push = netlifyHost.events.push.bind(netlifyHost.events)
        netlifyHost.events.push = (...items) => {
            github.events.push(...items)
            return push(...items)
        }
    }

    beforeEach(writeSite)

    it('first run: the site created and both secrets stored before the push, site_id committed, the Netlify address printed', async () => {
        const github = pipelineGitHub()
        const netlifyHost = fakeNetlify({ token: NETLIFY_TOKEN })
        linked(github, netlifyHost)
        expect(await publishToNetlify(['--repo', REPO], github, netlifyHost)).toBe(0)

        const order = github.events.filter((event, i, all) => event !== all[i - 1])
        expect(order).toEqual([
            'installation', 'create repository', `create site ${REPO}`,
            'store secret NETLIFY_AUTH_TOKEN', 'store secret NETLIFY_SITE_ID', 'push', 'poll run',
        ])
        expect(Object.keys(github.secrets)).toEqual(['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID'])
        for (const sent of Object.values(github.secrets)) {
            expect(sent.key_id).toBe('fake-key-id')
            expect(sent.encrypted_value).not.toContain(NETLIFY_TOKEN)
        }

        expect(await readPublishConfig(site)).toEqual({ repository: REPOSITORY, target: 'netlify', netlify: { site_id: 'site-1' } })
        const published = github.git.filesOf(github.git.refs.main)
        expect(published['config/publish.yaml'].content).toContain('site_id: site-1')
        const workflow = published['.github/workflows/deploy.yml'].content
        expect(workflow).toContain('name: Deploy to Netlify')
        expect(workflow).toContain('NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}')
        expect(workflow).not.toContain('deploy-pages')
        for (const file of Object.values(published)) expect(file.content).not.toContain(NETLIFY_TOKEN)

        expect(logged()).toContain(`Created the Netlify site ${REPO}.`)
        expect(logged()).toContain('Netlify\'s free plan has 300 credits a month')
        expect(netlifyHost.events.some((event) => event.startsWith('list deploys'))).toBe(false)
        expect(logged()).toContain(`Live at https://${REPO}.netlify.app`)
        expect(logged()).not.toContain(TOKEN)
        expect(logged()).not.toContain(NETLIFY_TOKEN)
    })

    it('a later run reuses site_id, stores the secrets again and checks the credits instead of the budget note', async () => {
        const github = pipelineGitHub()
        const netlifyHost = fakeNetlify({ token: NETLIFY_TOKEN })
        expect(await publishToNetlify(['--repo', REPO], github, netlifyHost)).toBe(0)
        github.events.length = 0
        log.mockClear()

        await fs.writeFile(path.join(site, 'pages/index.md'), '---\nlayout: pages/default.pug\n---\n# Changed\n')
        expect(await publishToNetlify([], github, netlifyHost)).toBe(0)
        expect(netlifyHost.events.filter((event) => event.startsWith('create site'))).toHaveLength(1)
        expect(github.events.filter((event) => event.startsWith('store secret'))).toEqual([
            'store secret NETLIFY_AUTH_TOKEN', 'store secret NETLIFY_SITE_ID',
        ])
        expect(netlifyHost.events.at(-1)).toBe('list deploys production=true&per_page=100')
        expect(logged()).toContain(`Using the Netlify site ${REPO}.`)
        expect(logged()).not.toContain('Netlify\'s free plan has')
        expect(await readPublishConfig(site)).toMatchObject({ netlify: { site_id: 'site-1' } })
    })

    it('a switch from github-pages to netlify removes base_path and replaces the Pages job', async () => {
        const github = pipelineGitHub()
        expect(await runPipeline(['--repo', REPO], github, createRegistry(), fakeResolver())).toBe(0)
        expect(await fs.readFile(path.join(site, 'config/app.yaml'), 'utf-8')).toBe(`name: My Site\nbase_path: /${REPO}\n`)

        const netlifyHost = fakeNetlify({ token: NETLIFY_TOKEN })
        expect(await publishToNetlify([], github, netlifyHost)).toBe(0)
        const published = github.git.filesOf(github.git.refs.main)
        expect(published['config/app.yaml'].content).toBe('name: My Site\n')
        expect(published['.github/workflows/deploy.yml'].content).not.toContain('deploy-pages')
        expect(await readPublishConfig(site)).toMatchObject({ target: 'netlify', netlify: { site_id: 'site-1' } })
        expect(logged()).toContain('Removed base_path from config/app.yaml: Netlify serves the site from the root.')
    })
})

describe('nera publish --json: the sign-in steps as NDJSON events on stderr', () => {
    const USER_CODE = 'WDJB-MJHT'
    const DEVICE_CODE = 'fake_device_code_9c1e7a'
    const REFRESH = 'ghr_fake_refresh_token'
    const NETLIFY_TOKEN = 'nfp_fake_netlify_token'
    const TICKET_ID = 'fake_ticket_7d3b'

    // A fake GitHub with nobody signed in and the app not installed yet: the
    // device flow is authorized at the first poll, and the installation is
    // listed from the second look on.
    function signedOutGitHub() {
        const github = pipelineGitHub()
        const api = github.fetch
        let looks = 0
        github.fetch = async (url, init) => {
            if (url === 'https://github.com/login/device/code') {
                return jsonResponse(200, {
                    device_code: DEVICE_CODE,
                    user_code: USER_CODE,
                    verification_uri: DEVICE_PAGE,
                    expires_in: 900,
                    interval: 5,
                })
            }
            if (url === 'https://github.com/login/oauth/access_token') {
                return jsonResponse(200, { access_token: TOKEN, expires_in: 28800, refresh_token: REFRESH, refresh_token_expires_in: 15897600, token_type: 'bearer' })
            }
            if (url === `${GITHUB_API}/user/installations?per_page=100` && looks++ === 0) {
                return jsonResponse(200, { installations: [] })
            }
            return api(url, init)
        }
        return github
    }

    // The Netlify stub with no stored token: the ticket is authorized at the
    // first poll and exchanged for NETLIFY_TOKEN.
    function signedOutNetlify() {
        const netlifyHost = fakeNetlify({ token: NETLIFY_TOKEN })
        const api = netlifyHost.fetch
        netlifyHost.fetch = async (url, init) => {
            if (url === `${NETLIFY_API}/oauth/tickets?client_id=${NETLIFY_CLIENT_ID}`) {
                return jsonResponse(201, { id: TICKET_ID, client_id: NETLIFY_CLIENT_ID, authorized: false })
            }
            if (url === `${NETLIFY_API}/oauth/tickets/${TICKET_ID}`) {
                return jsonResponse(200, { id: TICKET_ID, authorized: true })
            }
            if (url === `${NETLIFY_API}/oauth/tickets/${TICKET_ID}/exchange`) {
                return jsonResponse(201, { access_token: NETLIFY_TOKEN, user_email: 'me@example.com' })
            }
            return api(url, init)
        }
        return netlifyHost
    }

    // runPublish with the real registry and pipeline, no token stored for
    // either account; `wired` is what runPublish chose (its `emit`).
    const publishSignedOut = (args, github, netlifyHost = fakeNetlify({ token: NETLIFY_TOKEN })) => runPublish(args, {
        cwd: site,
        stdin: pipe,
        stdout: pipe,
        env: {},
        publish: (ctx, wired) => publishSite(ctx, {
            ...wired,
            fetch: (url, init) => (url.startsWith(NETLIFY_API) ? netlifyHost : github).fetch(url, init),
            readToken: async () => null,
            saveToken: async () => ({ store: 'keychain' }),
            readNetlifyToken: async () => null,
            saveNetlifyToken: async () => ({ store: 'keychain' }),
            sleep: async () => {},
            now: () => Date.UTC(2026, 10, 17),
            open: () => {
                throw new Error('no browser without a terminal')
            },
            useGit: false,
        }),
    })

    // stderr as one stream: the log lines (console.error, where --json sends
    // them) and the raw writes (the events), in the order they happened.
    let stream, stderrWrite
    beforeEach(async () => {
        writeSite()
        stream = []
        error.mockImplementation((...args) => stream.push(`${args.join(' ')}\n`))
        stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stream.push(String(chunk))
            return true
        })
    })
    afterEach(() => {
        stderrWrite.mockRestore()
    })
    const stderrLines = () => stream.join('').split('\n').filter(Boolean)
    // Every stderr line that is JSON, parsed; a line that does not parse fails the test.
    const events = () => stderrLines().filter((line) => line.startsWith('{')).map((line) => JSON.parse(line))
    const eventLine = (event) => JSON.stringify(event)

    it('GitHub sign-in and app installation: action_required right after each line, action_done once done, stdout one object', async () => {
        const github = signedOutGitHub()
        expect(await publishSignedOut(['--repo', REPO, '--json'], github)).toBe(0)

        const signIn = { event: 'action_required', action: { kind: GITHUB_SIGN_IN, code: USER_CODE, url: DEVICE_PAGE } }
        const install = { event: 'action_required', action: { kind: GITHUB_APP_INSTALL, url: INSTALL_PAGE } }
        expect(events()).toEqual([
            signIn,
            { event: 'action_done', kind: GITHUB_SIGN_IN },
            install,
            { event: 'action_done', kind: GITHUB_APP_INSTALL },
        ])
        const lines = stderrLines()
        const codeLine = lines.indexOf(`To sign in to GitHub, enter the code ${USER_CODE} at ${DEVICE_PAGE}`)
        expect(lines[codeLine + 1]).toBe(eventLine(signIn))
        expect(lines[lines.indexOf(`Install it at ${INSTALL_PAGE}`) + 1]).toBe(eventLine(install))
        expect(lines[lines.indexOf(`Signed in as ${OWNER}`) + 1]).toBe(eventLine({ event: 'action_done', kind: GITHUB_SIGN_IN }))

        expect(printedJson()).toEqual({
            ok: true,
            url: `https://${OWNER}.github.io/${REPO}/`,
            repository: REPOSITORY,
            sha: github.git.refs.main,
            run: `https://github.com/${REPOSITORY}/actions/runs/100`,
        })
        expect(log).not.toHaveBeenCalled()
        for (const secret of [TOKEN, REFRESH, DEVICE_CODE]) expect(stream.join('')).not.toContain(secret)
    })

    it('Netlify authorization: its events follow GitHub\'s, with the authorize page the line prints', async () => {
        const github = signedOutGitHub()
        expect(await publishSignedOut(['--target', 'netlify', '--repo', REPO, '--json'], github, signedOutNetlify())).toBe(0)

        const page = authorizeUrl(TICKET_ID)
        const authorize = { event: 'action_required', action: { kind: NETLIFY_SIGN_IN, url: page } }
        expect(events().map(({ event, kind, action }) => `${event} ${kind ?? action.kind}`)).toEqual([
            `action_required ${GITHUB_SIGN_IN}`,
            `action_done ${GITHUB_SIGN_IN}`,
            `action_required ${GITHUB_APP_INSTALL}`,
            `action_done ${GITHUB_APP_INSTALL}`,
            `action_required ${NETLIFY_SIGN_IN}`,
            `action_done ${NETLIFY_SIGN_IN}`,
        ])
        const lines = stderrLines()
        const pageLine = lines.indexOf(`To sign in to Netlify, open ${page} and choose "Authorize".`)
        expect(lines[pageLine + 1]).toBe(eventLine(authorize))
        expect(lines[lines.indexOf('Signed in to Netlify as me@example.com') + 1]).toBe(eventLine({ event: 'action_done', kind: NETLIFY_SIGN_IN }))
        expect(printedJson()).toMatchObject({ ok: true, url: `https://${REPO}.netlify.app`, repository: REPOSITORY })
        for (const secret of [TOKEN, REFRESH, DEVICE_CODE, NETLIFY_TOKEN]) expect(stream.join('')).not.toContain(secret)
    })

    it('a failed --json run still has its events before the one failure object', async () => {
        const github = signedOutGitHub()
        const fetch = github.fetch
        github.fetch = async (url, init) => (url === `${GITHUB_API}/user/repos` ? jsonResponse(500, { message: 'Server Error' }) : fetch(url, init))
        expect(await publishSignedOut(['--repo', REPO, '--json'], github)).toBe(1)
        expect(events().map(({ event }) => event)).toEqual(['action_required', 'action_done', 'action_required', 'action_done'])
        expect(printedJson()).toMatchObject({ ok: false, error: expect.stringContaining('500') })
    })

    it('text mode: the same sign-in prints its lines and no event at all', async () => {
        const github = signedOutGitHub()
        expect(await publishSignedOut(['--target', 'netlify', '--repo', REPO], github, signedOutNetlify())).toBe(0)
        expect(logged()).toContain(`To sign in to GitHub, enter the code ${USER_CODE} at ${DEVICE_PAGE}`)
        expect(logged()).toContain(`Install it at ${INSTALL_PAGE}`)
        expect(logged()).toContain(`To sign in to Netlify, open ${authorizeUrl(TICKET_ID)}`)
        expect(stderrWrite).not.toHaveBeenCalled()
        expect(logged()).not.toContain('"event"')
    })

    it('a valid stored token and an installed app: --json writes no event', async () => {
        const github = pipelineGitHub()
        const result = runPublish(['--repo', REPO, '--json'], {
            cwd: site,
            stdin: pipe,
            stdout: pipe,
            env: {},
            publish: (ctx, wired) => publishSite(ctx, {
                ...wired,
                fetch: github.fetch,
                readToken: async () => ({ accessToken: TOKEN, source: 'env' }),
                sleep: async () => {},
                now: () => 0,
                useGit: false,
            }),
        })
        expect(await result).toBe(0)
        expect(events()).toEqual([])
        expect(printedJson()).toMatchObject({ ok: true })
    })
})

describe('bin/nera.js publish, as a child process', () => {
    const cli = (args) =>
        spawnSync(process.execPath, [CLI, ...args], {
            cwd: site,
            encoding: 'utf-8',
            env: { ...process.env, NERA_GITHUB_TOKEN: '' },
        })

    // An unknown target fails before sign-in, so no child touches the
    // keychain or the network.
    it('is dispatched and in the usage text; an unknown target names github-pages and netlify', () => {
        const help = cli([])
        expect(help.status).toBe(0)
        expect(help.stdout).toMatch(/^ {2}nera publish /m)

        const text = cli(['publish', '--target', 'nope'])
        expect(text.status).toBe(1)
        expect(text.stderr).toContain('❌ Unknown publish target "nope". Available targets: github-pages, netlify.')
    }, 30_000) // two node children; as in json-output.test.js, startup is slow on a loaded machine

    it('--json: the whole stdout is one object, exit 1 as in text mode, no ❌ line', () => {
        const child = cli(['publish', '--target', 'nope', '--json'])
        expect(child.status).toBe(1)
        expect(JSON.parse(child.stdout)).toEqual({
            ok: false,
            error: 'Unknown publish target "nope". Available targets: github-pages, netlify.',
        })
        expect(child.stderr).not.toContain('❌')
    }, 30_000)
})
