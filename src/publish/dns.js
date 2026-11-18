import { Resolver } from 'dns/promises'

// The DNS check of `nera publish --domain` (ROADMAP-ai.md L6), shared by the
// targets: each one describes the records its host serves a custom domain
// from as a `service` — `{ name, cname, a, aaaa }`, where `name` is the host
// as the log names it, `cname` what a subdomain's CNAME points to, `a` the
// addresses an apex domain's A records point to and `aaaa` its AAAA ones
// (optional; `[]` when the host has none). The check only reports: DNS
// changes take hours to spread, so a missing record never fails a publish.

// A lookup that finds no records is an answer, not a failure.
const NO_RECORDS = ['ENOTFOUND', 'ENODATA']
// Bounds a DNS check that cannot get an answer: milliseconds per try, tries.
const LOOKUP_TIMEOUT = 5000
const LOOKUP_TRIES = 2

// `{ records }` from `lookup()`, `[]` when the name has none; a lookup that
// fails (a timeout, a server failure) resolves `{ records: [], failed }`
// with the error's code instead of throwing, since the check only reports.
async function lookupRecords(lookup) {
    try {
        return { records: await lookup() }
    } catch (err) {
        if (NO_RECORDS.includes(err?.code)) return { records: [] }
        return { records: [], failed: err?.code ?? String(err?.message ?? err) }
    }
}

// Whether `domain` is an apex (the name a DNS zone starts at, such as
// example.com or example.co.uk), which takes A records since it cannot have a
// CNAME, given the results of its CNAME and SOA lookups. Its own SOA record
// marks an apex. node:dns does not say which name an SOA answer is for, and a
// name with a CNAME may be answered with the SOA of the zone its target is
// in, so an SOA counts only when the name has no CNAME, and the CNAME lookup
// did not fail. Without that answer — no SOA, a failed lookup — the name
// falls back to the label rule: two labels are an apex. A two-label name is
// an apex either way, so checkDns looks its SOA up only for longer names.
function isApex(domain, { cname, soa }) {
    if (soa.records.length > 0 && cname.records.length === 0 && !cname.failed) return true
    return labels(domain) === 2
}

const labels = (domain) => domain.split('.').length

// Whether `domain` points at `service`, looked up with `resolver`
// (resolveCname/resolve4/resolve6/resolveSoa of node:dns/promises; a
// bounded one by default). A CNAME counts when it names `service.cname`; without one, A
// records count when every one is the service's, AAAA records when there are
// none or every one is the service's. `expected` is what to set: the
// service's A and AAAA records for an apex domain, a CNAME to
// `service.cname` for a subdomain (see isApex). Never throws for a failed
// lookup: `ok` is false and `failed` names the error codes of the record
// lookups (a failed SOA lookup only falls back to the label rule). Resolves `{ domain,
// service, ok, expected, found, failed }` with `service` the service's name,
// records as `{ type, value }` (expected ones with `name`, and `optional`
// for AAAA).
export async function checkDns({
    domain,
    service,
    resolver = new Resolver({ timeout: LOOKUP_TIMEOUT, tries: LOOKUP_TRIES }),
}) {
    const { cname: target, a: addresses, aaaa: addresses6 = [] } = service
    const [cname, a, aaaa, soa] = await Promise.all([
        lookupRecords(() => resolver.resolveCname(domain)),
        lookupRecords(() => resolver.resolve4(domain)),
        lookupRecords(() => resolver.resolve6(domain)),
        // Only a name of more than two labels needs its SOA to tell (isApex).
        labels(domain) > 2 ? lookupRecords(async () => [await resolver.resolveSoa(domain)]) : { records: [] },
    ])
    const cnames = cname.records.map((value) => value.toLowerCase().replace(/\.$/, ''))
    const allOf = (records, own) => records.every((ip) => own.includes(ip))
    const ok = cnames.length > 0
        ? cnames.includes(target)
        : a.records.length > 0 && allOf(a.records, addresses) && allOf(aaaa.records, addresses6)

    const expected = isApex(domain, { cname, soa })
        ? [
            ...addresses.map((value) => ({ type: 'A', name: domain, value })),
            ...addresses6.map((value) => ({ type: 'AAAA', name: domain, value, optional: true })),
        ]
        : [{ type: 'CNAME', name: domain, value: target }]
    const found = [
        ...cnames.map((value) => ({ type: 'CNAME', value })),
        // A CNAME's own addresses are the host's business, not the user's.
        ...(cnames.length > 0 ? [] : [
            ...a.records.map((value) => ({ type: 'A', value })),
            ...aaaa.records.map((value) => ({ type: 'AAAA', value })),
        ]),
    ]
    const failed = [cname, a, aaaa].map((result) => result.failed).filter(Boolean)
    return { domain, service: service.name, ok, expected, found, failed: [...new Set(failed)] }
}

// Log what checkDns found: "set up", or the records to set at the DNS
// provider. A missing or wrong record never fails the publish, since DNS
// changes take hours to spread.
export function reportDns({ domain, service, ok, expected, found, failed }, log) {
    if (ok) {
        log(`DNS for ${domain} is set up: it points to ${service}.`)
        return
    }
    const now = failed.length > 0 && found.length === 0
        ? `could not be checked (${failed.join(', ')})`
        : found.length === 0
            ? 'is not set up yet: it has no records'
            : `does not point to ${service} yet: it has ${found.map((record) => `${record.type} ${record.value}`).join(', ')}`
    log(`DNS for ${domain} ${now}. Set these records at your DNS provider${found.length > 0 ? ', in place of the ones it has' : ''}:`)
    const width = Math.max(...expected.map((record) => record.type.length))
    for (const record of expected) {
        log(`  ${record.type.padEnd(width)}  ${record.name}  ${record.value}${record.optional ? '  (optional, for IPv6)' : ''}`)
    }
    log('DNS changes can take a few hours to spread; the publish goes on, and every nera publish checks again.')
}
