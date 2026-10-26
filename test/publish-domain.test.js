import { describe, it, expect } from 'vitest'
import { normalizeDomain } from '../src/publish/domain.js'

// `--domain <host>` (ROADMAP-ai.md L6): one host name, lower case, or an
// error that says what to pass instead.

describe('normalizeDomain', () => {
    it('accepts an apex or a subdomain, lower-cased, trailing root dot dropped', () => {
        expect(normalizeDomain('example.com')).toBe('example.com')
        expect(normalizeDomain('WWW.Example.COM')).toBe('www.example.com')
        expect(normalizeDomain(' blog.example.co.uk. ')).toBe('blog.example.co.uk')
        expect(normalizeDomain('xn--bcher-kva.de')).toBe('xn--bcher-kva.de')
        expect(normalizeDomain('my-site.example.org')).toBe('my-site.example.org')
        expect(normalizeDomain(`${'abcdefghi.'.repeat(25)}com`)).toHaveLength(253)
    })

    it.each([
        ['https://example.com', 'without the scheme'],
        ['http://example.com/', 'without the scheme'],
        ['example.com/blog', 'without a path'],
        ['example.com:8080', 'without a port'],
        ['*.example.com', 'a wildcard cannot be a custom domain'],
        ['192.168.1.10', 'an IP address cannot be a custom domain'],
        ['2001:db8::1', 'an IP address cannot be a custom domain'],
        ['[2001:db8::1]', 'an IP address cannot be a custom domain'],
        ['localhost', 'not a host name'],
        ['exa_mple.com', 'not a host name'],
        ['-example.com', 'not a host name'],
        ['example-.com', 'not a host name'],
        ['example..com', 'not a host name'],
        ['bücher.de', 'the punycode form'],
        ['1.2.3.999', 'not a host name'],
        [`${'a'.repeat(64)}.com`, 'not a host name'],
        [`${'abcdefghi.'.repeat(26)}com`, 'not a host name'],
        ['me.github.io', 'publish without --domain'],
        ['GitHub.io', 'publish without --domain'],
        ['docs.me.github.io', 'publish without --domain'],
    ])('refuses %s, saying what to pass', (value, why) => {
        expect(() => normalizeDomain(value)).toThrow(why)
        expect(() => normalizeDomain(value)).toThrow(`--domain ${JSON.stringify(value)}`)
    })

    it('every refusal of a malformed value shows an example to pass', () => {
        expect(() => normalizeDomain('https://example.com')).toThrow('e.g. --domain example.com')
        expect(() => normalizeDomain('nope')).toThrow('e.g. --domain example.com')
    })
})
