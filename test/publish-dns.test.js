import { describe, it, expect } from 'vitest'
import { checkDns, reportDns } from '../src/publish/dns.js'
import { PAGES_A, PAGES_AAAA, pagesDns } from '../src/publish/pages.js'
import { NETLIFY_A, netlifyDns } from '../src/publish/netlify.js'
import { fakeResolver } from './helpers/fake-dns.js'

// The DNS check of `nera publish --domain` (ROADMAP-ai.md L6, plan D7 of the
// Netlify issue), shared by the targets: each describes its records as a
// service. DNS is a stub resolver; no test makes a real lookup.

describe('checkDns for GitHub Pages', () => {
    const check = (domain, records) => checkDns({ domain, service: pagesDns('Octo'), resolver: fakeResolver(records) })

    it('an apex domain: GitHub\'s A records (AAAA optional) are expected', async () => {
        const result = await check('example.com', {})
        expect(result.expected).toEqual([
            ...PAGES_A.map((value) => ({ type: 'A', name: 'example.com', value })),
            ...PAGES_AAAA.map((value) => ({ type: 'AAAA', name: 'example.com', value, optional: true })),
        ])
        expect(result).toMatchObject({ domain: 'example.com', ok: false, found: [], failed: [] })
    })

    it('a subdomain: a CNAME to <owner>.github.io, in lower case, is expected', async () => {
        const result = await check('www.example.com', {})
        expect(result.expected).toEqual([{ type: 'CNAME', name: 'www.example.com', value: 'octo.github.io' }])
    })

    it.each([
        ['an apex with GitHub\'s four A records', 'example.com', { A: PAGES_A }],
        ['an apex with GitHub\'s A and AAAA records', 'example.com', { A: PAGES_A, AAAA: PAGES_AAAA }],
        ['an apex with a flattened CNAME (ALIAS) to <owner>.github.io', 'example.com', { CNAME: ['octo.github.io'], A: PAGES_A }],
        ['a subdomain with a CNAME to <owner>.github.io.', 'www.example.com', { CNAME: ['Octo.GitHub.io.'], A: PAGES_A }],
        ['a subdomain with GitHub\'s A records instead of a CNAME', 'www.example.com', { A: PAGES_A.slice(0, 2) }],
    ])('set up: %s', async (_, domain, records) => {
        const result = await check(domain, records)
        expect(result.ok).toBe(true)
        expect(result.failed).toEqual([])
    })

    it.each([
        ['an A record elsewhere', 'example.com', { A: ['203.0.113.7'] }, [{ type: 'A', value: '203.0.113.7' }]],
        ['GitHub\'s A records next to one elsewhere', 'example.com', { A: [...PAGES_A, '203.0.113.7'] }, [...PAGES_A, '203.0.113.7'].map((value) => ({ type: 'A', value }))],
        ['an AAAA record elsewhere', 'example.com', { A: PAGES_A, AAAA: ['2001:db8::1'] }, [...PAGES_A.map((value) => ({ type: 'A', value })), { type: 'AAAA', value: '2001:db8::1' }]],
        ['a CNAME to another github.io', 'www.example.com', { CNAME: ['someone.github.io'], A: PAGES_A }, [{ type: 'CNAME', value: 'someone.github.io' }]],
        ['only AAAA records', 'example.com', { AAAA: PAGES_AAAA }, PAGES_AAAA.map((value) => ({ type: 'AAAA', value }))],
    ])('not set up: %s', async (_, domain, records, found) => {
        const result = await check(domain, records)
        expect(result.ok).toBe(false)
        expect(result.found).toEqual(found)
    })

    it.each([['ETIMEOUT'], ['ESERVFAIL'], ['ECONNREFUSED']])('a lookup failing with %s is reported, never thrown', async (code) => {
        const result = await check('example.com', { CNAME: code, A: code, AAAA: code })
        expect(result).toMatchObject({ ok: false, found: [], failed: [code] })
    })

    it('ENOTFOUND and ENODATA mean "no records", not a failed lookup', async () => {
        const result = await check('example.com', { CNAME: 'ENOTFOUND', A: 'ENODATA' })
        expect(result).toMatchObject({ ok: false, found: [], failed: [] })
    })
})

