import { describe, it, expect } from 'vitest'
import {
    signIn,
    ensureToken,
    CLIENT_ID,
    DEVICE_PAGE,
    IDENTITY_LINES,
    SIGN_UP_LINE,
    EXPIRY_MARGIN_MS,
} from '../src/publish/auth.js'
import { createGitHubClient, postOAuth, redact, GitHubError, GITHUB_API } from '../src/publish/github.js'

// GitHub sign-in for `nera publish` (ROADMAP-ai.md L6 steps 1–2). `fetch` is a
// stub, the clock is fake and advanced by `sleep`, the browser opener is a
// recorder: no test touches the network, the keychain or a real token.

// Fake values only.
const ACCESS = 'ghu_fake_access_token'
const REFRESH = 'ghr_fake_refresh_token'
const NEW_ACCESS = 'ghu_fake_new_access_token'
const NEW_REFRESH = 'ghr_fake_new_refresh_token'
const DEVICE_CODE = 'fake_device_code_3584d83530557fdd1f46af8289938c8ef79f9dc5'
const USER_CODE = 'WDJB-MJHT'
const SECRETS = [ACCESS, REFRESH, NEW_ACCESS, NEW_REFRESH, DEVICE_CODE]

const START = 1_800_000_000_000

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

const tokenAnswer = (access = ACCESS, refresh = REFRESH) => ({
    access_token: access,
    expires_in: 28800,
    refresh_token: refresh,
    refresh_token_expires_in: 15897600,
    token_type: 'bearer',
    scope: '',
})

// A stub GitHub. `polls` are the access-token answers to the device-code
// grant, in order; `refreshAnswer` answers the refresh grant. Every request
// is recorded with its form or JSON body.
function fakeGitHub({ device = {}, polls = [tokenAnswer()], refreshAnswer, user = { login: 'octo' } } = {}) {
    const requests = []
    const pollQueue = [...polls]
    const fetch = async (url, init = {}) => {
        const form = init.headers?.['Content-Type'] === 'application/x-www-form-urlencoded'
            ? Object.fromEntries(new URLSearchParams(init.body))
            : undefined
        requests.push({ url, init, form })
        if (url === 'https://github.com/login/device/code') {
            return jsonResponse(200, {
                device_code: DEVICE_CODE,
                user_code: USER_CODE,
                verification_uri: DEVICE_PAGE,
                expires_in: 900,
                interval: 5,
                ...device,
            })
        }
        if (url === 'https://github.com/login/oauth/access_token') {
            if (form.grant_type === 'refresh_token') {
                if (refreshAnswer instanceof Error) throw refreshAnswer
                return jsonResponse(200, refreshAnswer)
            }
            return jsonResponse(200, pollQueue.shift() ?? { error: 'authorization_pending' })
        }
        if (url === `${GITHUB_API}/user`) return jsonResponse(200, user)
        return jsonResponse(404, { message: 'Not Found' })
    }
    return { fetch, requests }
}

