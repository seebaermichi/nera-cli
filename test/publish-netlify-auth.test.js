import { describe, it, expect } from 'vitest'
import {
    signInToNetlify,
    ensureNetlifyToken,
    authorizeUrl,
    NETLIFY_CLIENT_ID,
    NETLIFY_IDENTITY_LINES,
    NETLIFY_SIGN_UP_LINE,
    SIGN_UP_PAGE,
    POLL_INTERVAL_MS,
    TICKET_TIMEOUT_MS,
} from '../src/publish/netlify-auth.js'
import { createNetlifyClient, NetlifyError, NETLIFY_API } from '../src/publish/netlify-api.js'

// Netlify sign-in for `nera publish --target netlify` (ROADMAP-ai.md L6 step
// 4, plan D1). `fetch` is a stub, the clock is fake and advanced by `sleep`,
// the browser opener is a recorder: no test touches the network, the
// keychain or a real token.

// Fake values only.
const ACCESS = 'nfp_fake_access_token'
const NEW_ACCESS = 'nfp_fake_new_access_token'
const TICKET_ID = 'fake_ticket_5f2a9c'
const EMAIL = 'me@example.com'
const SECRETS = [ACCESS, NEW_ACCESS, TICKET_ID]

const START = 1_800_000_000_000
const TICKET_PATH = `${NETLIFY_API}/oauth/tickets/${TICKET_ID}`

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

// A stub Netlify. `polls` are the answers to the ticket poll, in order:
// `true` for authorized, `false` for pending, a number for an HTTP error
// status; after the list runs out the ticket stays pending. `tokens` maps a
// bearer token to the user GET /user answers; any other token gets a 401.
function fakeNetlify({
    ticket = { id: TICKET_ID, client_id: NETLIFY_CLIENT_ID, authorized: false },
    polls = [false, true],
    exchange = { id: 'x', access_token: NEW_ACCESS, user_email: EMAIL },
    tokens = { [ACCESS]: { email: EMAIL }, [NEW_ACCESS]: { email: EMAIL } },
} = {}) {
    const requests = []
    const pollQueue = [...polls]
    const fetch = async (url, init = {}) => {
        requests.push({ url, init })
        if (url === `${NETLIFY_API}/oauth/tickets?client_id=${NETLIFY_CLIENT_ID}` && init.method === 'POST') {
            return jsonResponse(201, ticket)
        }
        if (url === TICKET_PATH && init.method === 'GET') {
            const next = pollQueue.length ? pollQueue.shift() : false
            if (typeof next === 'number') return jsonResponse(next, { code: next, message: `ticket ${TICKET_ID} not usable` })
            return jsonResponse(200, { id: TICKET_ID, authorized: next })
        }
        if (url === `${TICKET_PATH}/exchange` && init.method === 'POST') return jsonResponse(201, exchange)
        if (url === `${NETLIFY_API}/user`) {
            const token = init.headers?.Authorization?.replace(/^Bearer /, '')
            return token in tokens ? jsonResponse(200, tokens[token]) : jsonResponse(401, { code: 401, message: 'Access Denied' })
        }
        return jsonResponse(404, { message: 'Not Found' })
    }
    return { fetch, requests }
}

function fakeClock(start = START) {
    let time = start
    const sleeps = []
    return {
        now: () => time,
        sleep: async (ms) => {
            sleeps.push(ms)
            time += ms
        },
        sleeps,
    }
}

// signInToNetlify (or ensureNetlifyToken with `stored`) with stubs for
// everything; returns the logged lines, opened urls and saved token sets
// alongside its result or error.
async function run({ netlify = fakeNetlify(), clock = fakeClock(), tty = false, store = 'keychain', stored, ensure = false } = {}) {
    const lines = []
    const opened = []
    const saved = []
    const options = {
        fetch: netlify.fetch,
        sleep: clock.sleep,
        now: clock.now,
        open: (url) => opened.push(url),
        tty,
        saveToken: async (tokens) => {
            saved.push(tokens)
            return store === 'file' ? { store: 'file', file: '/home/me/.config/nera/netlify-credentials.json' } : { store: 'keychain' }
        },
        readToken: async () => stored ?? null,
        log: (line) => lines.push(line),
    }
    let result, error
    try {
        result = await (ensure ? ensureNetlifyToken(options) : signInToNetlify(options))
    } catch (err) {
        error = err
    }
    return { result, error, lines, opened, saved, netlify, clock }
}

const expectNoSecret = (text, secrets = SECRETS) => {
    for (const secret of secrets) expect(String(text)).not.toContain(secret)
}

