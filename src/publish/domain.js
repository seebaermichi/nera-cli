import { isIP } from 'node:net'

// `--domain <host>`: the custom domain a host serves the site under. Checked
// when the arguments are parsed, before any sign-in or network call, so a
// pasted URL fails at once with what to pass instead.

const EXAMPLE = 'e.g. --domain example.com or --domain www.example.com'
// A DNS label: letters, digits and `-`, 1–63 characters, no `-` at either end.
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const MAX_LENGTH = 253
// The hosts' own addresses, which `nera publish` uses without `--domain`:
// a name below (or equal to) one of these is never a custom domain.
const HOST_DOMAINS = [
    { suffix: 'github.io', host: 'GitHub Pages' },
    { suffix: 'netlify.app', host: 'Netlify' },
]

// The host name in lower case, without a trailing root dot; throws, saying
// what to pass, for a scheme, a path, a port, a wildcard, an IP address, a
// `*.github.io` or `*.netlify.app` name (for every target) or anything else
// that is not a host name.
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
        fail(
            'not a host name: use letters, digits, "-" and dots, ' +
                `the punycode form (xn--…) for a non-ASCII name, ${EXAMPLE}`,
        )
    }
    const own = HOST_DOMAINS.find(({ suffix }) => host === suffix || host.endsWith(`.${suffix}`))
    if (own) {
        fail(
            `a ${own.suffix} address is the address ${own.host} gives a site, not a custom domain; ` +
                'publish without --domain to use it',
        )
    }
    return host
}