// A fake clock that `sleep` advances, recording every wait.
function fakeClock(start = START) {
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

// signIn with stubs for everything; returns the lines it logged, the opened
// urls and the saved token sets alongside its result or error.
async function runSignIn({ github = fakeGitHub(), clock = fakeClock(), tty = false, store = 'keychain' } = {}) {
    const lines = []
    const opened = []
    const saved = []
    let result, error
    try {
        result = await signIn({
            fetch: github.fetch,
            sleep: clock.sleep,
            now: clock.now,
            open: (url) => opened.push(url),
            tty,
            saveToken: async (tokens) => {
                saved.push(tokens)
                return store === 'file' ? { store: 'file', file: '/home/me/.config/nera/credentials.json' } : { store: 'keychain' }
            },
            log: (line) => lines.push(line),
        })
    } catch (err) {
        error = err
    }
    return { result, error, lines, opened, saved, github, clock }
}

// Fails when any fake secret appears in the given text.
function expectNoSecret(text) {
    for (const secret of SECRETS) expect(text).not.toContain(secret)
}

const pollRequests = (github) =>
    github.requests.filter(({ form }) => form?.grant_type === 'urn:ietf:params:oauth:grant-type:device_code')

describe('signIn — the device flow', () => {
    it('asks for a device code with the app client id and no secret', async () => {
        const { github } = await runSignIn()
        const [first] = github.requests
        expect(first.url).toBe('https://github.com/login/device/code')
        expect(first.init.method).toBe('POST')
        expect(first.init.headers.Accept).toBe('application/json')
        expect(first.form).toEqual({ client_id: CLIENT_ID })
        expect(CLIENT_ID).toBe('Iv23liGnDuiH8YihBctY')
    })

    it('names who runs the app, links nera.js.org, prints the code and the sign-up hint, then "Signed in as"', async () => {
        const { lines, result } = await runSignIn()
        expect(lines.slice(0, 2)).toEqual(IDENTITY_LINES)
        expect(IDENTITY_LINES.join('\n')).toContain('Michael Becker')
        expect(IDENTITY_LINES.join('\n')).toContain('https://nera.js.org')
        expect(lines).toContain(`To sign in to GitHub, enter the code ${USER_CODE} at ${DEVICE_PAGE}`)
        expect(lines).toContain(SIGN_UP_LINE)
        expect(SIGN_UP_LINE).toContain('I\'ll wait')
        expect(lines.at(-1)).toBe('Signed in as octo')
        expect(result.login).toBe('octo')
    })

    it('polls with the device code grant and resolves the token set with expiry times', async () => {
        const { result, github, saved } = await runSignIn()
        const [poll] = pollRequests(github)
        expect(poll.form).toEqual({
            client_id: CLIENT_ID,
            device_code: DEVICE_CODE,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        })
        const signedInAt = START + 5000
        const tokens = {
            accessToken: ACCESS,
            refreshToken: REFRESH,
            expiresAt: signedInAt + 28800 * 1000,
            refreshTokenExpiresAt: signedInAt + 15897600 * 1000,
        }
        expect(result).toEqual({ ...tokens, login: 'octo' })
        expect(saved).toEqual([tokens])
    })

    it('looks up the login with the new token in the Authorization header', async () => {
        const { github } = await runSignIn()
        const userCall = github.requests.find(({ url }) => url === `${GITHUB_API}/user`)
        expect(userCall.init.headers.Authorization).toBe(`Bearer ${ACCESS}`)
    })

    it('keeps polling while authorization is pending, at the interval GitHub gave', async () => {
        const github = fakeGitHub({
            device: { interval: 7 },
            polls: [{ error: 'authorization_pending' }, { error: 'authorization_pending' }, tokenAnswer()],
        })
        const { result, clock } = await runSignIn({ github })
        expect(result.accessToken).toBe(ACCESS)
        expect(clock.sleeps).toEqual([7000, 7000, 7000])
        expect(pollRequests(github)).toHaveLength(3)
    })

    it('waits 5 s by default when GitHub names no interval', async () => {
        const github = fakeGitHub({ device: { interval: undefined } })
        const { clock } = await runSignIn({ github })
        expect(clock.sleeps).toEqual([5000])
    })

    it('slow_down adds 5 s to the interval for the rest of the poll', async () => {
        const github = fakeGitHub({
            polls: [
                { error: 'slow_down' },
                { error: 'authorization_pending' },
                { error: 'slow_down' },
                { error: 'authorization_pending' },
                tokenAnswer(),
            ],
        })
        const { result, clock } = await runSignIn({ github })
        expect(result.accessToken).toBe(ACCESS)
        expect(clock.sleeps).toEqual([5000, 10000, 10000, 15000, 15000])
    })

    it('slow_down takes GitHub\'s interval when that is longer', async () => {
        const github = fakeGitHub({ polls: [{ error: 'slow_down', interval: 20 }, tokenAnswer()] })
        const { clock } = await runSignIn({ github })
        expect(clock.sleeps).toEqual([5000, 20000])
    })

    it('stops on expired_token with a hint to run again', async () => {
        const github = fakeGitHub({ polls: [{ error: 'authorization_pending' }, { error: 'expired_token' }] })
        const { error, saved, lines } = await runSignIn({ github })
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.code).toBe('expired_token')
        expect(error.message).toMatch(/expired.*Run nera publish again/)
        expect(saved).toEqual([])
        expect(lines.some((line) => line.startsWith('Signed in'))).toBe(false)
    })

    it('stops on access_denied with a hint to authorize', async () => {
        const github = fakeGitHub({ polls: [{ error: 'access_denied' }] })
        const { error, saved } = await runSignIn({ github })
        expect(error.code).toBe('access_denied')
        expect(error.message).toMatch(/cancelled.*"Authorize"/)
        expect(saved).toEqual([])
    })

    it('stops once the code has expired even if GitHub keeps answering pending', async () => {
        const github = fakeGitHub({ device: { expires_in: 12, interval: 5 }, polls: [] })
        const { error, clock } = await runSignIn({ github })
        expect(error.code).toBe('expired_token')
        expect(clock.sleeps).toEqual([5000, 5000, 5000])
        expect(pollRequests(github)).toHaveLength(2)
    })

    it('reports any other OAuth error with GitHub\'s description', async () => {
        const github = fakeGitHub({ polls: [{ error: 'device_flow_disabled', error_description: 'Device flow is disabled for this app.' }] })
        const { error } = await runSignIn({ github })
        expect(error.code).toBe('device_flow_disabled')
        expect(error.message).toBe('GitHub sign-in failed: Device flow is disabled for this app.')
    })

    it('fails clearly when GitHub sends no device code', async () => {
        const github = fakeGitHub({ device: { device_code: undefined, user_code: undefined, error: 'unauthorized_client' } })
        const { error } = await runSignIn({ github })
        expect(error.message).toBe('GitHub sign-in failed: unauthorized_client')
    })

    it('opens the device page on a TTY', async () => {
        const { opened } = await runSignIn({ tty: true })
        expect(opened).toEqual([DEVICE_PAGE])
    })

    it('never opens the browser without a TTY, and still prints the code', async () => {
        const { opened, lines } = await runSignIn({ tty: false })
        expect(opened).toEqual([])
        expect(lines.join('\n')).toContain(USER_CODE)
    })

    it('says where the token went when there is no keychain', async () => {
        const { lines } = await runSignIn({ store: 'file' })
        expect(lines).toContain('No keychain is available on this computer; the GitHub sign-in is stored in /home/me/.config/nera/credentials.json (readable only by you).')
    })

    it('never prints a token or the device code, on success or on any failure', async () => {
        const runs = [
            await runSignIn({ store: 'file' }),
            await runSignIn({ github: fakeGitHub({ polls: [{ error: 'slow_down' }, { error: 'expired_token' }] }) }),
            await runSignIn({ github: fakeGitHub({ polls: [{ error: 'access_denied' }] }) }),
            await runSignIn({ github: fakeGitHub({ polls: [{ error: 'bogus', error_description: 'odd' }] }) }),
        ]
        for (const { lines, error } of runs) {
            expectNoSecret(lines.join('\n'))
            if (error) expectNoSecret(`${error.message}\n${error.stack}`)
        }
    })
})

