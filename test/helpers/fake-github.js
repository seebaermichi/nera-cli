import { createHash } from 'crypto'
import { blobSha } from '../../src/publish/commit.js'
import { createGitHubClient, GITHUB_API } from '../../src/publish/github.js'

// Test doubles for the GitHub side of `nera publish`, shared by the commit
// and the end-to-end tests. No network: each is a `fetch` stand-in.

// A fetch Response stand-in with a JSON body (none for `undefined`).
export const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

// An in-memory GitHub Git Data API for `repository`. Object ids are
// content hashes; the ref update enforces fast-forward unless forced. Any
// other route answers 404.
export function fakeGitData({ repository = 'octo/site', token = 'ghu_fake_access_token' } = {}) {
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

    return { client: createGitHubClient({ token, fetch }), fetch, refs, objects, requests, autoInit, filesOf, addCommit, addTree }
}
