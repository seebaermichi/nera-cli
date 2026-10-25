import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import {
    readToken,
    saveToken,
    deleteToken,
    credentialsFile,
    KEYCHAIN_SERVICE,
    KEYCHAIN_ACCOUNT,
    TOKEN_ENV,
} from '../src/publish/credentials.js'

// Fake token values only: no real token ever enters a test.
const TOKENS = {
    accessToken: 'ghu_fake_access',
    refreshToken: 'ghr_fake_refresh',
    expiresAt: 1_800_000_000_000,
    refreshTokenExpiresAt: 1_815_000_000_000,
}

let homedir

beforeEach(async () => {
    homedir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-credentials-test-'))
})

afterEach(async () => {
    await fs.rm(homedir, { recursive: true, force: true })
})

// An in-memory keyring module with the @napi-rs/keyring Entry shape; `fail`
// names the methods that throw.
function fakeKeyring({ fail = [] } = {}) {
    const store = new Map()
    const calls = []
    class Entry {
        constructor(service, account) {
            this.key = `${service}/${account}`
            calls.push(['new', service, account])
        }
        getPassword() {
            if (fail.includes('getPassword')) throw new Error('keychain locked')
            return store.get(this.key) ?? null
        }
        setPassword(text) {
            if (fail.includes('setPassword')) throw new Error('no secret service')
            store.set(this.key, text)
        }
        deletePassword() {
            if (fail.includes('deletePassword')) throw new Error('no secret service')
            return store.delete(this.key)
        }
    }
    return { store, calls, loadKeyring: async () => ({ Entry }) }
}

const noKeyring = async () => {
    throw new Error('Cannot find module @napi-rs/keyring')
}

function options(extra) {
    return { env: {}, homedir, ...extra }
}