describe('signInToNetlify', () => {
    it('creates a ticket, waits until it is authorized, exchanges and stores the token', async () => {
        const { result, error, lines, saved, netlify, clock } = await run()

        expect(error).toBeUndefined()
        expect(result).toEqual({ accessToken: NEW_ACCESS, email: EMAIL })
        expect(saved).toEqual([{ accessToken: NEW_ACCESS }])
        expect(netlify.requests.map((r) => `${r.init.method} ${r.url}`)).toEqual([
            `POST ${NETLIFY_API}/oauth/tickets?client_id=${NETLIFY_CLIENT_ID}`,
            `GET ${TICKET_PATH}`,
            `GET ${TICKET_PATH}`,
            `POST ${TICKET_PATH}/exchange`,
        ])
        // the ticket endpoints carry no token
        for (const request of netlify.requests) expect(request.init.headers.Authorization).toBeUndefined()
        expect(clock.sleeps).toEqual([POLL_INTERVAL_MS, POLL_INTERVAL_MS])
        expect(lines).toEqual([
            ...NETLIFY_IDENTITY_LINES,
            `To sign in to Netlify, open ${authorizeUrl(TICKET_ID)} and choose "Authorize".`,
            NETLIFY_SIGN_UP_LINE,
            'Waiting for you to authorize Nera CLI on Netlify…',
            `Signed in to Netlify as ${EMAIL}`,
        ])
        expectNoSecret(lines.join('\n'), [ACCESS, NEW_ACCESS])
    })

    it('ships the Nera CLI OAuth app client id and offers the sign-up page', () => {
        expect(NETLIFY_CLIENT_ID).toBe('C9Mlx3pnO6OPdAE_MA0ZnG37ukvja99SxIiyQlHreKE')
        expect(authorizeUrl(TICKET_ID)).toBe(`https://app.netlify.com/authorize?response_type=ticket&ticket=${TICKET_ID}`)
        expect(SIGN_UP_PAGE).toBe('https://app.netlify.com/signup')
        expect(NETLIFY_SIGN_UP_LINE).toContain(SIGN_UP_PAGE)
    })

    it('opens the authorize page only on a terminal', async () => {
        expect((await run({ tty: false })).opened).toEqual([])
        expect((await run({ tty: true })).opened).toEqual([authorizeUrl(TICKET_ID)])
    })

    it('says where the token went when there is no keychain', async () => {
        const { lines } = await run({ store: 'file' })
        expect(lines).toContain('No keychain is available on this computer; the Netlify sign-in is stored in /home/me/.config/nera/netlify-credentials.json (readable only by you).')
    })

    it('signs in without an email when the exchange answer has none', async () => {
        const { result, lines } = await run({ netlify: fakeNetlify({ exchange: { access_token: NEW_ACCESS } }) })
        expect(result).toEqual({ accessToken: NEW_ACCESS })
        expect(lines.at(-1)).toBe('Signed in to Netlify.')
    })

    for (const status of [401, 403, 404, 410]) {
        it(`fails clearly when the ticket poll gets ${status} (refused or expired), naming no ticket`, async () => {
            const { error, saved } = await run({ netlify: fakeNetlify({ polls: [false, status] }) })

            expect(error).toBeInstanceOf(NetlifyError)
            expect(error.status).toBe(status)
            expect(error.message).toBe('The Netlify sign-in was refused or has expired. Run nera publish again and choose "Authorize" on Netlify.')
            expect(saved).toEqual([])
            expectNoSecret(error.message)
            expectNoSecret(error.stack)
        })
    }

    it('gives up when the ticket is not authorized within the time limit', async () => {
        const { error, saved, clock, netlify } = await run({ netlify: fakeNetlify({ polls: [] }) })

        expect(error).toBeInstanceOf(NetlifyError)
        expect(error.message).toBe('The Netlify sign-in was not authorized in time. Run nera publish again for a new sign-in link.')
        expect(saved).toEqual([])
        expect(clock.now() - START).toBeGreaterThanOrEqual(TICKET_TIMEOUT_MS)
        expect(netlify.requests.filter((r) => r.url.endsWith('/exchange'))).toEqual([])
    })

    it('rethrows another poll failure redacted', async () => {
        const { error } = await run({ netlify: fakeNetlify({ polls: [500] }) })

        expect(error).toBeInstanceOf(NetlifyError)
        expect(error.status).toBe(500)
        expect(error.message).toBe('Netlify answered 500 to GET /oauth/tickets/***: ticket *** not usable')
    })

    it('fails when the ticket answer has no id', async () => {
        const { error } = await run({ netlify: fakeNetlify({ ticket: {} }) })
        expect(error.message).toBe('Netlify sign-in failed: no ticket in the answer.')
    })

    it('fails when the exchange answer has no token, storing nothing', async () => {
        const { error, saved } = await run({ netlify: fakeNetlify({ exchange: { user_email: EMAIL } }) })
        expect(error.message).toBe('Netlify sign-in failed: no token in the answer.')
        expect(saved).toEqual([])
    })
})

