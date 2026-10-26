import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
    ensureInstallation,
    ensureRepository,
    INSTALL_PAGE,
    INSTALL_LINES,
    INSTALL_POLL_MS,
    INSTALL_TIMEOUT_MS,
    PRIVATE_NOTE,
} from '../src/publish/repository.js'
import { createGitHubClient, GITHUB_API } from '../src/publish/github.js'
import { readPublishConfig, writePublishConfig, isValidRepoName, parseRepository } from '../src/publish/site-config.js'

// The installation check and the repository of `nera publish` (ROADMAP-ai.md
// L6 step 3). GitHub is a stub behind the real github.js client, the clock is
// fake: no test uses the network or a real token.

const TOKEN = 'ghu_fake_access_token'
const START = 1_800_000_000_000

// The error for octo/site when Nera Static cannot use it, on both paths: no
// push permission when reused, and "already exists" after a 404.
const REACH_ERROR = 'Your repository site exists, but Nera Static cannot reach it. Add it to the app\'s installation at https://github.com/settings/installations, or choose another name with --repo <name>.'

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

const installation = (login = 'octo', slug = 'nera-static') => ({
    id: 42,
    app_slug: slug,
    account: { login },
    repository_selection: 'selected',
})

const repoObject = (owner, name, extra = {}) => ({
    name,
    full_name: `${owner}/${name}`,
    owner: { login: owner },
    private: false,
    default_branch: 'main',
    html_url: `https://github.com/${owner}/${name}`,
    ...extra,
})

// A stub GitHub. `routes` maps "METHOD /path" to a handler(body) returning
// [status, json] (or a queue of them); every request is recorded.
function fakeGitHub(routes) {
    const requests = []
    const fetch = async (url, init = {}) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        const body = init.body === undefined ? undefined : JSON.parse(init.body)
        requests.push({ route, body, init })
        let handler = routes[route]
        if (Array.isArray(handler)) handler = handler.length > 1 ? handler.shift() : handler[0]
        if (!handler) return jsonResponse(404, { message: 'Not Found' })
        const [status, json] = handler(body)
        return jsonResponse(status, json)
    }
    return { client: createGitHubClient({ token: TOKEN, fetch }), requests }
}

function fakeClock() {
    let time = START
    const waits = []
    return {
        now: () => time,
        sleep: async (ms) => {
            waits.push(ms)
            time += ms
        },
        waits,
    }
}

function recorder() {
    const lines = []
    return { lines, log: (line) => lines.push(line) }
}

describe('ensureInstallation', () => {
    it('returns the installation at once when Nera Static is installed', async () => {
        const { client, requests } = fakeGitHub({
            'GET /user/installations?per_page=100': () => [200, { total_count: 1, installations: [installation()] }],
        })
        const { log, lines } = recorder()
        const opened = []
        const result = await ensureInstallation({ client, login: 'octo', tty: true, open: (u) => opened.push(u), log })
        expect(result.id).toBe(42)
        expect(requests).toHaveLength(1)
        expect(lines).toEqual([])
        expect(opened).toEqual([])
    })

    it('without an installation: explains, prints and opens the install page, waits, then continues', async () => {
        const { client, requests } = fakeGitHub({
            'GET /user/installations?per_page=100': [
                () => [200, { total_count: 0, installations: [] }],
                () => [200, { total_count: 0, installations: [] }],
                () => [200, { total_count: 1, installations: [installation()] }],
            ],
        })
        const clock = fakeClock()
        const { log, lines } = recorder()
        const opened = []
        const result = await ensureInstallation({ client, login: 'octo', tty: true, open: (u) => opened.push(u), log, ...clock })

        expect(result.account.login).toBe('octo')
        expect(requests).toHaveLength(3)
        expect(clock.waits).toEqual([INSTALL_POLL_MS, INSTALL_POLL_MS])
        expect(opened).toEqual([INSTALL_PAGE])
        expect(INSTALL_PAGE).toBe('https://github.com/apps/nera-static/installations/new')
        expect(lines.slice(0, INSTALL_LINES.length)).toEqual(INSTALL_LINES)
        expect(lines).toContain(`Install it at ${INSTALL_PAGE}`)
        expect(lines.join('\n')).toMatch(/All repositories/)
        expect(lines.at(-1)).toBe('Nera Static is installed on octo.')
    })

    it('never opens a browser without a TTY, but still prints the page', async () => {
        const { client } = fakeGitHub({
            'GET /user/installations?per_page=100': [
                () => [200, { installations: [] }],
                () => [200, { installations: [installation()] }],
            ],
        })
        const opened = []
        const { log, lines } = recorder()
        await ensureInstallation({ client, login: 'octo', tty: false, open: (u) => opened.push(u), log, ...fakeClock() })
        expect(opened).toEqual([])
        expect(lines).toContain(`Install it at ${INSTALL_PAGE}`)
    })

    it('ignores other apps and installations on other accounts', async () => {
        const { client, requests } = fakeGitHub({
            'GET /user/installations?per_page=100': [
                () => [200, { installations: [installation('octo', 'other-app'), installation('some-org')] }],
                () => [200, { installations: [installation('some-org'), installation('octo')] }],
            ],
        })
        const result = await ensureInstallation({ client, login: 'octo', tty: false, log: () => {}, ...fakeClock() })
        expect(result.account.login).toBe('octo')
        expect(requests).toHaveLength(2)
    })

    it('gives up after the timeout, naming the install page', async () => {
        const { client, requests } = fakeGitHub({
            'GET /user/installations?per_page=100': () => [200, { installations: [] }],
        })
        const clock = fakeClock()
        await expect(ensureInstallation({ client, login: 'octo', tty: false, log: () => {}, ...clock }))
            .rejects.toThrow(`Install it at ${INSTALL_PAGE}, then run nera publish again.`)
        expect(clock.waits).toHaveLength(INSTALL_TIMEOUT_MS / INSTALL_POLL_MS)
        expect(requests).toHaveLength(INSTALL_TIMEOUT_MS / INSTALL_POLL_MS + 1)
    })
})

