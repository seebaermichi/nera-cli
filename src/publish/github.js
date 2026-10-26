// The one GitHub client of `nera publish` (ROADMAP-ai.md L6, D2): a few
// helpers over `fetch`, no Octokit. `fetch` is injectable, so tests stub it
// and never reach the network. The token travels in the Authorization header
// only; no error message built here contains a token or a device code.

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_WEB = 'https://github.com'
export const API_VERSION = '2022-11-28'
const USER_AGENT = 'nera-cli'

// A failed GitHub call. `status` is the HTTP status (0 when GitHub could not
// be reached), `code` the OAuth error code when GitHub sent one.
export class GitHubError extends Error {
    constructor(message, { status = 0, code } = {}) {
        super(message)
        this.name = 'GitHubError'
        this.status = status
        if (code !== undefined) this.code = code
    }
}

// `text` with every secret replaced by "***"; a guard for messages that
// quote something GitHub or fetch sent back.
export function redact(text, secrets = []) {
    let result = String(text)
    for (const secret of secrets) {
        if (typeof secret === 'string' && secret !== '') result = result.split(secret).join('***')
    }
    return result
}

// The response body as JSON, or null when it is empty or not JSON.
async function readJson(response) {
    const text = await response.text()
    if (text === '') return null
    try {
        return JSON.parse(text)
    } catch {
        return null
    }
}

// Call fetch, turning a network failure into a GitHubError with status 0.
async function send(fetchImpl, url, init, secrets) {
    try {
        return await fetchImpl(url, init)
    } catch (err) {
        throw new GitHubError(redact(`Could not reach GitHub: ${err.message}`, secrets))
    }
}

// POST form `params` to an OAuth endpoint on github.com (device code, access
// token, refresh) and return the JSON answer. GitHub reports OAuth errors such
// as `authorization_pending` with status 200 and an `error` field, which the
// caller reads; only an HTTP failure throws here.
export async function postOAuth(path, params, { fetch: fetchImpl = globalThis.fetch } = {}) {
    const secrets = Object.values(params)
    const response = await send(fetchImpl, `${GITHUB_WEB}${path}`, {
        method: 'POST',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams(params).toString(),
    }, secrets)
    const data = await readJson(response)
    if (!response.ok || data === null) {
        const detail = data?.error_description ?? data?.error ?? response.statusText
        throw new GitHubError(redact(`GitHub sign-in failed: ${response.status} ${detail}`.trim(), secrets), {
            status: response.status,
            code: data?.error,
        })
    }
    return data
}

// A REST client for api.github.com acting with `token`. `request(method,
// path, body?)` resolves the parsed JSON (null for an empty answer such as
// 204) and throws a GitHubError naming the call and GitHub's message for any
// status outside 2xx; get/post/put/patch/delete are shorthands.
export function createGitHubClient({ token, fetch: fetchImpl = globalThis.fetch } = {}) {
    if (typeof token !== 'string' || token === '') {
        throw new TypeError('createGitHubClient needs a token')
    }
    const secrets = [token]

    async function request(method, path, body) {
        const headers = {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'User-Agent': USER_AGENT,
            'X-GitHub-Api-Version': API_VERSION,
        }
        const init = { method, headers }
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json'
            init.body = JSON.stringify(body)
        }
        const response = await send(fetchImpl, `${GITHUB_API}${path}`, init, secrets)
        const data = await readJson(response)
        if (!response.ok) {
            const detail = data?.message ?? response.statusText
            throw new GitHubError(redact(`GitHub answered ${response.status} to ${method} ${path}: ${detail}`, secrets), {
                status: response.status,
            })
        }
        return data
    }

    return {
        request,
        get: (path) => request('GET', path),
        post: (path, body) => request('POST', path, body),
        put: (path, body) => request('PUT', path, body),
        patch: (path, body) => request('PATCH', path, body),
        delete: (path) => request('DELETE', path),
    }
}