describe('ensureNetlifyToken', () => {
    it('returns the stored token while Netlify accepts it, without signing in', async () => {
        const { result, saved, netlify, lines } = await run({ ensure: true, stored: { accessToken: ACCESS, source: 'keychain' } })

        expect(result).toEqual({ accessToken: ACCESS, source: 'keychain', email: EMAIL })
        expect(saved).toEqual([])
        expect(lines).toEqual([])
        expect(netlify.requests.map((r) => r.url)).toEqual([`${NETLIFY_API}/user`])
        expect(netlify.requests[0].init.headers.Authorization).toBe(`Bearer ${ACCESS}`)
    })

    it('accepts NERA_NETLIFY_TOKEN as it is', async () => {
        const { result, saved } = await run({ ensure: true, stored: { accessToken: ACCESS, source: 'env' } })
        expect(result).toMatchObject({ accessToken: ACCESS, source: 'env' })
        expect(saved).toEqual([])
    })

    it('signs in when nothing is stored', async () => {
        const { result, saved } = await run({ ensure: true })
        expect(result).toEqual({ accessToken: NEW_ACCESS, email: EMAIL })
        expect(saved).toEqual([{ accessToken: NEW_ACCESS }])
    })

    it('signs in again when the stored token was revoked', async () => {
        const netlify = fakeNetlify({ tokens: { [NEW_ACCESS]: { email: EMAIL } } })
        const { result, lines, saved } = await run({ ensure: true, netlify, stored: { accessToken: ACCESS, source: 'file' } })

        expect(lines[0]).toBe('Your Netlify sign-in is no longer valid; please sign in again.')
        expect(result).toEqual({ accessToken: NEW_ACCESS, email: EMAIL })
        expect(saved).toEqual([{ accessToken: NEW_ACCESS }])
        expectNoSecret(lines.join('\n'), [ACCESS, NEW_ACCESS])
    })

    it('fails on a refused NERA_NETLIFY_TOKEN instead of signing in, naming no token', async () => {
        const netlify = fakeNetlify({ tokens: {} })
        const { error, saved, netlify: stub } = await run({ ensure: true, netlify, stored: { accessToken: ACCESS, source: 'env' } })

        expect(error).toBeInstanceOf(NetlifyError)
        expect(error.message).toBe('Netlify refused the token in NERA_NETLIFY_TOKEN (401). Replace it, or unset it to sign in instead.')
        expect(saved).toEqual([])
        expect(stub.requests).toHaveLength(1)
        expectNoSecret(error.message)
    })
})

describe('createNetlifyClient', () => {
    it('sends the token in the Authorization header and JSON bodies', async () => {
        const calls = []
        const client = createNetlifyClient({
            token: ACCESS,
            fetch: async (url, init) => {
                calls.push({ url, init })
                return jsonResponse(200, { ok: 1 })
            },
        })

        expect(await client.post('/sites', { name: 'x' })).toEqual({ ok: 1 })
        expect(calls[0].url).toBe(`${NETLIFY_API}/sites`)
        expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${ACCESS}`, 'Content-Type': 'application/json' })
        expect(calls[0].init.body).toBe('{"name":"x"}')
    })

    it('redacts the token and the extra secrets in every error', async () => {
        const echo = createNetlifyClient({
            token: ACCESS,
            secrets: [TICKET_ID],
            fetch: async () => jsonResponse(422, { message: `bad ${ACCESS} for ${TICKET_ID}` }),
        })
        const unreachable = createNetlifyClient({
            token: ACCESS,
            fetch: async () => {
                throw new Error(`connect failed with ${ACCESS}`)
            },
        })

        const answered = await echo.get(`/oauth/tickets/${TICKET_ID}`).catch((err) => err)
        expect(answered).toBeInstanceOf(NetlifyError)
        expect(answered.status).toBe(422)
        expect(answered.message).toBe('Netlify answered 422 to GET /oauth/tickets/***: bad *** for ***')

        const offline = await unreachable.get('/user').catch((err) => err)
        expect(offline.status).toBe(0)
        expect(offline.message).toBe('Could not reach Netlify: connect failed with ***')
    })

    it('refuses an empty token but allows none', () => {
        expect(() => createNetlifyClient({ token: '' })).toThrow(TypeError)
        expect(() => createNetlifyClient({})).not.toThrow()
    })
})
