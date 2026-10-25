import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { randomBytes } from 'crypto'

// Where `nera publish` keeps the GitHub token set: the OS keychain first,
// a 0600 file when the keychain is missing or fails (headless Linux, CI, a
// failed optional install), and NERA_GITHUB_TOKEN above both, read-only.
// The token set is { accessToken, refreshToken?, expiresAt?,
// refreshTokenExpiresAt? }, the times in milliseconds since the epoch.
// Nothing here logs, prints or throws a message that contains a token.

export const KEYCHAIN_SERVICE = 'nera'
export const KEYCHAIN_ACCOUNT = 'github'
export const TOKEN_ENV = 'NERA_GITHUB_TOKEN'

const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'expiresAt', 'refreshTokenExpiresAt']

// The fallback file under the given home directory.
export function credentialsFile(homedir = os.homedir()) {
    return path.join(homedir, '.config', 'nera', 'credentials.json')
}

// The keyring module, imported only when a token is read or written, so
// every other command starts without the native binding.
function defaultLoadKeyring() {
    return import('@napi-rs/keyring')
}

// Options shared by the three functions; each one is injectable so tests
// never touch the real keychain, home directory or environment.
function resolveOptions({ env = process.env, homedir = os.homedir(), loadKeyring = defaultLoadKeyring } = {}) {
    return { env, file: credentialsFile(homedir), loadKeyring }
}

// The keychain entry, or null when the keyring cannot be loaded at all.
async function keychainEntry(loadKeyring) {
    try {
        const { Entry } = await loadKeyring()
        return new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
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

// The stored token set with its source ('env', 'keychain' or 'file'), or
// null when there is none. The environment wins and has no refresh token.
export async function readToken(options) {
    const { env, file, loadKeyring } = resolveOptions(options)
    if (env[TOKEN_ENV]) return { accessToken: env[TOKEN_ENV], source: 'env' }

    const entry = await keychainEntry(loadKeyring)
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

// Store the token set and say where: { store: 'keychain' } or
// { store: 'file', file }. Any keychain failure falls back to the file;
// a keychain write removes an older fallback file, so it cannot be read
// back in place of the new token. NERA_GITHUB_TOKEN is never written.
export async function saveToken(tokens, options) {
    const { file, loadKeyring } = resolveOptions(options)
    const text = serializeTokenSet(tokens)

    const entry = await keychainEntry(loadKeyring)
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

// Remove the token set from the keychain and the file; true when either
// held one. NERA_GITHUB_TOKEN is the user's and stays set.
export async function deleteToken(options) {
    const { file, loadKeyring } = resolveOptions(options)
    let removed = false

    const entry = await keychainEntry(loadKeyring)
    if (entry) {
        try {
            removed = entry.deletePassword() === true
        } catch {
            // nothing to delete, or no keychain: the file still goes
        }
    }

    return (await removeFileIfExists(file)) || removed
}
