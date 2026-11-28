import { createHash } from 'node:crypto'
import { blobSha } from '../../src/publish/commit.js'
import { createGitHubClient, GITHUB_API } from '../../src/publish/github.js'

// Test doubles for the GitHub side of `nera publish`, shared by the publish
// tests. No network: each is a `fetch` stand-in, and every token is fake.

export const FAKE_TOKEN = 'ghu_fake_access_token'

// The start of every fake clock: a fixed instant, far from the epoch.
export const START = 1_800_000_000_000

const FORM = 'application/x-www-form-urlencoded'

// A fetch Response stand-in with a JSON body (none for `undefined`).
export const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

// A stub GitHub behind the real github.js client. `routes` maps
// "METHOD /path" (the path below api.github.com, or the whole url for any
// other host, as for the OAuth endpoints on github.com) to a
// handler(body, request) returning [status, json]; a list of handlers is a
// queue whose last one repeats. A route without a handler goes to
// `fallback(url, init)` when given, else answers 404. Every request is
// recorded as { url, route, init, raw, body, form }: `raw` is the body as
// sent, `body` its parsed JSON or form fields, `form` the fields of a form
// post only.
export function fakeGitHub(routes = {}, { token = FAKE_TOKEN, fallback } = {}) {
    const requests = []
    const fetch = async (url, init = {}) => {
        const method = init.method ?? 'GET'
        const route = url.startsWith(GITHUB_API)
            ? `${method} ${url.slice(GITHUB_API.length)}`
            : `${method} ${url}`
        const raw = init.body
        const isForm = init.headers?.['Content-Type'] === FORM
        const parsed = isForm
            ? Object.fromEntries(new URLSearchParams(raw))
            : raw === undefined ? undefined : JSON.parse(raw)
        const form = isForm ? parsed : undefined
        const request = { url, route, init, raw, body: parsed, form }
        requests.push(request)
        let handler = routes[route]
        if (Array.isArray(handler)) {
            handler = handler.length > 1 ? handler.shift() : handler[0]
        }
        if (!handler) {
            return fallback
                ? fallback(url, init)
                : jsonResponse(404, { message: 'Not Found' })
        }
        const [status, json] = handler(parsed, request)
        return jsonResponse(status, json)
    }
    return { client: createGitHubClient({ token, fetch }), fetch, requests }
}

// A clock that advances only when slept (or by `advance`); `sleeps`
// records every wait.
export function fakeClock(start = START) {
    let time = start
    const sleeps = []
    return {
        now: () => time,
        sleep: async (ms) => {
            sleeps.push(ms)
            time += ms
        },
        advance: (ms) => {
            time += ms
        },
        sleeps,
    }
}

// A `log` that records its lines.
export function recorder() {
    const lines = []
    return { lines, log: (line) => lines.push(line) }
}

// An in-memory GitHub Git Data API for `repository`. Object ids are
// content hashes; the ref update enforces fast-forward unless forced. Any
// other route answers 404.
export function fakeGitData({ repository = 'octo/site', token = FAKE_TOKEN } = {}) {
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
    const isAncestor = (ancestor, sha) =>
        sha === ancestor || objects.get(sha).parents.some((p) => isAncestor(ancestor, p))

    const base = `/repos/${repository}`
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
            const parents = commit.parents.map((sha) => ({ sha }))
            return jsonResponse(200, { sha: match[1], tree: { sha: commit.tree }, parents })
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

    const client = createGitHubClient({ token, fetch })
    return { client, fetch, refs, objects, requests, autoInit, filesOf, addCommit, addTree }
}
