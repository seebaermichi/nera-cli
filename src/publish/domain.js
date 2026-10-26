import { isIP } from 'net'

// `--domain <host>` (ROADMAP-ai.md L6): the custom domain a host serves the
// site under. Checked when the arguments are parsed, before any sign-in or
// network call, so a pasted URL fails at once with what to pass instead.

const EXAMPLE = 'e.g. --domain example.com or --domain www.example.com'
// A DNS label: letters, digits and `-`, 1–63 characters, no `-` at either end.
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const MAX_LENGTH = 253

// The host name in lower case, without a trailing root dot; throws, saying
// what to pass, for a scheme, a path, a port, a wildcard, an IP address, a
// `*.github.io` name or anything else that is not a host name.
export function normalizeDomain(value) {
    const raw = String(value).trim()
    const fail = (why) => {
        throw new Error(`--domain ${JSON.stringify(raw)}: ${why}`)
    }

    if (raw.includes('://')) fail(`pass the host name without the scheme, ${EXAMPLE}`)
    if (raw.includes('/')) fail(`pass the host name without a path, ${EXAMPLE}`)
    if (isIP(raw.replace(/^\[|\]$/g, ''))) fail(`an IP address cannot be a custom domain; pass a host name, ${EXAMPLE}`)
    if (raw.includes(':')) fail(`pass the host name without a port, ${EXAMPLE}`)
    if (raw.includes('*')) fail(`a wildcard cannot be a custom domain; pass one host name, ${EXAMPLE}`)

    const host = raw.toLowerCase().replace(/\.$/, '')
    const labels = host.split('.')
    if (host.length > MAX_LENGTH
        || labels.length < 2
        || !labels.every((label) => LABEL_PATTERN.test(label))
        || /^\d+$/.test(labels.at(-1))) {
        fail(`not a host name: use letters, digits, "-" and dots, the punycode form (xn--…) for a non-ASCII name, ${EXAMPLE}`)
    }
    if (host === 'github.io' || host.endsWith('.github.io')) {
        fail('a github.io address is GitHub Pages\' own; publish without --domain to use it')
    }
    return host
}
