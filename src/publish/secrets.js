// Encrypted GitHub Actions repository secrets for `nera publish`
// (ROADMAP-ai.md L6, decision D3 of the Netlify issue). GitHub accepts a
// secret only sealed to the repository's public key with libsodium's
// `crypto_box_seal`; `sealSecret` builds that sealed box from the `@noble/*`
// primitives, which load lazily, so only a publish that stores secrets pays
// for them. A secret's value never appears in a request other than sealed,
// nor in any message built here.

// The repository's sealing key and the secrets of a repository.
const publicKeyPath = (repository) => `/repos/${repository.owner}/${repository.name}/actions/secrets/public-key`
const secretPath = (repository, name) => `/repos/${repository.owner}/${repository.name}/actions/secrets/${name}`

// GitHub's rules for a secret name: letters, digits and underscores, not
// starting with a digit or with the reserved GITHUB_ prefix. Upper case is
// our convention, since GitHub stores every name in upper case anyway.
const SECRET_NAME = /^[A-Z_][A-Z0-9_]*$/

const KEY_BYTES = 32
const NONCE_BYTES = 24
// HSalsa20's constant for a 32-byte key.
const SIGMA = 'expand 32-byte k'

// The 32-bit word view @noble/ciphers' `hsalsa` reads and writes; the bytes
// are copied first, so the view is aligned.
const words = (bytes) => new Uint32Array(Uint8Array.from(bytes).buffer)

// Seal `value` to the X25519 public key `publicKey` (base64, as GitHub sends
// it) exactly like libsodium's `crypto_box_seal`, and return the sealed box
// as base64:
//
//   ephemeral key pair (epk, esk)
//   nonce  = BLAKE2b-24(epk ‖ publicKey)
//   key    = HSalsa20(X25519(esk, publicKey), 0¹⁶)      (crypto_box_beforenm)
//   sealed = epk ‖ XSalsa20-Poly1305(key, nonce, value)  (tag ‖ ciphertext)
//
// `ephemeralSecretKey` exists for the test vector only; a real seal always
// draws a fresh one.
export async function sealSecret(value, publicKey, { ephemeralSecretKey } = {}) {
    if (typeof value !== 'string') throw new TypeError('sealSecret needs a string value')
    const recipient = Buffer.from(String(publicKey ?? ''), 'base64')
    if (recipient.length !== KEY_BYTES) {
        throw new Error(`The repository public key is not a ${KEY_BYTES}-byte X25519 key.`)
    }
    const [{ x25519 }, { blake2b }, { hsalsa, xsalsa20poly1305 }] = await Promise.all([
        import('@noble/curves/ed25519.js'),
        import('@noble/hashes/blake2.js'),
        import('@noble/ciphers/salsa.js'),
    ])
    const esk = ephemeralSecretKey ?? x25519.utils.randomSecretKey()
    const epk = x25519.getPublicKey(esk)

    const nonceInput = new Uint8Array(2 * KEY_BYTES)
    nonceInput.set(epk, 0)
    nonceInput.set(recipient, KEY_BYTES)
    const nonce = blake2b(nonceInput, { dkLen: NONCE_BYTES })

    const key = new Uint8Array(KEY_BYTES)
    hsalsa(
        words(new TextEncoder().encode(SIGMA)),
        words(x25519.getSharedSecret(esk, recipient)),
        new Uint32Array(4),
        new Uint32Array(key.buffer),
    )
    const box = xsalsa20poly1305(key, nonce).encrypt(new TextEncoder().encode(value))
    key.fill(0)

    const sealed = new Uint8Array(epk.length + box.length)
    sealed.set(epk, 0)
    sealed.set(box, epk.length)
    return Buffer.from(sealed).toString('base64')
}

// Store `secrets` ({ NAME: value }) as encrypted Actions secrets of
// `repository` ({ owner, name, repository }), acting with the GitHub
// `client` of github.js: fetch the repository's public key once, then PUT
// each secret sealed to it. Creates a missing secret and overwrites an
// existing one. Every name and value is checked before the first request, so
// a bad entry writes nothing. Resolves the names written, in order.
export async function setRepositorySecrets(client, repository, secrets) {
    const entries = Object.entries(secrets ?? {})
    if (entries.length === 0) throw new TypeError('setRepositorySecrets needs at least one secret')
    for (const [name, value] of entries) {
        if (!SECRET_NAME.test(name) || name.startsWith('GITHUB_')) {
            throw new TypeError(`"${name}" is not a valid name for a GitHub Actions secret.`)
        }
        if (typeof value !== 'string' || value === '') {
            throw new TypeError(`The secret ${name} needs a non-empty string value.`)
        }
    }

    const publicKey = await client.get(publicKeyPath(repository))
    if (typeof publicKey?.key !== 'string' || typeof publicKey?.key_id !== 'string') {
        throw new Error(`GitHub sent no Actions public key for ${repository.repository}.`)
    }
    const written = []
    for (const [name, value] of entries) {
        await client.put(secretPath(repository, name), {
            encrypted_value: await sealSecret(value, publicKey.key),
            key_id: publicKey.key_id,
        })
        written.push(name)
    }
    return written
}