describe('ensureRepository', () => {
    let site

    beforeEach(async () => {
        site = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'nera-repo-')), 'my-site')
        await fs.mkdir(site)
    })

    afterEach(async () => {
        await fs.rm(path.dirname(site), { recursive: true, force: true })
    })

    const created = (body) => [201, repoObject('octo', body.name, { private: body.private })]

    it('creates a public repository named after the folder, with auto_init, and records it', async () => {
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        const { log, lines } = recorder()
        const result = await ensureRepository({ client, cwd: site, log })

        expect(requests.map((r) => r.route)).toEqual(['POST /user/repos'])
        expect(requests[0].body).toEqual({ name: 'my-site', private: false, auto_init: true })
        expect(result).toEqual({
            repository: 'octo/my-site',
            owner: 'octo',
            name: 'my-site',
            private: false,
            defaultBranch: 'main',
            htmlUrl: 'https://github.com/octo/my-site',
            created: true,
        })
        expect(await readPublishConfig(site)).toEqual({ repository: 'octo/my-site' })
        expect(lines.join('\n')).toMatch(/--private/)
        expect(lines).not.toContain(PRIVATE_NOTE)
    })

    it('uses --repo and --private, with the GitHub Pages plan note', async () => {
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        const { log, lines } = recorder()
        const result = await ensureRepository({ client, cwd: site, options: { repo: 'blog.v2', private: true }, log })

        expect(requests[0].body).toEqual({ name: 'blog.v2', private: true, auto_init: true })
        expect(result.private).toBe(true)
        expect(lines).toContain(PRIVATE_NOTE)
        expect(await readPublishConfig(site)).toEqual({ repository: 'octo/blog.v2' })
    })

    it('reuses the repository in config/publish.yaml while GitHub has it, also with no permissions field', async () => {
        await writePublishConfig({ target: 'fake-host', repository: 'octo/site' }, site)
        const { client, requests } = fakeGitHub({
            'GET /repos/octo/site': () => [200, repoObject('octo', 'site', { default_branch: 'trunk' })],
        })
        const result = await ensureRepository({ client, cwd: site, config: await readPublishConfig(site), log: () => {} })

        expect(requests.map((r) => r.route)).toEqual(['GET /repos/octo/site'])
        expect(result).toMatchObject({ repository: 'octo/site', defaultBranch: 'trunk', created: false })
    })

    it('reuses a configured repository whose permissions report push', async () => {
        await writePublishConfig({ repository: 'octo/site' }, site)
        const { client } = fakeGitHub({
            'GET /repos/octo/site': () => [200, repoObject('octo', 'site', { permissions: { admin: false, push: true, pull: true } })],
        })
        const result = await ensureRepository({ client, cwd: site, config: await readPublishConfig(site), log: () => {} })
        expect(result).toMatchObject({ repository: 'octo/site', created: false })
    })

    it('a configured repository without push permission is the reach error, and nothing is created', async () => {
        await writePublishConfig({ repository: 'octo/site' }, site)
        const { client, requests } = fakeGitHub({
            'GET /repos/octo/site': () => [200, repoObject('octo', 'site', { permissions: { admin: false, push: false, pull: true } })],
            'POST /user/repos': created,
        })
        const error = await ensureRepository({ client, cwd: site, config: await readPublishConfig(site), log: () => {} }).catch((err) => err)

        expect(error.message).toBe(REACH_ERROR)
        expect(requests.map((r) => r.route)).toEqual(['GET /repos/octo/site'])
        expect(await readPublishConfig(site)).toEqual({ repository: 'octo/site' })
    })

    it('re-creates a configured repository that was deleted on GitHub instead of crashing', async () => {
        await writePublishConfig({ target: 'fake-host', repository: 'octo/site' }, site)
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        const { log, lines } = recorder()
        const result = await ensureRepository({ client, cwd: site, config: await readPublishConfig(site), log })

        expect(requests.map((r) => r.route)).toEqual(['GET /repos/octo/site', 'POST /user/repos'])
        expect(requests[1].body.name).toBe('site')
        expect(result.created).toBe(true)
        expect(lines.join('\n')).toMatch(/no repository octo\/site any more/)
        expect(await readPublishConfig(site)).toEqual({ target: 'fake-host', repository: 'octo/site' })
    })

    it('a configured repository the app cannot reach points to the installation settings', async () => {
        await writePublishConfig({ repository: 'octo/site' }, site)
        const { client } = fakeGitHub({
            'POST /user/repos': () => [422, { message: 'Repository creation failed.', errors: [{ message: 'name already exists on this account' }] }],
        })
        await expect(ensureRepository({ client, cwd: site, config: await readPublishConfig(site), log: () => {} }))
            .rejects.toThrow(REACH_ERROR)
    })

    it('creates a new repository when --repo names another than the configured one', async () => {
        await writePublishConfig({ repository: 'octo/site' }, site)
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        await ensureRepository({ client, cwd: site, options: { repo: 'other' }, config: await readPublishConfig(site), log: () => {} })

        expect(requests.map((r) => r.route)).toEqual(['POST /user/repos'])
        expect(await readPublishConfig(site)).toEqual({ repository: 'octo/other' })
    })

    it('a taken name is a clear error with a --repo hint, and nothing is recorded', async () => {
        const { client } = fakeGitHub({
            'POST /user/repos': () => [422, { message: 'Repository creation failed.', errors: [{ resource: 'Repository', field: 'name', message: 'name already exists on this account' }] }],
        })
        await expect(ensureRepository({ client, cwd: site, log: () => {} }))
            .rejects.toThrow('You already have a repository named my-site on GitHub. Choose another name with --repo <name>.')
        expect(await readPublishConfig(site)).toEqual({})
    })

    it('another 422 is passed on with GitHub\'s reason', async () => {
        const { client } = fakeGitHub({
            'POST /user/repos': () => [422, { message: 'Repository creation failed.', errors: [{ message: 'visibility is not allowed' }] }],
        })
        await expect(ensureRepository({ client, cwd: site, log: () => {} }))
            .rejects.toThrow('GitHub answered 422 to POST /user/repos: Repository creation failed. (visibility is not allowed)')
    })

    it('refuses an invalid --repo before any GitHub call', async () => {
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        for (const repo of ['my site', '..', 'site.git', 'a/b', 'x'.repeat(101)]) {
            await expect(ensureRepository({ client, cwd: site, options: { repo }, log: () => {} }))
                .rejects.toThrow(/not a valid GitHub repository name/)
        }
        await expect(ensureRepository({ client, cwd: site, options: { repo: 'my site' }, log: () => {} }))
            .rejects.toThrow('--repo my-site')
        await expect(ensureRepository({ client, cwd: site, options: { repo: '..' }, log: () => {} }))
            .rejects.toThrow(/e\.g\. --repo my-site$/)
        expect(requests).toEqual([])
    })

    it('refuses a folder name GitHub would not accept, suggesting --repo, before any call', async () => {
        const folder = path.join(path.dirname(site), 'My Site')
        await fs.mkdir(folder)
        const { client, requests } = fakeGitHub({ 'POST /user/repos': created })
        await expect(ensureRepository({ client, cwd: folder, log: () => {} }))
            .rejects.toThrow('The folder name "My Site" is not a valid GitHub repository name. Name the repository with --repo, e.g. --repo My-Site')
        expect(requests).toEqual([])
    })
})

