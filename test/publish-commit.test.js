import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFile } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import {
    commitAndPush,
    listPublishFiles,
    hasGit,
    blobSha,
    gitAuthEnv,
    ALWAYS_EXCLUDED,
    PUBLISH_STATE,
    DEFAULT_MESSAGE,
} from '../src/publish/commit.js'
import { createGitHubClient, GITHUB_API } from '../src/publish/github.js'

// Committing and pushing the site for `nera publish` (ROADMAP-ai.md L6 step
// 5). The git path runs the real `git` against a local bare repository
// standing in for GitHub; the API path talks to an in-memory Git Data API
// behind the real github.js client. No test uses the network or a real
// token.

const execFileAsync = promisify(execFile)
const TOKEN = 'ghu_fake_access_token'
const REPOSITORY = 'octo/site'
const USER = { login: 'octo', id: 4242 }
const TEMPLATE_GITIGNORE = path.resolve('template/_gitignore')
// Each git test runs a few dozen git processes.
const GIT_TIMEOUT = 30_000

// What every site fixture publishes (the rest is ignored or excluded).
const PUBLISHED = [
    '.gitignore',
    'assets/css/main.css',
    'bin/deploy.sh',
    'config/app.yaml',
    'pages/index.md',
]

let tmp
let site
let gitEnv

beforeEach(async () => {
    tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nera-commit-')))
    site = path.join(tmp, 'site')
    // No global or system git config: no identity, no credential helper.
    await fs.writeFile(path.join(tmp, 'gitconfig'), '')
    gitEnv = { ...process.env, HOME: tmp, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }
    await makeSite(site)
})

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true })
})

async function write(file, content = '') {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content)
}

// A scaffolded site with its build output, dependencies and secrets beside it.
async function makeSite(dir) {
    await write(path.join(dir, '.gitignore'), await fs.readFile(TEMPLATE_GITIGNORE, 'utf-8'))
    await write(path.join(dir, 'pages/index.md'), '---\nlayout: pages/default.pug\n---\n# Hello\n')
    await write(path.join(dir, 'config/app.yaml'), 'name: Site\n')
    await write(path.join(dir, 'assets/css/main.css'), 'body { color: red }\n')
    await write(path.join(dir, 'bin/deploy.sh'), '#!/bin/sh\necho hi\n')
    await fs.chmod(path.join(dir, 'bin/deploy.sh'), 0o755)
    await write(path.join(dir, 'node_modules/pkg/index.js'), 'export {}\n')
    await write(path.join(dir, 'public/index.html'), '<h1>Hello</h1>\n')
    await write(path.join(dir, '.env'), `TOKEN=${TOKEN}\n`)
    await write(path.join(dir, '.vite/deps.json'), '{}\n')
    await write(path.join(dir, '.nera-cache/images/a.webp'), 'x')
}

async function git(cwd, args) {
    const { stdout } = await execFileAsync('git', args, { cwd, env: gitEnv })
    return stdout.trim()
}

// A bare repository with one auto-init commit (README.md), like GitHub
// creates with `auto_init`. Returns its path and that commit's sha.
async function makeRemote() {
    const bare = path.join(tmp, 'remote.git')
    await execFileAsync('git', ['init', '-q', '--bare', '-b', 'main', bare], { env: gitEnv })
    const seed = path.join(tmp, 'seed')
    await execFileAsync('git', ['clone', '-q', bare, seed], { env: gitEnv })
    await write(path.join(seed, 'README.md'), '# site\n')
    await git(seed, ['add', '-A'])
    await git(seed, ['-c', 'user.name=GitHub', '-c', 'user.email=noreply@github.com', 'commit', '-q', '-m', 'Initial commit'])
    await git(seed, ['push', '-q', 'origin', 'HEAD:main'])
    return { bare, initial: await git(bare, ['rev-parse', 'main']), seed }
}

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

