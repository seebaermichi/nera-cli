import { describe, it, expect } from 'vitest'
import { x25519 } from '@noble/curves/ed25519.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { hsalsa, xsalsa20poly1305 } from '@noble/ciphers/salsa.js'
import { sealSecret, setRepositorySecrets } from '../src/publish/secrets.js'
import { GitHubError } from '../src/publish/github.js'
import { fakeGitHub } from './helpers/fake-github.js'

// Encrypted repository secrets of `nera publish` (Netlify issue, D3). The
// sealed box is pinned to libsodium itself: the vectors below come from
// libsodium 1.0.20 (`crypto_box_seed_keypair` with the seed 0x01…0x20 for the
// recipient and 0x64…0x83 for the ephemeral key). GitHub is a stub behind the
// real github.js client; no test uses the network or a real token.

const VALUE = 'nfp_fake_netlify_token'

const hex = (text) => Uint8Array.from(Buffer.from(text, 'hex'))
const RECIPIENT_PK = hex('4a3807d064d077181cc070989e76891d20dca5559548dc2c77c1a50273882b38')
const RECIPIENT_SK = hex('77788f1a0cea001a2631dae5d05dbd062008d5b30f50b9e29beb2a7822289004')
const RECIPIENT_PK_BASE64 = 'SjgH0GTQdxgcwHCYnnaJHSDcpVWVSNwsd8GlAnOIKzg='
const EPHEMERAL_SK = hex('6846779755e884ab17637435bac06937155ff978cb2d2081030147535989f97d')
// epk ‖ crypto_box_easy(VALUE, BLAKE2b-24(epk ‖ pk), pk, esk), which
// libsodium's crypto_box_seal_open accepts.
const SEALED_WITH_EPHEMERAL = '5bccd484527714f28eb6b6fa9e43feabae73eab192aef1e7d59d2111343d7b70f037d9a34ab0b01e6e9cd4430dee6412b47cf9dcca551c5ed03dd260029d5470d0e8dadf4eb1'
// A sealed box straight from libsodium's crypto_box_seal (random ephemeral key).
const SEALED_BY_LIBSODIUM = 'a7a66b5ee2c949e83966df24f70f1118feb5e6e6be136b84124f4e979a0f4807da3cae3e11039c3c1622bc8eaa9dc9288414e2071f2e2c41401aebcc5974107f86eb97a3adbe'

// libsodium's crypto_box_seal_open, written out here independently of
// secrets.js: the recipient's side of the sealed box.
function openSealed(sealed, publicKey, secretKey) {
    const epk = sealed.subarray(0, 32)
    const nonceInput = new Uint8Array(64)
    nonceInput.set(epk, 0)
    nonceInput.set(publicKey, 32)
    const nonce = blake2b(nonceInput, { dkLen: 24 })
    const key = new Uint8Array(32)
    hsalsa(
        new Uint32Array(Uint8Array.from(new TextEncoder().encode('expand 32-byte k')).buffer),
        new Uint32Array(Uint8Array.from(x25519.getSharedSecret(secretKey, epk)).buffer),
        new Uint32Array(4),
        new Uint32Array(key.buffer),
    )
    return new TextDecoder().decode(xsalsa20poly1305(key, nonce).decrypt(sealed.subarray(32)))
}

const fromBase64 = (text) => Uint8Array.from(Buffer.from(text, 'base64'))

const repository = { repository: 'octo/site', owner: 'octo', name: 'site', private: false }
const PUBLIC_KEY = 'GET /repos/octo/site/actions/secrets/public-key'
const putSecret = (name) => `PUT /repos/octo/site/actions/secrets/${name}`
const KEY_ID = '568250167242549743'

const github = (extra = {}) => fakeGitHub({
    [PUBLIC_KEY]: () => [200, { key_id: KEY_ID, key: RECIPIENT_PK_BASE64 }],
    [putSecret('NETLIFY_AUTH_TOKEN')]: () => [201],
    [putSecret('NETLIFY_SITE_ID')]: () => [204],
    ...extra,
})

