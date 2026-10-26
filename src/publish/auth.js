import { spawn } from 'child_process'
import { createGitHubClient, postOAuth, GitHubError } from './github.js'
import { readToken as defaultReadToken, saveToken as defaultSaveToken } from './credentials.js'

// Signing in to GitHub for `nera publish` (ROADMAP-ai.md L6 steps 1–2): the
// "Nera Static" GitHub App's device flow, its expiring user tokens and their
// refresh. Needs only the app's public client id, no secret. Nothing here
// prints a token; the user code is printed because the user has to type it.

export const CLIENT_ID = 'Iv23liGnDuiH8YihBctY'
export const DEVICE_PAGE = 'https://github.com/login/device'
const DEVICE_CODE_PATH = '/login/device/code'
const ACCESS_TOKEN_PATH = '/login/oauth/access_token'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

// RFC 8628: poll every 5 s unless told otherwise, and 5 s slower after each
// `slow_down`, for the rest of the poll.
const DEFAULT_INTERVAL = 5
const SLOW_DOWN_STEP = 5
// An access token this close to its expiry is refreshed before use, so it
// cannot run out halfway through a publish.
export const EXPIRY_MARGIN_MS = 60_000

// Who runs the app and where to read about it (D11), shown before sign-in:
// GitHub labels a new app "Created less than a day ago".
export const IDENTITY_LINES = [
    'Nera publishes through "Nera Static", a GitHub App run by Michael Becker (https://michael-becker-berlin.de).',
    'About Nera: https://nera.js.org',
]
export const SIGN_UP_LINE = 'No GitHub account yet? The page offers to create one: create an account there, then come back — I\'ll wait.'

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Open `url` in the default browser, never failing: the code and the address
// are printed anyway. The url is one of ours, never user input.
export function openInBrowser(url) {
    const [command, args] = process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
            ? ['cmd', ['/c', 'start', '""', url]]
            : ['xdg-open', [url]]
    try {
        const child = spawn(command, args, { stdio: 'ignore', detached: true })
        child.on('error', () => {})
        child.unref()
    } catch {
        // no opener on this system: the printed address is enough
    }
}

// A credentials.js token set from GitHub's token answer, its lifetimes
// turned into times in milliseconds since the epoch.
function tokenSetFrom(data, now) {
    const set = { accessToken: data.access_token }
    if (data.refresh_token) set.refreshToken = data.refresh_token
    if (data.expires_in) set.expiresAt = now + data.expires_in * 1000
    if (data.refresh_token_expires_in) set.refreshTokenExpiresAt = now + data.refresh_token_expires_in * 1000
    return set
}

// The error for an OAuth error answer that ends the poll.
function signInError(data) {
    switch (data.error) {
    case 'expired_token':
        return new GitHubError('The sign-in code expired before it was entered. Run nera publish again for a new code.', { code: data.error })
    case 'access_denied':
        return new GitHubError('Sign-in was cancelled on GitHub. Run nera publish again and choose "Authorize".', { code: data.error })
    default:
        return new GitHubError(`GitHub sign-in failed: ${data.error_description ?? data.error}`, { code: data.error })
    }
}

// Poll the access-token endpoint until the user has entered the code, waiting
// `interval` seconds between calls. Returns GitHub's token answer.
async function pollForToken(device, { fetch, sleep, now }) {
    const deadline = now() + device.expires_in * 1000
    let interval = device.interval ?? DEFAULT_INTERVAL
    for (;;) {
        await sleep(interval * 1000)
        if (now() >= deadline) throw signInError({ error: 'expired_token' })
        const data = await postOAuth(ACCESS_TOKEN_PATH, {
            client_id: CLIENT_ID,
            device_code: device.device_code,
            grant_type: DEVICE_GRANT,
        }, { fetch })
        if (data.access_token) return data
        if (data.error === 'authorization_pending') continue
        if (data.error === 'slow_down') {
            interval = Math.max(interval + SLOW_DOWN_STEP, data.interval ?? 0)
            continue
        }
        throw signInError(data)
    }
}