describe('saveToken / readToken via the keychain', () => {
    it('stores the token set under nera/github and reads it back', async () => {
        const keyring = fakeKeyring()
        const saved = await saveToken(TOKENS, options({ loadKeyring: keyring.loadKeyring }))

        expect(saved).toEqual({ store: 'keychain' })
        expect(keyring.calls[0]).toEqual(['new', KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT])
        expect(JSON.parse(keyring.store.get('nera/github'))).toEqual(TOKENS)
        await expect(fs.stat(credentialsFile(homedir))).rejects.toMatchObject({ code: 'ENOENT' })

        const read = await readToken(options({ loadKeyring: keyring.loadKeyring }))
        expect(read).toEqual({ ...TOKENS, source: 'keychain' })
    })

    it('stores only the known fields', async () => {
        const keyring = fakeKeyring()
        await saveToken({ ...TOKENS, scope: 'repo', extra: 1 }, options({ loadKeyring: keyring.loadKeyring }))

        expect(Object.keys(JSON.parse(keyring.store.get('nera/github'))).sort()).toEqual(
            ['accessToken', 'expiresAt', 'refreshToken', 'refreshTokenExpiresAt'],
        )
    })

    it('removes an older fallback file once the keychain holds the token', async () => {
        await saveToken({ accessToken: 'ghu_old' }, options({ loadKeyring: noKeyring }))
        const keyring = fakeKeyring()
        await saveToken(TOKENS, options({ loadKeyring: keyring.loadKeyring }))

        await expect(fs.stat(credentialsFile(homedir))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('rejects a token set without an access token, naming no value', async () => {
        const keyring = fakeKeyring()
        await expect(saveToken({ refreshToken: 'ghr_fake' }, options({ loadKeyring: keyring.loadKeyring })))
            .rejects.toThrow(/^saveToken needs a token set with a non-empty accessToken$/)
        expect(keyring.store.size).toBe(0)
    })
})

describe('the file fallback', () => {
    for (const [label, loadKeyring] of [
        ['the keyring import throws', noKeyring],
        ['the keychain write throws', fakeKeyring({ fail: ['setPassword', 'getPassword'] }).loadKeyring],
        ['Entry cannot be constructed', async () => ({ Entry: class { constructor() { throw new Error('no backend') } } })],
    ]) {
        it(`writes ~/.config/nera/credentials.json with mode 0600 when ${label}`, async () => {
            const saved = await saveToken(TOKENS, options({ loadKeyring }))
            const file = credentialsFile(homedir)

            expect(saved).toEqual({ store: 'file', file })
            expect(file).toBe(path.join(homedir, '.config', 'nera', 'credentials.json'))
            expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual(TOKENS)
            if (process.platform !== 'win32') {
                expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
                expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
            }

            expect(await readToken(options({ loadKeyring }))).toEqual({ ...TOKENS, source: 'file' })
        })
    }

    it.skipIf(process.platform === 'win32')('replaces an existing file with looser permissions by a 0600 one', async () => {
        const file = credentialsFile(homedir)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, '{"accessToken":"ghu_old"}', { mode: 0o644 })

        await saveToken(TOKENS, options({ loadKeyring: noKeyring }))

        expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
        expect(JSON.parse(await fs.readFile(file, 'utf-8'))).toEqual(TOKENS)
        expect((await fs.readdir(path.dirname(file))).sort()).toEqual(['credentials.json'])
    })

    it('writes nothing to the console on the way', async () => {
        const spies = ['log', 'info', 'warn', 'error', 'debug'].map(method => vi.spyOn(console, method))
        try {
            await saveToken(TOKENS, options({ loadKeyring: noKeyring }))
            await readToken(options({ loadKeyring: fakeKeyring({ fail: ['getPassword'] }).loadKeyring }))
            await deleteToken(options({ loadKeyring: noKeyring }))
            for (const spy of spies) expect(spy).not.toHaveBeenCalled()
        } finally {
            for (const spy of spies) spy.mockRestore()
        }
    })

    it('reads the file when the keychain holds nothing', async () => {
        await saveToken(TOKENS, options({ loadKeyring: noKeyring }))
        const keyring = fakeKeyring()

        expect(await readToken(options({ loadKeyring: keyring.loadKeyring }))).toEqual({ ...TOKENS, source: 'file' })
    })

    it('treats a corrupt file as no token, without quoting it', async () => {
        const file = credentialsFile(homedir)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, 'ghu_secret_not_json', { mode: 0o600 })

        expect(await readToken(options({ loadKeyring: noKeyring }))).toBeNull()
    })

    it('returns null when nothing is stored anywhere', async () => {
        expect(await readToken(options({ loadKeyring: fakeKeyring().loadKeyring }))).toBeNull()
        expect(await readToken(options({ loadKeyring: noKeyring }))).toBeNull()
    })
})

describe('NERA_GITHUB_TOKEN', () => {
    it('wins over the keychain and the file', async () => {
        const keyring = fakeKeyring()
        await saveToken(TOKENS, options({ loadKeyring: keyring.loadKeyring }))

        const read = await readToken(options({ env: { [TOKEN_ENV]: 'ghu_from_env' }, loadKeyring: keyring.loadKeyring }))
        expect(read).toEqual({ accessToken: 'ghu_from_env', source: 'env' })
    })

    it('is read-only: saveToken and deleteToken leave it alone', async () => {
        const env = { [TOKEN_ENV]: 'ghu_from_env' }
        const keyring = fakeKeyring()

        expect(await saveToken(TOKENS, options({ env, loadKeyring: keyring.loadKeyring }))).toEqual({ store: 'keychain' })
        await deleteToken(options({ env, loadKeyring: keyring.loadKeyring }))

        expect(env).toEqual({ [TOKEN_ENV]: 'ghu_from_env' })
        expect(await readToken(options({ env, loadKeyring: keyring.loadKeyring }))).toMatchObject({ source: 'env' })
    })

    it('is ignored when empty', async () => {
        expect(await readToken(options({ env: { [TOKEN_ENV]: '' }, loadKeyring: noKeyring }))).toBeNull()
    })
})

describe('deleteToken', () => {
    it('removes the keychain entry and the file', async () => {
        const keyring = fakeKeyring()
        await saveToken(TOKENS, options({ loadKeyring: noKeyring }))
        keyring.store.set('nera/github', JSON.stringify(TOKENS))

        expect(await deleteToken(options({ loadKeyring: keyring.loadKeyring }))).toBe(true)
        expect(keyring.store.size).toBe(0)
        await expect(fs.stat(credentialsFile(homedir))).rejects.toMatchObject({ code: 'ENOENT' })
        expect(await readToken(options({ loadKeyring: keyring.loadKeyring }))).toBeNull()
    })

    it('removes the file when the keychain fails', async () => {
        await saveToken(TOKENS, options({ loadKeyring: noKeyring }))
        const keyring = fakeKeyring({ fail: ['deletePassword'] })

        expect(await deleteToken(options({ loadKeyring: keyring.loadKeyring }))).toBe(true)
        await expect(fs.stat(credentialsFile(homedir))).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('returns false when nothing was stored', async () => {
        expect(await deleteToken(options({ loadKeyring: fakeKeyring().loadKeyring }))).toBe(false)
        expect(await deleteToken(options({ loadKeyring: noKeyring }))).toBe(false)
    })
})
