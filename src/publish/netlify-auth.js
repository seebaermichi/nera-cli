import { openInBrowser } from './auth.js'
import { createNetlifyClient, NetlifyError, NETLIFY_WEB } from './netlify-api.js'
import { readToken as defaultReadToken, saveToken as defaultSaveToken } from './credentials.js'

// Signing in to Netlify for `nera publish --target netlify` (ROADMAP-ai.md
// L6 step 4, plan D1): the ticket flow of the "Nera CLI" Netlify OAuth app.
// Create a ticket, let the user authorize it on app.netlify.com, poll until
// it is authorized, exchange it for a token. Needs only the app's public
// client id, no secret. The token never expires and has no refresh token.
// Nothing here prints a token; the ticket id appears only in the authorize
// address the user has to open, never in an error message.

export const NETLIFY_CLIENT_ID = 'C9Mlx3pnO6OPdAE_MA0ZnG37ukvja99SxIiyQlHreKE'
export const AUTHORIZE_PAGE = `${NETLIFY_WEB}/authorize`
export const SIGN_UP_PAGE = `${NETLIFY_WEB}/signup`

// netlify-cli polls every second for up to an hour; we poll a little less
// often and give up after 15 minutes, like GitHub's device code.
export const POLL_INTERVAL_MS = 2_000
export const TICKET_TIMEOUT_MS = 15 * 60_000
// The `kind` of the sign-in's action_required / action_done events.
export const NETLIFY_SIGN_IN = 'netlify_sign_in'

// Who runs the OAuth app and where to read about it (D11), shown before
// sign-in, and the guided sign-up for a user without an account.
export const NETLIFY_IDENTITY_LINES = [
    'Nera deploys to Netlify through "Nera CLI", a Netlify OAuth app run by Michael Becker (https://michael-becker-berlin.de).',
    'About Nera: https://nera.js.org',
]
export const NETLIFY_SIGN_UP_LINE = `No Netlify account yet? Create one at ${SIGN_UP_PAGE} (the free plan is enough), then authorize Nera CLI — I'll wait.`

// Ticket polls answered with one of these statuses mean the ticket is gone:
// refused on the authorize page, expired or already used.
const TICKET_GONE = new Set([401, 403, 404, 410])

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const readNetlifyToken = () => defaultReadToken({ account: 'netlify' })
const saveNetlifyToken = (tokens) => defaultSaveToken(tokens, { account: 'netlify' })

// The authorize address for a ticket.
export function authorizeUrl(ticketId) {
    return `${AUTHORIZE_PAGE}?response_type=ticket&ticket=${encodeURIComponent(ticketId)}`
}

const expiredError = () => new NetlifyError(
    'The Netlify sign-in was not authorized in time. Run nera publish again for a new sign-in link.',
)
const goneError = (status) => new NetlifyError(
    'The Netlify sign-in was refused or has expired. Run nera publish again and choose "Authorize" on Netlify.',
    { status },
)

// Poll the ticket until it is authorized, waiting `POLL_INTERVAL_MS` between
// calls, for at most TICKET_TIMEOUT_MS.
async function waitForAuthorization(client, ticketId, { sleep, now }) {
    const deadline = now() + TICKET_TIMEOUT_MS
    for (;;) {
        await sleep(POLL_INTERVAL_MS)
        if (now() >= deadline) throw expiredError()
        let ticket
        try {
            ticket = await client.get(`/oauth/tickets/${encodeURIComponent(ticketId)}`)
        } catch (err) {
            if (err instanceof NetlifyError && TICKET_GONE.has(err.status)) throw goneError(err.status)
            throw err
        }
        if (ticket?.authorized) return
    }
}

// Store the token set and say so when it went to the file, not the keychain.
async function store(tokens, { saveToken, log }) {
    const where = await saveToken(tokens)
    if (where?.store === 'file') {
        log(`No keychain is available on this computer; the Netlify sign-in is stored in ${where.file} (readable only by you).`)
    }
}