describe('reportDns for GitHub Pages', () => {
    const report = (result) => {
        const lines = []
        reportDns(result, (line) => lines.push(line))
        return lines
    }
    const cnameExpected = [{ type: 'CNAME', name: 'www.example.com', value: 'octo.github.io' }]
    const NOTE = 'DNS changes can take a few hours to spread; the publish goes on, and every nera publish checks again.'

    it('set up: one line', () => {
        expect(report({ domain: 'www.example.com', service: 'GitHub Pages', ok: true, expected: cnameExpected, found: [], failed: [] }))
            .toEqual(['DNS for www.example.com is set up: it points to GitHub Pages.'])
    })

    it('wrong records: what it has, what to set in their place', () => {
        expect(report({ domain: 'www.example.com', service: 'GitHub Pages', ok: false, expected: cnameExpected, found: [{ type: 'A', value: '203.0.113.7' }], failed: [] })).toEqual([
            'DNS for www.example.com does not point to GitHub Pages yet: it has A 203.0.113.7. Set these records at your DNS provider, in place of the ones it has:',
            '  CNAME  www.example.com  octo.github.io',
            NOTE,
        ])
    })

    it('a failed lookup: could not be checked, the records to set', () => {
        expect(report({ domain: 'www.example.com', service: 'GitHub Pages', ok: false, expected: cnameExpected, found: [], failed: ['ETIMEOUT'] })).toEqual([
            'DNS for www.example.com could not be checked (ETIMEOUT). Set these records at your DNS provider:',
            '  CNAME  www.example.com  octo.github.io',
            NOTE,
        ])
    })
})

describe('checkDns for Netlify', () => {
    const check = (domain, records) => checkDns({ domain, service: netlifyDns({ id: 'site-1', name: 'my-site' }), resolver: fakeResolver(records) })

    it('an apex domain: the A record of Netlify\'s load balancer, and no AAAA', async () => {
        const result = await check('example.com', {})
        expect(result.expected).toEqual([{ type: 'A', name: 'example.com', value: '75.2.60.5' }])
        expect(result).toMatchObject({ domain: 'example.com', service: 'Netlify', ok: false, found: [], failed: [] })
    })

    it('a subdomain: a CNAME to <site>.netlify.app', async () => {
        const result = await check('www.example.com', {})
        expect(result.expected).toEqual([{ type: 'CNAME', name: 'www.example.com', value: 'my-site.netlify.app' }])
    })

    it.each([
        ['an apex with Netlify\'s A record', 'example.com', { A: NETLIFY_A }],
        ['a subdomain with a CNAME to <site>.netlify.app.', 'www.example.com', { CNAME: ['My-Site.Netlify.app.'] }],
    ])('set up: %s', async (_, domain, records) => {
        expect((await check(domain, records)).ok).toBe(true)
    })

    it.each([
        ['GitHub Pages\' A records', 'example.com', { A: PAGES_A }],
        ['Netlify\'s A record next to an AAAA record', 'example.com', { A: NETLIFY_A, AAAA: ['2001:db8::1'] }],
        ['a CNAME to another Netlify site', 'www.example.com', { CNAME: ['other.netlify.app'] }],
    ])('not set up: %s', async (_, domain, records) => {
        expect((await check(domain, records)).ok).toBe(false)
    })

    it('a site without a name cannot name its records', () => {
        expect(() => netlifyDns({ id: 'site-1' })).toThrow('Netlify sent no name for the site site-1')
    })
})