describe('sealSecret', () => {
    it('opens a sealed box made by libsodium, so the opener below is libsodium-exact', () => {
        expect(openSealed(hex(SEALED_BY_LIBSODIUM), RECIPIENT_PK, RECIPIENT_SK)).toBe(VALUE)
    })

    it('produces the exact bytes libsodium produces for the same ephemeral key', async () => {
        const sealed = await sealSecret(VALUE, RECIPIENT_PK_BASE64, { ephemeralSecretKey: EPHEMERAL_SK })
        expect(Buffer.from(sealed, 'base64').toString('hex')).toBe(SEALED_WITH_EPHEMERAL)
    })

    it('seals with a fresh ephemeral key each time, and every box opens to the value', async () => {
        const first = await sealSecret(VALUE, RECIPIENT_PK_BASE64)
        const second = await sealSecret(VALUE, RECIPIENT_PK_BASE64)
        expect(first).not.toBe(second)
        expect(fromBase64(first)).toHaveLength(32 + 16 + VALUE.length)
        expect(openSealed(fromBase64(first), RECIPIENT_PK, RECIPIENT_SK)).toBe(VALUE)
        expect(openSealed(fromBase64(second), RECIPIENT_PK, RECIPIENT_SK)).toBe(VALUE)
    })

    it('seals an empty and a non-ASCII value', async () => {
        for (const value of ['', 'tökén ✓']) {
            const sealed = await sealSecret(value, RECIPIENT_PK_BASE64)
            expect(openSealed(fromBase64(sealed), RECIPIENT_PK, RECIPIENT_SK)).toBe(value)
        }
    })

    it('rejects a public key that is not 32 bytes, without quoting the value', async () => {
        for (const key of [undefined, '', Buffer.alloc(31).toString('base64')]) {
            const error = await sealSecret(VALUE, key).catch((err) => err)
            expect(error.message).toBe('The repository public key is not a 32-byte X25519 key.')
            expect(error.message).not.toContain(VALUE)
        }
    })

    it('rejects a value that is not a string', async () => {
        await expect(sealSecret(42, RECIPIENT_PK_BASE64)).rejects.toThrow(TypeError)
    })
})

describe('setRepositorySecrets', () => {
    it('fetches the public key once and PUTs every secret sealed with its key_id', async () => {
        const { client, requests } = github()
        const written = await setRepositorySecrets(client, repository, {
            NETLIFY_AUTH_TOKEN: VALUE,
            NETLIFY_SITE_ID: 'site-id-1234',
        })

        expect(written).toEqual(['NETLIFY_AUTH_TOKEN', 'NETLIFY_SITE_ID'])
        expect(requests.map((r) => r.route)).toEqual([
            PUBLIC_KEY,
            putSecret('NETLIFY_AUTH_TOKEN'),
            putSecret('NETLIFY_SITE_ID'),
        ])
        const [, token, siteId] = requests
        expect(Object.keys(token.body).sort()).toEqual(['encrypted_value', 'key_id'])
        expect(token.body.key_id).toBe(KEY_ID)
        expect(siteId.body.key_id).toBe(KEY_ID)
        expect(openSealed(fromBase64(token.body.encrypted_value), RECIPIENT_PK, RECIPIENT_SK)).toBe(VALUE)
        expect(openSealed(fromBase64(siteId.body.encrypted_value), RECIPIENT_PK, RECIPIENT_SK)).toBe('site-id-1234')
    })

    it('never sends a plain value', async () => {
        const { client, requests } = github()
        await setRepositorySecrets(client, repository, { NETLIFY_AUTH_TOKEN: VALUE, NETLIFY_SITE_ID: 'site-id-1234' })
        for (const { raw } of requests) {
            expect(String(raw ?? '')).not.toContain(VALUE)
            expect(String(raw ?? '')).not.toContain('site-id-1234')
        }
    })

    it('checks every name and value before the first request', async () => {
        const cases = [
            [{ NETLIFY_AUTH_TOKEN: VALUE, 'bad-name': 'x' }, '"bad-name" is not a valid name for a GitHub Actions secret.'],
            [{ GITHUB_TOKEN: 'x' }, '"GITHUB_TOKEN" is not a valid name for a GitHub Actions secret.'],
            [{ '1ST': 'x' }, '"1ST" is not a valid name for a GitHub Actions secret.'],
            [{ NETLIFY_AUTH_TOKEN: VALUE, NETLIFY_SITE_ID: '' }, 'The secret NETLIFY_SITE_ID needs a non-empty string value.'],
            [{ NETLIFY_SITE_ID: undefined }, 'The secret NETLIFY_SITE_ID needs a non-empty string value.'],
            [{}, 'setRepositorySecrets needs at least one secret'],
        ]
        for (const [secrets, message] of cases) {
            const { client, requests } = github()
            const error = await setRepositorySecrets(client, repository, secrets).catch((err) => err)
            expect(error).toBeInstanceOf(TypeError)
            expect(error.message).toBe(message)
            expect(error.message).not.toContain(VALUE)
            expect(requests).toEqual([])
        }
    })

    it('fails when GitHub sends no usable public key', async () => {
        const { client, requests } = github({ [PUBLIC_KEY]: () => [200, { key: RECIPIENT_PK_BASE64 }] })
        await expect(setRepositorySecrets(client, repository, { NETLIFY_AUTH_TOKEN: VALUE }))
            .rejects.toThrow('GitHub sent no Actions public key for octo/site.')
        expect(requests.map((r) => r.route)).toEqual([PUBLIC_KEY])
    })

    it('passes a GitHub refusal on as a GitHubError that quotes no value', async () => {
        const { client } = github({ [putSecret('NETLIFY_AUTH_TOKEN')]: () => [403, { message: 'Resource not accessible by integration' }] })
        const error = await setRepositorySecrets(client, repository, { NETLIFY_AUTH_TOKEN: VALUE }).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(403)
        expect(error.message).toBe('GitHub answered 403 to PUT /repos/octo/site/actions/secrets/NETLIFY_AUTH_TOKEN: Resource not accessible by integration')
        expect(error.message).not.toContain(VALUE)
    })
})