// Sign in with the ticket flow: print who runs the OAuth app, the sign-up
// hint and the authorize address, open it when `tty` is true, poll until the
// user authorizes, store the token and print "Signed in to Netlify as
// <email>". Resolves `{ accessToken, email? }`. Rejects with a hint when the
// ticket is refused or expires. Every collaborator is injectable:
// - `fetch`: Netlify (netlify-api.js), `sleep(ms)` and `now()`: the poll's clock
// - `open(url)`: the browser opener, called only when `tty` is true
// - `saveToken(tokens)`: the token store (credentials.js, account netlify)
// - `log(line)`: where the lines go; stderr in --json mode
// - `emit(event)`: the machine-readable events, each right after its line:
//   `{ event: 'action_required', action: { kind: 'netlify_sign_in', url } }`
//   once the authorize address is shown (the same address), `{ event:
//   'action_done', kind: 'netlify_sign_in' }` once signed in; nothing on a
//   failure, and never the token. A no-op by default
export async function signInToNetlify({
    fetch = globalThis.fetch,
    sleep = sleepFor,
    now = Date.now,
    open = openInBrowser,
    tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    saveToken = saveNetlifyToken,
    log = (line) => console.log(line),
    emit = () => {},
} = {}) {
    for (const line of NETLIFY_IDENTITY_LINES) log(line)
    const ticket = await createNetlifyClient({ fetch })
        .post(`/oauth/tickets?client_id=${encodeURIComponent(NETLIFY_CLIENT_ID)}`)
    if (typeof ticket?.id !== 'string' || ticket.id === '') {
        throw new NetlifyError('Netlify sign-in failed: no ticket in the answer.')
    }
    const client = createNetlifyClient({ fetch, secrets: [ticket.id] })
    const page = authorizeUrl(ticket.id)

    log(`To sign in to Netlify, open ${page} and choose "Authorize".`)
    emit({ event: 'action_required', action: { kind: NETLIFY_SIGN_IN, url: page } })
    log(NETLIFY_SIGN_UP_LINE)
    if (tty) open(page)
    log('Waiting for you to authorize Nera CLI on Netlify…')

    await waitForAuthorization(client, ticket.id, { sleep, now })
    const answer = await client.post(`/oauth/tickets/${encodeURIComponent(ticket.id)}/exchange`)
    if (typeof answer?.access_token !== 'string' || answer.access_token === '') {
        throw new NetlifyError('Netlify sign-in failed: no token in the answer.')
    }
    const tokens = { accessToken: answer.access_token }
    await store(tokens, { saveToken, log })
    const email = typeof answer.user_email === 'string' && answer.user_email !== '' ? answer.user_email : undefined
    log(email ? `Signed in to Netlify as ${email}` : 'Signed in to Netlify.')
    emit({ event: 'action_done', kind: NETLIFY_SIGN_IN })
    return email ? { ...tokens, email } : tokens
}

// The account's email for a token, or null when Netlify refuses the token
// (401). Any other failure is rethrown.
async function checkToken(accessToken, fetch) {
    try {
        const user = await createNetlifyClient({ token: accessToken, fetch }).get('/user')
        return { email: typeof user?.email === 'string' ? user.email : undefined }
    } catch (err) {
        if (err instanceof NetlifyError && err.status === 401) return null
        throw err
    }
}

// A usable Netlify token: the stored one (or NERA_NETLIFY_TOKEN) while
// Netlify accepts it, a new ticket sign-in when there is none or a stored one
// was revoked. A refused NERA_NETLIFY_TOKEN fails instead, since it is the
// user's to replace. Takes the options of signInToNetlify plus `readToken`
// (credentials.js, account netlify); `emit` reaches a new sign-in only.
// Resolves `{ accessToken, source?, email? }`.
export async function ensureNetlifyToken(options = {}) {
    const {
        readToken = readNetlifyToken,
        saveToken = saveNetlifyToken,
        fetch = globalThis.fetch,
        log = (line) => console.log(line),
    } = options

    const stored = await readToken()
    if (stored) {
        const account = await checkToken(stored.accessToken, fetch)
        if (account) return account.email ? { ...stored, email: account.email } : stored
        if (stored.source === 'env') {
            throw new NetlifyError('Netlify refused the token in NERA_NETLIFY_TOKEN (401). Replace it, or unset it to sign in instead.', { status: 401 })
        }
        log('Your Netlify sign-in is no longer valid; please sign in again.')
    }
    return signInToNetlify({ ...options, saveToken, fetch, log })
}