// ensureToken with a fake store holding `stored`; returns the logged lines,
// the saved sets and whether a new sign-in started.
async function runEnsure({ stored, github = fakeGitHub(), clock = fakeClock() }) {
    const lines = []
    const saved = []
    let result, error
    try {
        result = await ensureToken({
            readToken: async () => stored,
            saveToken: async (tokens) => {
                saved.push(tokens)
                return { store: 'keychain' }
            },
            fetch: github.fetch,
            sleep: clock.sleep,
            now: clock.now,
            open: () => {},
            tty: false,
            log: (line) => lines.push(line),
        })
    } catch (err) {
        error = err
    }
    const signedInAgain = github.requests.some(({ url }) => url.endsWith('/login/device/code'))
    return { result, error, lines, saved, github, signedInAgain }
}

const storedSet = (overrides = {}) => ({
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: START + 3_600_000,
    refreshTokenExpiresAt: START + 86_400_000,
    source: 'keychain',
    ...overrides,
})

describe('ensureToken', () => {
    it('returns a stored token that has not expired, with no call to GitHub', async () => {
        const stored = storedSet()
        const { result, github, saved } = await runEnsure({ stored })
        expect(result).toBe(stored)
        expect(github.requests).toEqual([])
        expect(saved).toEqual([])
    })

    it('returns NERA_GITHUB_TOKEN as it is, never refreshing it', async () => {
        const stored = { accessToken: ACCESS, source: 'env' }
        const { result, github } = await runEnsure({ stored })
        expect(result).toBe(stored)
        expect(github.requests).toEqual([])
    })

    it('treats a token without an expiry as valid', async () => {
        const stored = { accessToken: ACCESS, source: 'file' }
        const { result, github } = await runEnsure({ stored })
        expect(result).toBe(stored)
        expect(github.requests).toEqual([])
    })

    it('refreshes an expired access token with the refresh token and stores the new set', async () => {
        const github = fakeGitHub({ refreshAnswer: tokenAnswer(NEW_ACCESS, NEW_REFRESH) })
        const { result, saved, signedInAgain, lines } = await runEnsure({
            stored: storedSet({ expiresAt: START - 1 }),
            github,
        })
        const refreshCall = github.requests.find(({ form }) => form?.grant_type === 'refresh_token')
        expect(refreshCall.url).toBe('https://github.com/login/oauth/access_token')
        expect(refreshCall.form).toEqual({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: REFRESH })
        const tokens = {
            accessToken: NEW_ACCESS,
            refreshToken: NEW_REFRESH,
            expiresAt: START + 28800 * 1000,
            refreshTokenExpiresAt: START + 15897600 * 1000,
        }
        expect(result).toEqual(tokens)
        expect(saved).toEqual([tokens])
        expect(signedInAgain).toBe(false)
        expect(lines).toEqual([])
    })

    it('refreshes a token that expires within the margin', async () => {
        const github = fakeGitHub({ refreshAnswer: tokenAnswer(NEW_ACCESS, NEW_REFRESH) })
        const { result } = await runEnsure({
            stored: storedSet({ expiresAt: START + EXPIRY_MARGIN_MS - 1 }),
            github,
        })
        expect(result.accessToken).toBe(NEW_ACCESS)
    })

    it('signs in again when GitHub refuses the refresh token', async () => {
        const github = fakeGitHub({ refreshAnswer: { error: 'bad_refresh_token', error_description: 'The refresh token passed is incorrect or expired.' } })
        const { result, lines, signedInAgain } = await runEnsure({
            stored: storedSet({ expiresAt: START - 1 }),
            github,
        })
        expect(signedInAgain).toBe(true)
        expect(lines).toContain('Your GitHub sign-in has expired; please sign in again.')
        expect(lines.at(-1)).toBe('Signed in as octo')
        expect(result.accessToken).toBe(ACCESS)
    })

    it('signs in again when the refresh call cannot reach GitHub', async () => {
        const github = fakeGitHub({ refreshAnswer: new Error(`socket hang up ${REFRESH}`) })
        const { result, signedInAgain, lines } = await runEnsure({
            stored: storedSet({ expiresAt: START - 1 }),
            github,
        })
        expect(signedInAgain).toBe(true)
        expect(result.login).toBe('octo')
        expectNoSecret(lines.join('\n'))
    })

    it('signs in again, without trying, when the refresh token has expired too', async () => {
        const github = fakeGitHub()
        const { signedInAgain } = await runEnsure({
            stored: storedSet({ expiresAt: START - 2, refreshTokenExpiresAt: START - 1 }),
            github,
        })
        expect(github.requests.some(({ form }) => form?.grant_type === 'refresh_token')).toBe(false)
        expect(signedInAgain).toBe(true)
    })

    it('signs in when nothing is stored, without the "expired" line', async () => {
        const { lines, signedInAgain, result } = await runEnsure({ stored: null })
        expect(signedInAgain).toBe(true)
        expect(lines.some((line) => line.includes('expired'))).toBe(false)
        expect(result.login).toBe('octo')
    })
})