// The login of the account the token belongs to.
async function fetchLogin(accessToken, fetch) {
    const user = await createGitHubClient({ token: accessToken, fetch }).get('/user')
    return user.login
}

// Store the token set and say so when it went to the file, not the keychain.
async function store(tokens, { saveToken, log }) {
    const where = await saveToken(tokens)
    if (where?.store === 'file') {
        log(`No keychain is available on this computer; the GitHub sign-in is stored in ${where.file} (readable only by you).`)
    }
}

// Sign in with the device flow: print who runs the app, the sign-up hint and
// the code, open github.com/login/device when `tty` is true, poll until the
// user authorizes, store the token set and print "Signed in as <login>".
// Resolves the token set plus `login`. Rejects with a hint when the code
// expires or the user cancels. Every collaborator is injectable:
// - `fetch`: GitHub (github.js), `sleep(ms)` and `now()`: the poll's clock
// - `open(url)`: the browser opener, called only when `tty` is true
// - `saveToken(tokens)`: the token store (credentials.js)
// - `log(line)`: where the lines go; stderr in --json mode
export async function signIn({
    fetch = globalThis.fetch,
    sleep = sleepFor,
    now = Date.now,
    open = openInBrowser,
    tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    saveToken = defaultSaveToken,
    log = (line) => console.log(line),
} = {}) {
    for (const line of IDENTITY_LINES) log(line)
    const device = await postOAuth(DEVICE_CODE_PATH, { client_id: CLIENT_ID }, { fetch })
    if (!device.device_code || !device.user_code) {
        throw new GitHubError(`GitHub sign-in failed: ${device.error_description ?? device.error ?? 'no device code in the answer'}`, { code: device.error })
    }
    const page = device.verification_uri ?? DEVICE_PAGE

    log(`To sign in to GitHub, enter the code ${device.user_code} at ${page}`)
    log(SIGN_UP_LINE)
    if (tty) open(page)
    log('Waiting for you to authorize Nera Static on GitHub…')

    const data = await pollForToken(device, { fetch, sleep, now })
    const tokens = tokenSetFrom(data, now())
    const login = await fetchLogin(tokens.accessToken, fetch)
    await store(tokens, { saveToken, log })
    log(`Signed in as ${login}`)
    return { ...tokens, login }
}

// True when the token set's access token is past (or within the margin of)
// its expiry. A token without expiresAt does not expire.
const isExpired = (tokens, now) => tokens.expiresAt !== undefined && now >= tokens.expiresAt - EXPIRY_MARGIN_MS

const canRefresh = (tokens, now) =>
    Boolean(tokens.refreshToken) && (tokens.refreshTokenExpiresAt === undefined || now < tokens.refreshTokenExpiresAt)

// Trade the refresh token for a new token set; null when GitHub refuses.
async function refresh(tokens, { fetch, now }) {
    let data
    try {
        data = await postOAuth(ACCESS_TOKEN_PATH, {
            client_id: CLIENT_ID,
            grant_type: 'refresh_token',
            refresh_token: tokens.refreshToken,
        }, { fetch })
    } catch {
        return null
    }
    return data.access_token ? tokenSetFrom(data, now()) : null
}

// A usable token set for GitHub: the stored one while it is valid,
// NERA_GITHUB_TOKEN as it is, a refreshed one when the access token has
// expired, and a new device-flow sign-in when there is none or the refresh
// fails. Takes the options of signIn plus `readToken` (credentials.js).
export async function ensureToken(options = {}) {
    const {
        readToken = defaultReadToken,
        saveToken = defaultSaveToken,
        fetch = globalThis.fetch,
        now = Date.now,
        log = (line) => console.log(line),
    } = options

    const stored = await readToken()
    if (stored && (stored.source === 'env' || !isExpired(stored, now()))) return stored

    if (stored && canRefresh(stored, now())) {
        const tokens = await refresh(stored, { fetch, now })
        if (tokens) {
            await store(tokens, { saveToken, log })
            return tokens
        }
    }

    if (stored) log('Your GitHub sign-in has expired; please sign in again.')
    return signIn({ ...options, saveToken, fetch, now, log })
}
