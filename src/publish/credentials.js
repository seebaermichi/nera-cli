import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomBytes } from 'crypto'

// Where `nera publish` keeps its token sets, one per account (`github` or
// `netlify`): the OS keychain first, a 0600 file when the keychain is missing
// or fails (headless Linux, CI, a failed optional install), and the
// account's environment variable above both, read-only. A token set is
// { accessToken, refreshToken?, expiresAt?, refreshTokenExpiresAt? }, the
// times in milliseconds since the epoch (a Netlify token has no refresh
// token and does not expire). Nothing here logs, prints or throws a message
// that contains a token.

export const KEYCHAIN_SERVICE = 'nera'

// Per account: the keychain account name, the fallback file's name and the
// environment variable that overrides both. The GitHub entries are the ones
// 1.19.0 shipped and must not change, or a stored sign-in is lost.
export const ACCOUNTS = {
    github: { keychainAccount: 'github', fileName: 'credentials.json', env: 'NERA_GITHUB_TOKEN' },
    netlify: { keychainAccount: 'netlify', fileName: 'netlify-credentials.json', env: 'NERA_NETLIFY_TOKEN' },
}
export const KEYCHAIN_ACCOUNT = ACCOUNTS.github.keychainAccount
export const TOKEN_ENV = ACCOUNTS.github.env
export const NETLIFY_TOKEN_ENV = ACCOUNTS.netlify.env

const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'expiresAt', 'refreshTokenExpiresAt']

// The account's entry in ACCOUNTS; a TypeError for an unknown account.
function accountEntry(account) {
    if (!Object.hasOwn(ACCOUNTS, account)) throw new TypeError(`Unknown credentials account: ${account}`)
    return ACCOUNTS[account]
}

// The account's fallback file under the given home directory.
export function credentialsFile(homedir = os.homedir(), account = 'github') {
    return path.join(homedir, '.config', 'nera', accountEntry(account).fileName)
}

// The keyring module, imported only when a token is read or written, so
// every other command starts without the native binding.
function defaultLoadKeyring() {
    return import('@napi-rs/keyring')
}

// Options shared by the three functions: `account` ('github', the default,
// or 'netlify') picks the token set; `env`, `homedir` and `loadKeyring` are
// injectable so tests never touch the real keychain, home directory or
// environment.
function resolveOptions({
    account = 'github',
    env = process.env,
    homedir = os.homedir(),
    loadKeyring = defaultLoadKeyring,
} = {}) {
    const entry = accountEntry(account)
    return {
        env,
        envName: entry.env,
        file: credentialsFile(homedir, account),
        keychainAccount: entry.keychainAccount,
        loadKeyring,
    }
}

// The account's keychain entry, or null when the keyring cannot be loaded
// at all.
async function keychainEntry(loadKeyring, keychainAccount) {
    try {
        const { Entry } = await loadKeyring()
        return new Entry(KEYCHAIN_SERVICE, keychainAccount)
    } catch {
        return null
    }
}

// The known token fields of data, or null when it has no access token.
function pickTokenSet(data) {
    if (!data || typeof data.accessToken !== 'string' || data.accessToken === '') return null
    const set = {}
    for (const field of TOKEN_FIELDS) {
        if (data[field] !== undefined && data[field] !== null) set[field] = data[field]
    }
    return set
}

// A token set from stored text, keeping only the known fields; null when the
// text is not a token set. A JSON.parse error is swallowed, never rethrown:
// its message quotes the input, which is a token.
function parseTokenSet(text) {
    let data
    try {
        data = JSON.parse(text)
    } catch {
        return null
    }
    return pickTokenSet(data)
}

function serializeTokenSet(tokens) {
    const set = pickTokenSet(tokens)
    if (!set) throw new TypeError('saveToken needs a token set with a non-empty accessToken')
    return JSON.stringify(set)
}

async function readFileIfExists(file) {
    try {
        return await fs.readFile(file, 'utf-8')
    } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
    }
}

async function removeFileIfExists(file) {
    try {
        await fs.unlink(file)
        return true
    } catch (err) {
        if (err.code === 'ENOENT') return false
        throw err
    }
}

// Write the file with mode 0600 from its first byte: a fresh temp file is
// created with that mode and renamed over the old one, so an existing file
// with looser permissions is replaced, never written into.
async function writeCredentialsFile(file, text) {
    const dir = path.dirname(file)
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    const temp = path.join(dir, `.credentials-${randomBytes(6).toString('hex')}.tmp`)
    try {
        await fs.writeFile(temp, text, { mode: 0o600, flag: 'wx' })
        await fs.rename(temp, file)
    } catch (err) {
        await fs.rm(temp, { force: true })
        throw err
    }
}

// The account's stored token set with its source ('env', 'keychain' or
// 'file'), or null when there is none. The environment wins and has no
// refresh token.
export async function readToken(options) {
    const { env, envName, file, keychainAccount, loadKeyring } = resolveOptions(options)
    if (env[envName]) return { accessToken: env[envName], source: 'env' }

    const entry = await keychainEntry(loadKeyring, keychainAccount)
    if (entry) {
        try {
            const text = entry.getPassword()
            const set = text ? parseTokenSet(text) : null
            if (set) return { ...set, source: 'keychain' }
        } catch {
            // a keychain that fails to read falls through to the file
        }
    }

    const text = await readFileIfExists(file)
    const set = text ? parseTokenSet(text) : null
    return set ? { ...set, source: 'file' } : null
}

// Store the account's token set and say where: { store: 'keychain' } or
// { store: 'file', file }. Any keychain failure falls back to the file;
// a keychain write removes an older fallback file, so it cannot be read
// back in place of the new token. The environment variable is never written.
export async function saveToken(tokens, options) {
    const { file, keychainAccount, loadKeyring } = resolveOptions(options)
    const text = serializeTokenSet(tokens)

    const entry = await keychainEntry(loadKeyring, keychainAccount)
    if (entry) {
        try {
            entry.setPassword(text)
            await removeFileIfExists(file)
            return { store: 'keychain' }
        } catch {
            // fall back to the file
        }
    }

    await writeCredentialsFile(file, text)
    return { store: 'file', file }
}

// Remove the account's token set from the keychain and the file; true when
// either held one. The environment variable is the user's and stays set.
export async function deleteToken(options) {
    const { file, keychainAccount, loadKeyring } = resolveOptions(options)
    let removed = false

    const entry = await keychainEntry(loadKeyring, keychainAccount)
    if (entry) {
        try {
            removed = entry.deletePassword() === true
        } catch {
            // nothing to delete, or no keychain: the file still goes
        }
    }

    return (await removeFileIfExists(file)) || removed
}