// A github.js client whose only route is the branch ref, read from `bare`.
function bareClient(bare) {
    const fetch = async (url, init) => {
        if (init.method === 'GET' && url === `${GITHUB_API}/repos/${REPOSITORY}/git/ref/heads/main`) {
            const sha = await git(bare, ['rev-parse', '--verify', '-q', 'main']).catch(() => null)
            return sha ? jsonResponse(200, { object: { sha } }) : jsonResponse(409, { message: 'Git Repository is empty.' })
        }
        return jsonResponse(404, { message: 'Not Found' })
    }
    return createGitHubClient({ token: TOKEN, fetch })
}

// execFile, recording every git call's argv and environment.
function recordingExec() {
    const calls = []
    const exec = (file, args, options) => {
        calls.push({ file, args, env: options?.env })
        return execFileAsync(file, args, options)
    }
    return { exec, calls }
}

function recorder() {
    const lines = []
    return { lines, log: (line) => lines.push(line) }
}

const gitPublish = (bare, extra = {}) => commitAndPush({
    client: bareClient(bare),
    token: TOKEN,
    repository: REPOSITORY,
    user: USER,
    cwd: site,
    useGit: true,
    env: gitEnv,
    remoteUrl: bare,
    log: () => {},
    ...extra,
})

const remoteFiles = async (bare) => (await git(bare, ['ls-tree', '-r', '--name-only', 'main'])).split('\n').sort()
const readState = async () => JSON.parse(await fs.readFile(path.join(site, PUBLISH_STATE), 'utf-8'))

