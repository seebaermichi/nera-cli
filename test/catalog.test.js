import { describe, it, expect, vi } from 'vitest'
import { CATALOG_KINDS, CatalogError, listCatalog } from '../src/catalog.js'
import { BUNDLED_STARTERS } from '../src/starters.js'

// A registry search hit, shaped like `objects[].package` of /-/v1/search.
const hit = (name, description = `${name} description`) => ({
    package: {
        name,
        version: '1.0.0',
        description,
        links: { npm: `https://www.npmjs.com/package/${name}` },
    },
})

// What `keywords:<keyword>` returns.
const REGISTRY = {
    nera: [
        hit('@nera-static/nera'),
        hit('@nera-static/plugin-utils'),
        hit('@nera-static/plugin-tags', 'Tag clouds and tag pages'),
        hit('@nera-static/plugin-sitemap', 'sitemap.xml and robots.txt'),
        hit('@nera-static/starter-blog', 'A ready-to-edit blog'),
        hit('@nera-static/starter-blank'),
        hit('@nera-static/theme-blog'),
        hit('nera-cli'),
    ],
    'nera-plugin': [
        hit('@nera-static/plugin-sitemap', 'sitemap.xml and robots.txt'),
        hit('@nera-static/plugin-utils'),
        hit('@nera-static/plugin-new', 'An official plugin without the `nera` keyword'),
        hit('nera-plugin-emoji', 'Emoji shortcodes'),
    ],
    'nera-starter': [
        hit('@nera-static/starter-blog', 'A ready-to-edit blog'),
        hit('@acme/nera-starter-shop', 'A shop'),
        hit('nera-starter-docs', 'Documentation site'),
        hit('cool-site', 'Not readable as a starter name'),
    ],
    'nera-theme': [
        hit('@nera-static/theme-blog'),
        hit('@acme/theme-dark'),
        hit('nera-theme-unscoped', 'Read by --theme as @nera-static/theme-nera-theme-unscoped'),
    ],
}

const registry = () =>
    vi.fn(async (url) => {
        const keyword = new URL(url).searchParams.get('text').replace(/^keywords:/, '')
        return { ok: true, status: 200, json: async () => ({ objects: REGISTRY[keyword] ?? [] }) }
    })

const failing = async () => {
    throw new TypeError('fetch failed')
}

const packages = (items) => items.map((item) => item.package)

describe('listCatalog', () => {
    it('names its three kinds', () => {
        expect(CATALOG_KINDS).toEqual(['starters', 'themes', 'plugins'])
    })

    it('searches keyword nera and the kind keyword, 250 results, with the timeout', async () => {
        const fetch = registry()
        const timeout = vi.spyOn(AbortSignal, 'timeout')
        try {
            await listCatalog('themes', { fetch, timeout: 1234 })
            expect(fetch.mock.calls.map(([url]) => url).sort()).toEqual([
                'https://registry.npmjs.org/-/v1/search?text=keywords%3Anera&size=250',
                'https://registry.npmjs.org/-/v1/search?text=keywords%3Anera-theme&size=250',
            ])
            expect(timeout.mock.calls).toEqual([[1234], [1234]])
        } finally {
            timeout.mockRestore()
        }
    })

    it('lists official plugins by bare name first, then third-party ones, once each, without plugin-utils', async () => {
        expect(await listCatalog('plugins', { fetch: registry() })).toEqual([
            {
                name: 'new',
                package: '@nera-static/plugin-new',
                version: '1.0.0',
                description: 'An official plugin without the `nera` keyword',
                official: true,
                npm: 'https://www.npmjs.com/package/@nera-static/plugin-new',
            },
            expect.objectContaining({ name: 'sitemap', package: '@nera-static/plugin-sitemap', official: true }),
            expect.objectContaining({ name: 'tags', package: '@nera-static/plugin-tags', official: true }),
            expect.objectContaining({ name: 'nera-plugin-emoji', package: 'nera-plugin-emoji', official: false }),
        ])
    })

    it('offers only starters whose name --starter reads back as the same package', async () => {
        const starters = await listCatalog('starters', { fetch: registry() })
        expect(starters.map(({ name, package: pkg, official }) => [name, pkg, official])).toEqual([
            ['blank', '@nera-static/starter-blank', true],
            ['blog', '@nera-static/starter-blog', true],
            ['@acme/nera-starter-shop', '@acme/nera-starter-shop', false],
            ['nera-starter-docs', 'nera-starter-docs', false],
        ])
    })

    it('offers only themes whose name --theme reads back as the same package', async () => {
        expect(packages(await listCatalog('themes', { fetch: registry() }))).toEqual([
            '@nera-static/theme-blog',
            '@acme/theme-dark',
        ])
    })

    it('fills in a missing version, description and npm link', async () => {
        const fetch = async () => ({
            ok: true,
            json: async () => ({ objects: [{ package: { name: '@nera-static/theme-bare' } }, { nope: 1 }] }),
        })
        expect(await listCatalog('themes', { fetch })).toEqual([
            {
                name: 'bare',
                package: '@nera-static/theme-bare',
                version: null,
                description: '',
                official: true,
                npm: 'https://www.npmjs.com/package/@nera-static/theme-bare',
            },
        ])
    })

    it('falls back to the bundled official starters when the registry fails', async () => {
        const bundled = BUNDLED_STARTERS.map(({ name, package: pkg, description }) => ({
            name,
            package: pkg,
            version: null,
            description,
            official: true,
            npm: `https://www.npmjs.com/package/${pkg}`,
        }))
        expect(await listCatalog('starters', { fetch: failing })).toEqual(bundled)
        const notFound = async () => ({ ok: false, status: 404 })
        expect(await listCatalog('starters', { fetch: notFound })).toEqual(bundled)
    })

    it.each(['themes', 'plugins'])('throws a CatalogError for %s when the registry fails', async (kind) => {
        await expect(listCatalog(kind, { fetch: failing })).rejects.toThrow(CatalogError)
        await expect(listCatalog(kind, { fetch: failing })).rejects.toThrow(/could not be reached \(fetch failed\)/)
        const unavailable = async () => ({ ok: false, status: 503 })
        await expect(listCatalog(kind, { fetch: unavailable })).rejects.toThrow(/\(HTTP 503\)/)
        const odd = async () => ({ ok: true, json: async () => ({ nope: 1 }) })
        await expect(listCatalog(kind, { fetch: odd })).rejects.toThrow(/unexpected search result/)
    })

    it('rejects an unknown kind before asking the registry', async () => {
        const fetch = vi.fn()
        await expect(listCatalog('toString', { fetch })).rejects.toThrow(TypeError)
        await expect(listCatalog('layouts', { fetch })).rejects.toThrow(/Unknown catalog "layouts"/)
        expect(fetch).not.toHaveBeenCalled()
    })
})
