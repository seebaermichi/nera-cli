import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { parsePublishArgs, runPublish, publishSite, REVOKE_URL } from '../src/commands/publish.js'
import { assertAdapter, createRegistry, TARGETS } from '../src/publish/targets.js'
import {
    readPublishConfig,
    writePublishConfig,
    publishConfigFile,
} from '../src/publish/site-config.js'
import { GITHUB_API } from '../src/publish/github.js'
import { githubPages } from '../src/publish/pages.js'
import { PUBLISH_STATE } from '../src/publish/commit.js'
import { WORKFLOW_PATH } from '../src/publish/status.js'
import { BUILD_STEPS, GENERATED_HEADER } from '../src/publish/workflow.js'
import { fakeGitData, jsonResponse } from './helpers/fake-github.js'
import { fakeResolver } from './helpers/fake-dns.js'

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
    it('registers GitHub Pages, the default when no target is named', () => {
        expect(TARGETS).toEqual([githubPages])
        expect(createRegistry().ids()).toEqual(['github-pages'])
        expect(createRegistry().resolve('github-pages')).toBe(githubPages)
        expect(createRegistry().resolve(undefined)).toBe(githubPages)
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
            'Unknown publish target "nope". Available targets: a-host, b-host.'
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
            'No publish target is available in this version of Nera yet.'
        )
        expect(() => createRegistry([]).resolve(undefined)).toThrow(
            'Name a target with --target <id>. No publish target is available in this version of Nera yet.'
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

// A fake GitHub for the whole pipeline: the account, the app's installation,
// repository creation, the Git Data API (helpers/fake-github.js) and an
// Actions API that starts one run of the deploy workflow for every new head
// of main. `conclusion` is what that run ends with; `events` records the
// GitHub side of the D5 order next to the adapter's calls.
const OWNER = 'octo'
const REPO = 'my-site'
const REPOSITORY = `${OWNER}/${REPO}`
const TOKEN = 'ghu_fake_access_token'

function fakeGitHub({ conclusion = 'success' } = {}) {
    const git = fakeGitData({ repository: REPOSITORY, token: TOKEN })
    const events = []
    const runs = []
    let created = false
    let nextRun = 100
    // The repository's Pages site, once the github-pages adapter enabled it.
    let pages = null
    const repoObject = () => ({
        full_name: REPOSITORY,
        owner: { login: OWNER },
        name: REPO,
        private: false,
        default_branch: 'main',
        html_url: `https://github.com/${REPOSITORY}`,
    })
    // A queued run for a head that has none yet, completed one poll later.
    const startRun = () => {
        if (!git.refs.main || runs.some((run) => run.head_sha === git.refs.main)) return
        const id = nextRun++
        runs.push({ id, head_sha: git.refs.main, path: WORKFLOW_PATH, status: 'queued', conclusion: null, html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}` })
    }

    const fetch = async (url, init) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        if (route === 'GET /user') return jsonResponse(200, { login: OWNER, id: 4242 })
        if (route === 'GET /user/installations?per_page=100') {
            events.push('installation')
            return jsonResponse(200, { installations: [{ id: 1, app_slug: 'nera-static', account: { login: OWNER } }] })
        }
        if (route === `GET /repos/${REPOSITORY}`) return created ? jsonResponse(200, repoObject()) : jsonResponse(404, { message: 'Not Found' })
        if (route === 'POST /user/repos') {
            events.push('create repository')
            created = true
            git.autoInit()
            return jsonResponse(201, repoObject())
        }
        if (route === `GET /repos/${REPOSITORY}/pages`) return pages ? jsonResponse(200, pages) : jsonResponse(404, { message: 'Not Found' })
        if (route === `POST /repos/${REPOSITORY}/pages`) {
            events.push('enable pages')
            pages = { html_url: `https://${OWNER}.github.io/${REPO}/`, build_type: JSON.parse(init.body).build_type, cname: null }
            return jsonResponse(201, pages)
        }
        if (route === `PUT /repos/${REPOSITORY}/pages`) {
            const { cname } = JSON.parse(init.body)
            events.push(`set domain ${cname}`)
            // GitHub reports http until the certificate for the domain is issued.
            Object.assign(pages, { cname, html_url: `http://${cname}/` })
            return jsonResponse(204)
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
            return jsonResponse(200, { workflow_runs: runs.filter((run) => run.head_sha === sha).map((run) => ({ ...run })) })
        }
        const jobs = route.match(/\/actions\/runs\/(\d+)\/jobs/)
        if (jobs) {
            return jsonResponse(200, { jobs: [{ id: Number(jobs[1]) * 10, name: 'build', conclusion: 'failure', steps: [{ name: BUILD_STEPS.render, conclusion: 'failure' }] }] })
        }
        if (/\/actions\/jobs\/\d+\/logs$/.test(route)) {
            return { ok: true, status: 200, statusText: 'OK', text: async () => '2026-10-26T10:00:01.0000000Z ##[error]Layout "post.pug" not found\n' }
        }
        if (route === `PATCH /repos/${REPOSITORY}/git/refs/heads/main`) events.push('push')
        return git.fetch(url, init)
    }
    return { fetch, git, events, runs }
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

async function makeSite() {
    const files = {
        'package.json': '{ "name": "my-site", "private": true }\n',
        'config/app.yaml': 'name: My Site\n',
        'pages/index.md': '---\nlayout: pages/default.pug\n---\n# Hello\n',
    }
    for (const [file, content] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(site, file)), { recursive: true })
        await fs.writeFile(path.join(site, file), content)
    }
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

    beforeEach(makeSite)

    it('first run: the D5 order, the repository and target recorded, the workflow committed, the live URL printed', async () => {
        const github = fakeGitHub()
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
        const github = fakeGitHub()
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
        const github = fakeGitHub()
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
        const github = fakeGitHub({ conclusion: 'failure' })
        const { result } = publishEndToEnd(['--repo', REPO], github)
        await expect(result).rejects.toThrow(`The deploy failed at the step "Render site" of the job "build": https://github.com/${REPOSITORY}/actions/runs/100`)
        expect(github.events).not.toContain('liveUrl')
        expect(logged()).not.toContain('Live at')
    })

    it('--json failure: { ok: false, error, repository, sha, deploy } with the excerpt and hint, exit 1', async () => {
        const github = fakeGitHub({ conclusion: 'failure' })
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
        const github = fakeGitHub()
        const { result } = publishEndToEnd(['--repo', REPO, '--json'], github, {
            setUp: async () => {
                throw new Error('The host refused the site.')
            },
        })
        expect(await result).toBe(1)
        expect(printedJson()).toEqual({ ok: false, error: 'The host refused the site.', repository: REPOSITORY })
    })

    it('--json failure before the repository is known: neither repository nor sha', async () => {
        const github = fakeGitHub()
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

    beforeEach(makeSite)

    it('enables Pages before the push, commits base_path and the Pages job, prints the Pages address', async () => {
        const github = fakeGitHub()
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
        const github = fakeGitHub()
        const { result, lookups } = publishToPages(['--repo', REPO, '--domain', 'WWW.Example.com', '--json'], github, { A: ['203.0.113.7'] })
        expect(await result).toBe(0)

        expect(github.events.indexOf('set domain www.example.com')).toBeGreaterThan(github.events.indexOf('enable pages'))
        expect(github.events.indexOf('set domain www.example.com')).toBeLessThan(github.events.indexOf('push'))
        expect(github.git.filesOf(github.git.refs.main)['config/app.yaml'].content).toBe('name: My Site\n')
        expect(lookups.sort()).toEqual(['A www.example.com', 'AAAA www.example.com', 'CNAME www.example.com'])

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
    it('is dispatched and in the usage text; an unknown target names github-pages', () => {
        const help = cli([])
        expect(help.status).toBe(0)
        expect(help.stdout).toMatch(/^ {2}nera publish /m)

        const text = cli(['publish', '--target', 'nope'])
        expect(text.status).toBe(1)
        expect(text.stderr).toContain('❌ Unknown publish target "nope". Available targets: github-pages.')
    })

    it('--json: the whole stdout is one object, exit 1 as in text mode, no ❌ line', () => {
        const child = cli(['publish', '--target', 'nope', '--json'])
        expect(child.status).toBe(1)
        expect(JSON.parse(child.stdout)).toEqual({
            ok: false,
            error: 'Unknown publish target "nope". Available targets: github-pages.',
        })
        expect(child.stderr).not.toContain('❌')
    })
})