describe('commitAndPush with git', { timeout: GIT_TIMEOUT }, () => {
    it('first publish: git init, origin, commit with the noreply identity, replaces the auto-init commit', async () => {
        const { bare, initial } = await makeRemote()
        const { log, lines } = recorder()
        const result = await gitPublish(bare, { created: true, log })

        expect(result.method).toBe('git')
        expect(result.changed).toBe(true)
        expect(await git(bare, ['rev-parse', 'main'])).toBe(result.sha)
        expect(await git(site, ['rev-parse', 'HEAD'])).toBe(result.sha)
        expect(await git(site, ['symbolic-ref', '--short', 'HEAD'])).toBe('main')
        expect(await git(site, ['remote', 'get-url', 'origin'])).toBe(bare)
        // The lease replaced the auto-init commit instead of building on it.
        expect(await git(bare, ['rev-list', '--count', 'main'])).toBe('1')
        expect(await git(bare, ['merge-base', '--is-ancestor', initial, 'main']).catch(() => 'not an ancestor')).toBe('not an ancestor')
        expect(await remoteFiles(bare)).toEqual(PUBLISHED)
        expect(await git(bare, ['log', '-1', '--format=%an <%ae>|%s', 'main'])).toBe(`octo <4242+octo@users.noreply.github.com>|${DEFAULT_MESSAGE}`)
        expect(await git(bare, ['ls-tree', 'main', 'bin/deploy.sh'])).toMatch(/^100755 /)
        expect(await git(site, ['rev-parse', 'origin/main'])).toBe(result.sha)
        expect(await readState()).toEqual({ repository: REPOSITORY, sha: result.sha })
        expect(lines).toEqual(['Created a git repository in this folder.', 'Committed the site.', `Pushed the site to https://github.com/${REPOSITORY}`])
    })

    it('later publish: commits the change on top; nothing changed is not an error', async () => {
        const { bare } = await makeRemote()
        const first = await gitPublish(bare, { created: true })

        await write(path.join(site, 'pages/index.md'), '---\nlayout: pages/default.pug\n---\n# Changed\n')
        const second = await gitPublish(bare)
        expect(second.changed).toBe(true)
        expect(await git(bare, ['rev-parse', 'main^'])).toBe(first.sha)
        expect(await git(bare, ['show', 'main:pages/index.md'])).toMatch(/# Changed/)

        const { log, lines } = recorder()
        const third = await gitPublish(bare, { log })
        expect(third).toEqual({ method: 'git', changed: false, sha: second.sha })
        expect(await git(bare, ['rev-parse', 'main'])).toBe(second.sha)
        expect(lines).toEqual(['Nothing changed since the last publish.'])
    })

    it('pushes a commit an earlier publish made but could not push', async () => {
        const { bare, initial } = await makeRemote()
        await git(site, ['init', '-q', '-b', 'main'])
        await git(site, ['add', '-A'])
        await git(site, ['-c', 'user.name=Me', '-c', 'user.email=me@example.com', 'commit', '-q', '-m', 'Mine'])
        await fs.mkdir(path.join(site, '.nera-cache'), { recursive: true })
        await fs.writeFile(path.join(site, PUBLISH_STATE), JSON.stringify({ repository: REPOSITORY, sha: initial }))

        const result = await gitPublish(bare)
        expect(result.changed).toBe(true)
        expect(await git(bare, ['log', '-1', '--format=%s', 'main'])).toBe('Mine')
    })

    it('uses the git identity when one is configured', async () => {
        const { bare } = await makeRemote()
        await git(site, ['init', '-q', '-b', 'main'])
        await git(site, ['config', 'user.name', 'Ada'])
        await git(site, ['config', 'user.email', 'ada@example.com'])
        await gitPublish(bare, { created: true, message: 'Publish' })
        expect(await git(bare, ['log', '-1', '--format=%an <%ae>|%s', 'main'])).toBe('Ada <ada@example.com>|Publish')
    })

    it('never commits node_modules, public, .env or .nera-cache, even without a .gitignore', async () => {
        const { bare } = await makeRemote()
        await fs.rm(path.join(site, '.gitignore'))
        await gitPublish(bare, { created: true })
        const files = await remoteFiles(bare)
        for (const excluded of ALWAYS_EXCLUDED) {
            expect(files.some((file) => file === excluded || file.startsWith(`${excluded}/`))).toBe(false)
        }
        expect(files).toContain('.vite/deps.json')
    })

    it('refuses when the remote changed elsewhere, and leaves it alone', async () => {
        const { bare, seed } = await makeRemote()
        await gitPublish(bare, { created: true })
        await git(seed, ['fetch', '-q', 'origin'])
        await git(seed, ['reset', '-q', '--hard', 'origin/main'])
        await write(path.join(seed, 'NOTE.md'), 'edited on GitHub\n')
        await git(seed, ['add', '-A'])
        await git(seed, ['-c', 'user.name=Other', '-c', 'user.email=o@example.com', 'commit', '-q', '-m', 'Elsewhere'])
        await git(seed, ['push', '-q', 'origin', 'HEAD:main'])
        const moved = await git(bare, ['rev-parse', 'main'])

        await write(path.join(site, 'pages/index.md'), '# Local change\n')
        const error = await gitPublish(bare).catch((err) => err)
        expect(error.code).toBe('remote-moved')
        expect(error.message).toMatch(/changed somewhere else since the last publish/)
        expect(error.message).toMatch(/git pull origin main/)
        expect(await git(bare, ['rev-parse', 'main'])).toBe(moved)
    })

    it('reports a push GitHub rejects because of a commit made meanwhile as a moved remote', async () => {
        const { bare, seed } = await makeRemote()
        await gitPublish(bare, { created: true })
        await write(path.join(site, 'pages/index.md'), '# Local change\n')
        // Someone pushes between our read of the remote head and our push.
        const exec = async (file, args, options) => {
            if (args[0] === 'push') {
                await git(seed, ['fetch', '-q', 'origin'])
                await git(seed, ['reset', '-q', '--hard', 'origin/main'])
                await write(path.join(seed, 'NOTE.md'), 'race\n')
                await git(seed, ['add', '-A'])
                await git(seed, ['-c', 'user.name=Other', '-c', 'user.email=o@example.com', 'commit', '-q', '-m', 'Race'])
                await git(seed, ['push', '-q', 'origin', 'HEAD:main'])
            }
            return execFileAsync(file, args, options)
        }
        const error = await gitPublish(bare, { exec, env: { ...gitEnv, LANG: 'de_DE.UTF-8' } }).catch((err) => err)
        expect(error.code).toBe('remote-moved')
        expect(await git(bare, ['log', '-1', '--format=%s', 'main'])).toBe('Race')
    })

    it('refuses an unrelated remote it has no record of', async () => {
        const { bare } = await makeRemote()
        const error = await gitPublish(bare).catch((err) => err)
        expect(error.code).toBe('remote-moved')
        expect(error.message).toMatch(/Nothing was published from this folder to it before.*--allow-unrelated-histories/)
        expect(await git(bare, ['rev-list', '--count', 'main'])).toBe('1')
    })

    it('keeps the token out of argv, .git/config and the remote URL', async () => {
        const { bare } = await makeRemote()
        const { exec, calls } = recordingExec()
        await gitPublish(bare, { created: true, exec })

        const basic = Buffer.from(`x-access-token:${TOKEN}`).toString('base64')
        for (const call of calls) {
            expect(call.args.join(' ')).not.toContain(TOKEN)
            expect(call.args.join(' ')).not.toContain(basic)
        }
        const push = calls.find((call) => call.args[0] === 'push')
        expect(push.env).toMatchObject(gitAuthEnv(TOKEN))
        expect(push.env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader')
        expect(push.env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${basic}`)
        expect(push.env.GIT_TERMINAL_PROMPT).toBe('0')
        // Only the push carries the header.
        expect(calls.filter((call) => call.env?.GIT_CONFIG_VALUE_0)).toEqual([push])

        const config = await fs.readFile(path.join(site, '.git/config'), 'utf-8')
        expect(config).not.toContain(TOKEN)
        expect(config).not.toContain(basic)
        expect(await git(site, ['remote', 'get-url', 'origin'])).toBe(bare)
        expect(await remoteFiles(bare)).not.toContain('.env')
    })

    it('accepts an origin that names the same GitHub repository', async () => {
        const { bare } = await makeRemote()
        await git(site, ['init', '-q', '-b', 'main'])
        await git(site, ['remote', 'add', 'origin', 'git@github.com:Octo/site.git'])
        const result = await gitPublish(bare, { created: true })
        expect(result.changed).toBe(true)
        expect(await git(site, ['remote', 'get-url', 'origin'])).toBe('git@github.com:Octo/site.git')
    })

    it('refuses rather than rewrites an origin pointing elsewhere', async () => {
        const { bare } = await makeRemote()
        await git(site, ['init', '-q', '-b', 'main'])
        await git(site, ['remote', 'add', 'origin', 'https://me:secret@gitlab.com/me/site.git'])
        const error = await gitPublish(bare, { created: true }).catch((err) => err)
        expect(error.message).toMatch(/points to https:\/\/gitlab\.com\/me\/site\.git, not octo\/site/)
        expect(error.message).not.toContain('secret')
        expect(await git(site, ['remote', 'get-url', 'origin'])).toBe('https://me:secret@gitlab.com/me/site.git')
        expect(await git(bare, ['rev-list', '--count', 'main'])).toBe('1')
    })

    it('refuses a branch other than main', async () => {
        const { bare } = await makeRemote()
        await git(site, ['init', '-q', '-b', 'master'])
        const error = await gitPublish(bare, { created: true }).catch((err) => err)
        expect(error.message).toMatch(/publishes the branch main, but this folder is on "master".*git branch -m master main/)
    })

    it('refuses a site inside another git repository', async () => {
        const { bare } = await makeRemote()
        await git(tmp, ['init', '-q', '-b', 'main'])
        const error = await gitPublish(bare, { created: true }).catch((err) => err)
        expect(error.message).toMatch(/inside another git repository/)
        await expect(fs.access(path.join(site, '.git'))).rejects.toThrow()
    })
})

// An in-memory GitHub Git Data API for `octo/site`. Object ids are
// content hashes; the ref update enforces fast-forward unless forced.
function fakeGitData() {
    const objects = new Map()
    const refs = {}
    const requests = []
    const hash = (value) => createHash('sha1').update(JSON.stringify(value)).digest('hex')
    const addCommit = (tree, parents, message) => {
        const sha = hash({ tree, parents, message, n: objects.size })
        objects.set(sha, { type: 'commit', tree, parents, message })
        return sha
    }
    const addTree = (entries) => {
        const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))
        const sha = hash(sorted)
        objects.set(sha, { type: 'tree', entries: sorted })
        return sha
    }
    const addBlob = (content) => {
        const sha = blobSha(content)
        objects.set(sha, { type: 'blob', content })
        return sha
    }
    const isAncestor = (ancestor, sha) => sha === ancestor || objects.get(sha).parents.some((p) => isAncestor(ancestor, p))

    const base = `/repos/${REPOSITORY}`
    const fetch = async (url, init) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        const body = init.body === undefined ? undefined : JSON.parse(init.body)
        requests.push({ route, body })
        let match
        if (route === `GET ${base}/git/ref/heads/main`) {
            if (!refs.main) return jsonResponse(409, { message: 'Git Repository is empty.' })
            return jsonResponse(200, { object: { sha: refs.main } })
        }
        if ((match = route.match(/^GET .*\/git\/commits\/(\w+)$/))) {
            const commit = objects.get(match[1])
            return jsonResponse(200, { sha: match[1], tree: { sha: commit.tree }, parents: commit.parents.map((sha) => ({ sha })) })
        }
        if ((match = route.match(/^GET .*\/git\/trees\/(\w+)\?recursive=1$/))) {
            return jsonResponse(200, { sha: match[1], tree: objects.get(match[1]).entries, truncated: false })
        }
        if (route === `POST ${base}/git/blobs`) {
            if (!refs.main) return jsonResponse(409, { message: 'Git Repository is empty.' })
            return jsonResponse(201, { sha: addBlob(Buffer.from(body.content, 'base64')) })
        }
        if (route === `POST ${base}/git/trees`) {
            for (const entry of body.tree) {
                if (!objects.has(entry.sha)) return jsonResponse(422, { message: `Invalid tree info: ${entry.sha}` })
            }
            return jsonResponse(201, { sha: addTree(body.tree) })
        }
        if (route === `POST ${base}/git/commits`) {
            return jsonResponse(201, { sha: addCommit(body.tree, body.parents, body.message) })
        }
        if (route === `PATCH ${base}/git/refs/heads/main`) {
            if (!body.force && !isAncestor(refs.main, body.sha)) return jsonResponse(422, { message: 'Update is not a fast forward' })
            refs.main = body.sha
            return jsonResponse(200, { object: { sha: body.sha } })
        }
        if (route === `PUT ${base}/contents/.nera-publish`) {
            const blob = addBlob(Buffer.from(body.content, 'base64'))
            refs.main = addCommit(addTree([{ path: '.nera-publish', mode: '100644', type: 'blob', sha: blob }]), [], body.message)
            return jsonResponse(201, { commit: { sha: refs.main } })
        }
        return jsonResponse(404, { message: 'Not Found' })
    }

    // The auto-init commit GitHub makes for a new repository.
    const autoInit = () => {
        const readme = addBlob(Buffer.from('# site\n'))
        refs.main = addCommit(addTree([{ path: 'README.md', mode: '100644', type: 'blob', sha: readme }]), [], 'Initial commit')
        return refs.main
    }
    // The files of the commit `sha`, as { path: { mode, content } }.
    const filesOf = (sha) => Object.fromEntries(objects.get(objects.get(sha).tree).entries.map((entry) =>
        [entry.path, { mode: entry.mode, content: objects.get(entry.sha).content.toString() }]))

    return { client: createGitHubClient({ token: TOKEN, fetch }), fetch, refs, objects, requests, autoInit, filesOf, addCommit, addTree }
}

const apiPublish = (github, extra = {}) => commitAndPush({
    client: github.client,
    token: TOKEN,
    repository: REPOSITORY,
    user: USER,
    cwd: site,
    useGit: false,
    log: () => {},
    ...extra,
})

const routes = (github, prefix) => github.requests.filter((request) => request.route.startsWith(prefix))

describe('commitAndPush through the GitHub API', () => {
    it('first publish: a full tree of the admitted files on the auto-init commit, without force', async () => {
        const github = fakeGitData()
        const initial = github.autoInit()
        const result = await apiPublish(github, { created: true })

        expect(result.method).toBe('api')
        expect(result.changed).toBe(true)
        expect(github.refs.main).toBe(result.sha)
        expect(github.objects.get(result.sha).parents).toEqual([initial])
        const files = github.filesOf(result.sha)
        expect(Object.keys(files).sort()).toEqual(PUBLISHED)
        expect(files['pages/index.md'].content).toMatch(/# Hello/)
        expect(files['bin/deploy.sh'].mode).toBe('100755')
        expect(files['config/app.yaml'].mode).toBe('100644')
        expect(routes(github, 'PATCH')[0].body).toEqual({ sha: result.sha, force: false })
        expect(await readState()).toEqual({ repository: REPOSITORY, sha: result.sha })
        expect(JSON.stringify(github.requests)).not.toContain(TOKEN)
    })

    it('later publish uploads only the changed blob; nothing changed makes no commit', async () => {
        const github = fakeGitData()
        github.autoInit()
        const first = await apiPublish(github, { created: true })
        expect(routes(github, 'POST /repos/octo/site/git/blobs')).toHaveLength(PUBLISHED.length)

        github.requests.length = 0
        await write(path.join(site, 'pages/index.md'), '# Changed\n')
        const second = await apiPublish(github)
        expect(second.changed).toBe(true)
        expect(github.objects.get(second.sha).parents).toEqual([first.sha])
        expect(routes(github, 'POST /repos/octo/site/git/blobs')).toHaveLength(1)
        expect(github.filesOf(second.sha)['pages/index.md'].content).toBe('# Changed\n')

        github.requests.length = 0
        const third = await apiPublish(github)
        expect(third).toEqual({ method: 'api', changed: false, sha: second.sha })
        expect(routes(github, 'POST /repos/octo/site/git/commits')).toEqual([])
        expect(routes(github, 'PATCH')).toEqual([])
        expect(github.refs.main).toBe(second.sha)
    })

    it('refuses when the remote head is not the recorded one, before uploading anything', async () => {
        const github = fakeGitData()
        github.autoInit()
        const first = await apiPublish(github, { created: true })
        github.refs.main = github.addCommit(github.objects.get(first.sha).tree, [first.sha], 'Elsewhere')
        const moved = github.refs.main

        github.requests.length = 0
        const error = await apiPublish(github).catch((err) => err)
        expect(error.code).toBe('remote-moved')
        expect(error.message).toMatch(/changed somewhere else since the last publish.*install git and pull them/)
        expect(github.requests.map((request) => request.route)).toEqual([`GET /repos/${REPOSITORY}/git/ref/heads/main`])
        expect(github.refs.main).toBe(moved)
    })

    it('refuses a repository with commits it has no record of', async () => {
        const github = fakeGitData()
        github.autoInit()
        const error = await apiPublish(github).catch((err) => err)
        expect(error.message).toMatch(/already has commits, and this folder has no record of publishing them/)
        expect(routes(github, 'POST')).toEqual([])
    })

    it('reports a ref update GitHub rejects as a moved remote', async () => {
        const github = fakeGitData()
        const initial = github.autoInit()
        const patch = github.client.patch
        github.client.patch = async (...args) => {
            // Someone pushes between our read and our update.
            github.refs.main = github.addCommit(github.objects.get(initial).tree, [initial], 'Race')
            return patch(...args)
        }
        const error = await apiPublish(github, { created: true }).catch((err) => err)
        expect(error.code).toBe('remote-moved')
    })

    it('starts an empty repository through the contents API, then publishes the full tree', async () => {
        const github = fakeGitData()
        const result = await apiPublish(github, { created: true })
        expect(result.changed).toBe(true)
        expect(Object.keys(github.filesOf(result.sha)).sort()).toEqual(PUBLISHED)
        expect(routes(github, 'PUT')).toHaveLength(1)
    })

    it('publishes on a retry after a failure that followed starting an empty repository', async () => {
        const github = fakeGitData()
        let failed = false
        const flaky = createGitHubClient({ token: TOKEN, fetch: async (url, init) => {
            if (!failed && init.method === 'POST' && url.endsWith('/git/trees')) {
                failed = true
                return jsonResponse(500, { message: 'Server Error' })
            }
            return github.fetch(url, init)
        } })
        await expect(apiPublish(github, { client: flaky, created: true })).rejects.toThrow()
        const result = await apiPublish(github)
        expect(result.changed).toBe(true)
        expect(Object.keys(github.filesOf(result.sha)).sort()).toEqual(PUBLISHED)
        expect(routes(github, 'PUT')).toHaveLength(1)
    })
})

describe('listPublishFiles', { timeout: GIT_TIMEOUT }, () => {
    // What git itself would add from `dir`: untracked, not ignored, with no
    // global excludes, minus what commitAndPush always leaves out.
    async function gitWouldAdd(dir) {
        await git(dir, ['init', '-q', '-b', 'main'])
        const listed = (await git(dir, ['-c', 'core.excludesFile=/dev/null', 'ls-files', '--others', '--exclude-standard'])).split('\n')
        return listed.filter((file) => file && !ALWAYS_EXCLUDED.some((top) => file === top || file.startsWith(`${top}/`))).sort()
    }

    it('agrees with git for the scaffold\'s .gitignore', async () => {
        await write(path.join(site, '.env.local'), 'x')
        await write(path.join(site, '.npmrc'), 'x')
        await write(path.join(site, 'pages/blog/.vite/x'), 'x')
        await write(path.join(site, 'theme/node_modules/x.js'), 'x')
        await write(path.join(site, 'theme/views/public/x.pug'), 'x')
        await write(path.join(site, 'pages/public.md'), 'x')
        const ours = await listPublishFiles(site)
        expect(ours).toEqual(await gitWouldAdd(site))
        expect(ours).toContain('pages/public.md')
        expect(ours).not.toContain('.npmrc')
    })

    it('agrees with git for anchored, directory-only, negated, globbed and nested patterns', async () => {
        const dir = path.join(tmp, 'patterns')
        await write(path.join(dir, '.gitignore'), [
            '# a comment',
            '*.log',
            '!keep.log',
            '/build',
            'cache/',
            'docs/**/draft.md',
            'tmp*',
            '\\#literal',
            'trailing\\ ',
            '',
        ].join('\n'))
        for (const file of [
            'a.log', 'keep.log', 'sub/b.log', 'sub/keep.log',
            'build/out.js', 'sub/build/kept.js',
            'cache/x', 'sub/cache/y', 'cachefile',
            'docs/draft.md', 'docs/a/b/draft.md', 'docs/final.md',
            'tmp.txt', 'sub/tmpdir/z', 'atmp',
            '#literal', 'trailing ', 'normal.md', 'sub.md',
            'nested/.gitignore', 'nested/secret.txt', 'nested/important.log', 'nested/deeper/secret.txt', 'nested/plain.md',
        ]) {
            await write(path.join(dir, file), file === 'nested/.gitignore' ? 'secret.txt\n!important.log\n' : 'x')
        }
        await fs.symlink('normal.md', path.join(dir, 'link.md'))
        const ours = await listPublishFiles(dir)
        expect(ours).toEqual(await gitWouldAdd(dir))
        expect(ours).toContain('nested/important.log')
        expect(ours).toContain('link.md')
        expect(ours).not.toContain('nested/deeper/secret.txt')
    })
})

describe('hasGit', () => {
    it('is false when the git executable is missing', async () => {
        const missing = async () => {
            throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
        }
        expect(await hasGit({ exec: missing })).toBe(false)
        expect(await hasGit()).toBe(true)
    })
})
