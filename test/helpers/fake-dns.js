// A stub node:dns/promises resolver for the DNS check of `nera publish
// --domain` (src/publish/dns.js), so no test makes a real DNS lookup.
// `records` maps a type (CNAME, A, AAAA, SOA) to the values it resolves (for
// SOA the one record object resolveSoa answers), or to an error code the
// lookup fails with; a type not named has no records (ENODATA), so a name
// has no SOA unless a test gives it one. `lookups` records every lookup as
// "TYPE name".
export function fakeResolver(records = {}) {
    const lookups = []
    const answer = (type) => async (name) => {
        lookups.push(`${type} ${name}`)
        const value = records[type] ?? 'ENODATA'
        if (typeof value === 'string') throw Object.assign(new Error(`query ${type} ${value} ${name}`), { code: value })
        return value
    }
    return { resolveCname: answer('CNAME'), resolve4: answer('A'), resolve6: answer('AAAA'), resolveSoa: answer('SOA'), lookups }
}