describe('repository names in config/publish.yaml', () => {
    it('validates GitHub repository names', () => {
        for (const name of ['site', 'my-site', 'my_site', 'site.v2', '.github', 'x'.repeat(100)]) {
            expect(isValidRepoName(name)).toBe(true)
        }
        for (const name of ['', '.', '..', 'a b', 'a/b', 'site.git', 'SITE.GIT', 'x'.repeat(101), undefined]) {
            expect(isValidRepoName(name)).toBe(false)
        }
    })

    it('splits owner/name and refuses anything else', () => {
        expect(parseRepository('octo/site')).toEqual({ owner: 'octo', name: 'site' })
        for (const value of ['site', 'octo/site/x', '/site', 'octo/', 'octo/a b', '-octo/site']) {
            expect(() => parseRepository(value)).toThrow('"repository" must be owner/name')
        }
    })

    it('reading or writing a malformed repository fails naming the file', async () => {
        const site = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-repo-cfg-'))
        try {
            await expect(writePublishConfig({ repository: 'site' }, site)).rejects.toThrow('config/publish.yaml: "repository" must be owner/name')
            await fs.mkdir(path.join(site, 'config'))
            await fs.writeFile(path.join(site, 'config', 'publish.yaml'), 'repository: just-a-name\n')
            await expect(readPublishConfig(site)).rejects.toThrow('config/publish.yaml: "repository" must be owner/name')
        } finally {
            await fs.rm(site, { recursive: true, force: true })
        }
    })
})
