import { BUNDLED_STARTERS } from './starters.js'
import { starterSource } from './starter.js'
import { themePackageName, validateThemeSpec } from './scaffold.js'

const REGISTRY_SEARCH = 'https://registry.npmjs.org/-/v1/search'
// Every official package carries this keyword; not every one carries
// `nera-<kind>`, so the official packages are found through it.
const OFFICIAL_KEYWORD = 'nera'
const OFFICIAL_SCOPE = '@nera-static/'
// The most results one registry search returns.
const SEARCH_SIZE = 250
const DEFAULT_TIMEOUT_MS = 10000

const npmUrl = (pkg) => `https://www.npmjs.com/package/${pkg}`

// True when `read(name)` (how the consuming option reads a name) leads back to
// `pkg`. A name it rejects or reads as another package is not offered: an
// unscoped `cool-site` would be read as @nera-static/starter-cool-site.
const readsBackAs = (read) => (name, pkg) => {
    try {
        return read(name) === pkg
    } catch {
        return false
    }
}

// The three catalogs. `prefix` names the official packages of the kind,
// `keyword` finds third-party ones, `exclude` drops official non-members and
// `usable(name, pkg)` keeps only entries whose `name` the matching option
// (`--starter`, `--theme`, a plugin install) reads back as the same package.
const KINDS = {
    starters: {
        prefix: `${OFFICIAL_SCOPE}starter-`,
        keyword: 'nera-starter',
        exclude: new Set(),
        usable: readsBackAs((name) => starterSource(name).spec),
    },
    themes: {
        prefix: `${OFFICIAL_SCOPE}theme-`,
        keyword: 'nera-theme',
        exclude: new Set(),
        usable: readsBackAs((name) => themePackageName(validateThemeSpec(name))),
    },
    plugins: {
        prefix: `${OFFICIAL_SCOPE}plugin-`,
        keyword: 'nera-plugin',
        exclude: new Set([`${OFFICIAL_SCOPE}plugin-utils`]),
        usable: () => true,
    },
}

export const CATALOG_KINDS = Object.freeze(Object.keys(KINDS))

// The npm registry could not be reached or answered with something that is
// not a search result. `listCatalog` throws it for themes and plugins.
export class CatalogError extends Error {
    constructor(message) {
        super(message)
        this.name = 'CatalogError'
    }
}

async function search(fetch, text, timeout) {
    const url = `${REGISTRY_SEARCH}?text=${encodeURIComponent(text)}&size=${SEARCH_SIZE}`
    let body
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        body = await response.json()
    } catch (error) {
        throw new CatalogError(
            `The npm registry could not be reached (${error.message}), so the ` +
                'catalog is not available. Check the network connection and try ' +
                'again, or use a name you already know (official ones are listed ' +
                'on https://nera.js.org).'
        )
    }
    if (!Array.isArray(body?.objects)) {
        throw new CatalogError(
            'The npm registry answered with an unexpected search result, so the ' +
                'catalog is not available. Try again later.'
        )
    }
    return body.objects
        .map((object) => object?.package)
        .filter((pkg) => typeof pkg?.name === 'string')
}

const entry = (kind, pkg, official) => ({
    name: official ? pkg.name.slice(kind.prefix.length) : pkg.name,
    package: pkg.name,
    version: typeof pkg.version === 'string' ? pkg.version : null,
    description: typeof pkg.description === 'string' ? pkg.description : '',
    official,
    npm: typeof pkg.links?.npm === 'string' ? pkg.links.npm : npmUrl(pkg.name),
})

// The official starters shipped with the CLI, in catalog shape, for when the
// registry cannot be reached.
const bundledStarters = () =>
    BUNDLED_STARTERS.map(({ name, package: pkg, description }) => ({
        name,
        package: pkg,
        version: null,
        description,
        official: true,
        npm: npmUrl(pkg),
    }))

async function fromRegistry(kind, fetch, timeout) {
    const [officialHits, keywordHits] = await Promise.all([
        search(fetch, `keywords:${OFFICIAL_KEYWORD}`, timeout),
        search(fetch, `keywords:${kind.keyword}`, timeout),
    ])
    const official = [...officialHits, ...keywordHits].filter(
        (pkg) => pkg.name.startsWith(kind.prefix) && !kind.exclude.has(pkg.name)
    )
    const thirdParty = keywordHits.filter((pkg) => !pkg.name.startsWith(OFFICIAL_SCOPE))
    const byName = new Map()
    for (const [group, isOfficial] of [[official, true], [thirdParty, false]]) {
        const sorted = [...group].sort((a, b) => a.name.localeCompare(b.name))
        for (const pkg of sorted) {
            if (byName.has(pkg.name)) continue
            const item = entry(kind, pkg, isOfficial)
            if (kind.usable(item.name, item.package)) byName.set(pkg.name, item)
        }
    }
    return [...byName.values()]
}

/**
 * One catalog from the npm registry: the official `@nera-static/<kind>-*`
 * packages (found by keyword `nera`, plus those only `nera-<kind>` finds),
 * then third-party ones (keyword `nera-<kind>`), each group sorted by package
 * name, every package once. `name` is what `nera new` takes for it: the bare
 * name of an official package, the full package name otherwise.
 *
 * Starters fall back to the official starters bundled with the CLI when the
 * registry cannot be reached; themes and plugins throw a `CatalogError`.
 *
 * @param {'starters'|'themes'|'plugins'} kind
 * @param {{ fetch?: typeof fetch, timeout?: number }} [options] `timeout` in
 *     milliseconds, per registry request (two run in parallel)
 * @returns {Promise<Array<{ name: string, package: string, version: string|null,
 *     description: string, official: boolean, npm: string }>>}
 * @throws {CatalogError} for themes and plugins when the registry fails
 * @throws {TypeError} for an unknown kind
 */
export async function listCatalog(
    kind,
    { fetch = globalThis.fetch, timeout = DEFAULT_TIMEOUT_MS } = {}
) {
    if (!Object.hasOwn(KINDS, kind)) {
        throw new TypeError(
            `Unknown catalog "${kind}". Use one of: ${CATALOG_KINDS.join(', ')}.`
        )
    }
    try {
        return await fromRegistry(KINDS[kind], fetch, timeout)
    } catch (error) {
        if (kind === 'starters' && error instanceof CatalogError) return bundledStarters()
        throw error
    }
}
