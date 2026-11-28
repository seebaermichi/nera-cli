import { redact } from './github.js'

// The one Netlify client of `nera publish`: a few helpers over `fetch`, no
// `netlify` js-client. `fetch` is injectable, so tests stub it and never
// reach the network. The token travels in the Authorization header only, and
// every error message built here is redacted against the token and the
// caller's other secrets (a sign-in ticket id is one: whoever holds an
// authorized ticket can exchange it for a token).

export { redact }

export const NETLIFY_API = 'https://api.netlify.com/api/v1'
export const NETLIFY_WEB = 'https://app.netlify.com'
const USER_AGENT = 'nera-cli'

// A failed Netlify call. `status` is the HTTP status (0 when Netlify could
// not be reached).
export class NetlifyError extends Error {
    constructor(message, { status = 0 } = {}) {
        super(message)
        this.name = 'NetlifyError'
        this.status = status
    }
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

// A REST client for api.netlify.com. `token` is optional: the sign-in
// ticket endpoints are called without one. `secrets` are further values no
// error message may contain. `request(method, path, body?)` resolves the
// parsed JSON (null for an empty answer) and throws a NetlifyError naming the
// call and Netlify's message for any status outside 2xx; get/post/put/patch/
// delete are shorthands.
export function createNetlifyClient({ token, secrets = [], fetch: fetchImpl = globalThis.fetch } = {}) {
    if (token !== undefined && (typeof token !== 'string' || token === '')) {
        throw new TypeError('createNetlifyClient needs a non-empty token or none')
    }
    const hidden = token ? [token, ...secrets] : [...secrets]

    async function request(method, path, body) {
        const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT }
        if (token) headers.Authorization = `Bearer ${token}`
        const init = { method, headers }
        if (body !== undefined) {
            headers['Content-Type'] = 'application/json'
            init.body = JSON.stringify(body)
        }

        let response
        try {
            response = await fetchImpl(`${NETLIFY_API}${path}`, init)
        } catch (err) {
            throw new NetlifyError(redact(`Could not reach Netlify: ${err.message}`, hidden))
        }
        const data = await readJson(response)
        if (!response.ok) {
            // Netlify sends { code, message } or { errors: { field: [..] } }.
            const detail = data?.message ?? data?.error ?? response.statusText
            const message = `Netlify answered ${response.status} to ${method} ${path}: ${detail}`
            throw new NetlifyError(redact(message, hidden), { status: response.status })
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