describe('reportDns for Netlify', () => {
    it('names Netlify where GitHub Pages names GitHub Pages', () => {
        const lines = []
        const log = (line) => lines.push(line)
        const expected = [{ type: 'A', name: 'example.com', value: '75.2.60.5' }]
        reportDns({ domain: 'example.com', service: 'Netlify', ok: true, expected, found: [], failed: [] }, log)
        reportDns({ domain: 'example.com', service: 'Netlify', ok: false, expected, found: [{ type: 'A', value: PAGES_A[0] }], failed: [] }, log)
        expect(lines.slice(0, 3)).toEqual([
            'DNS for example.com is set up: it points to Netlify.',
            `DNS for example.com does not point to Netlify yet: it has A ${PAGES_A[0]}. ` +
                'Set these records at your DNS provider, in place of the ones it has:',
            '  A  example.com  75.2.60.5',
        ])
    })
})

describe('checkDns: apex or subdomain', () => {
    const SOA = { nsname: 'ns1.example.net', hostmaster: 'hostmaster.example.net', serial: 1, refresh: 3600, retry: 600, expire: 86400, minttl: 300 }
    const check = (domain, records) => {
        const resolver = fakeResolver(records)
        return { result: checkDns({ domain, service: netlifyDns({ id: 'site-1', name: 'my-site' }), resolver }), resolver }
    }
    const types = async (pending) => (await pending).expected.map((record) => record.type)

    it('a name with its own SOA is an apex: example.co.uk gets the A record', async () => {
        const { result } = check('example.co.uk', { SOA })
        expect((await result).expected).toEqual([{ type: 'A', name: 'example.co.uk', value: '75.2.60.5' }])
    })

    it('a delegated zone of three labels is an apex too', async () => {
        expect(await types(check('shop.example.com', { SOA, A: ['203.0.113.7'] }).result)).toEqual(['A'])
    })

    it('a subdomain without an SOA gets the CNAME', async () => {
        const { result } = check('www.example.com', {})
        expect((await result).expected).toEqual([{ type: 'CNAME', name: 'www.example.com', value: 'my-site.netlify.app' }])
    })

    it('an SOA answered for a name with a CNAME is the target zone\'s, not an apex', async () => {
        expect(await types(check('www.example.com', { CNAME: ['example.com'], SOA }).result)).toEqual(['CNAME'])
    })

    it('an SOA next to a failed CNAME lookup does not count', async () => {
        expect(await types(check('www.example.com', { CNAME: 'ETIMEOUT', SOA }).result)).toEqual(['CNAME'])
    })

    it.each([['ETIMEOUT'], ['ESERVFAIL'], ['ENOTFOUND']])('an SOA lookup failing with %s falls back to the label rule, never throws, and is not reported', async (code) => {
        const sub = await check('www.example.com', { SOA: code }).result
        expect(sub.expected.map((record) => record.type)).toEqual(['CNAME'])
        expect(sub.failed).toEqual([])
        expect(await types(check('example.com', { SOA: code }).result)).toEqual(['A'])
    })

    it('a two-label name is an apex without an SOA lookup', async () => {
        const { result, resolver } = check('example.com', {})
        expect(await types(result)).toEqual(['A'])
        expect(resolver.lookups.sort()).toEqual(['A example.com', 'AAAA example.com', 'CNAME example.com'])
    })

    it('a longer name looks its SOA up once', async () => {
        const { result, resolver } = check('www.example.com', {})
        await result
        expect(resolver.lookups.sort()).toEqual(['A www.example.com', 'AAAA www.example.com', 'CNAME www.example.com', 'SOA www.example.com'])
    })

    it('GitHub Pages gets the same rule: example.co.uk with an SOA gets GitHub\'s A records', async () => {
        const result = await checkDns({ domain: 'example.co.uk', service: pagesDns('Octo'), resolver: fakeResolver({ SOA }) })
        expect(result.expected.map((record) => record.type)).toEqual([...PAGES_A.map(() => 'A'), ...PAGES_AAAA.map(() => 'AAAA')])
    })
})