describe('github.js', () => {
    it('sends the token in the Authorization header with the API version', async () => {
        const github = fakeGitHub()
        const client = createGitHubClient({ token: ACCESS, fetch: github.fetch })
        expect(await client.get('/user')).toEqual({ login: 'octo' })
        const [{ url, init }] = github.requests
        expect(url).toBe('https://api.github.com/user')
        expect(init.method).toBe('GET')
        expect(init.headers).toMatchObject({
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${ACCESS}`,
            'X-GitHub-Api-Version': '2022-11-28',
        })
        expect(init.body).toBeUndefined()
        expect(url).not.toContain(ACCESS)
    })

    it('sends a JSON body and resolves null for an empty answer', async () => {
        const calls = []
        const fetch = async (url, init) => {
            calls.push(init)
            return jsonResponse(204)
        }
        const client = createGitHubClient({ token: ACCESS, fetch })
        expect(await client.put('/repos/me/site/x', { a: 1 })).toBeNull()
        expect(calls[0].headers['Content-Type']).toBe('application/json')
        expect(calls[0].body).toBe('{"a":1}')
    })

    it('throws a GitHubError naming the call and GitHub\'s message, never the token', async () => {
        const fetch = async () => jsonResponse(422, { message: `name already exists on this account ${ACCESS}` })
        const client = createGitHubClient({ token: ACCESS, fetch })
        const error = await client.post('/user/repos', { name: 'site' }).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(422)
        expect(error.message).toBe('GitHub answered 422 to POST /user/repos: name already exists on this account ***')
    })

    it('turns a network failure into a GitHubError with status 0', async () => {
        const fetch = async () => {
            throw new Error('getaddrinfo ENOTFOUND api.github.com')
        }
        const client = createGitHubClient({ token: ACCESS, fetch })
        const error = await client.get('/user').catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(0)
        expect(error.message).toBe('Could not reach GitHub: getaddrinfo ENOTFOUND api.github.com')
    })

    it('getText resolves the answer as text and throws like request on a failure', async () => {
        const fetch = async (url) => (url.endsWith('/logs')
            ? { ok: true, status: 200, statusText: 'OK', text: async () => 'line 1\nline 2\n' }
            : jsonResponse(404, { message: 'Not Found' }))
        const client = createGitHubClient({ token: ACCESS, fetch })
        expect(await client.getText('/repos/me/site/actions/jobs/7/logs')).toBe('line 1\nline 2\n')
        const error = await client.getText('/repos/me/site/actions/jobs/8').catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.message).toBe('GitHub answered 404 to GET /repos/me/site/actions/jobs/8: Not Found')
    })

    it('refuses to build a client without a token', () => {
        expect(() => createGitHubClient({ token: '' })).toThrow(TypeError)
    })

    it('postOAuth throws on an HTTP failure without echoing the form values', async () => {
        const fetch = async () => jsonResponse(500, { error: `server ${DEVICE_CODE}` })
        const error = await postOAuth('/login/oauth/access_token', { device_code: DEVICE_CODE }, { fetch }).catch((err) => err)
        expect(error.status).toBe(500)
        expect(error.message).toBe('GitHub sign-in failed: 500 server ***')
    })

    it('redact replaces every secret and ignores empty ones', () => {
        expect(redact('a SECRET b SECRET', ['SECRET', '', undefined])).toBe('a *** b ***')
    })
})
