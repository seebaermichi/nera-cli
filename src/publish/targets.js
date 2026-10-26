import { githubPages } from './pages.js'

// The hosts `nera publish` can deploy to (ROADMAP-ai.md L6, D6). A target
// adapter is a plain object:
//
//   { id, label, setUp(ctx), deployJob(ctx), liveUrl(ctx) }
//
// `id` is what `--target` and `config/publish.yaml` name, `label` the name
// shown to people. `setUp` prepares the host before the first push, `deployJob`
// returns `{ permissions, job }` for the generated workflow (workflow.js),
// `liveUrl` the site's address. A new host is one adapter added to TARGETS; nothing else changes.

const ADAPTER_METHODS = ['setUp', 'deployJob', 'liveUrl']
const ID_PATTERN = /^[a-z][a-z0-9-]*$/

// The registered adapters. The first is the default when no target is named
// (D6: GitHub Pages); Netlify follows in its own issue.
export const TARGETS = [githubPages]

// Throw when `adapter` does not have the interface above; return it otherwise.
export function assertAdapter(adapter) {
    if (!adapter || typeof adapter !== 'object') {
        throw new TypeError('A publish target must be an object')
    }
    const { id } = adapter
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        throw new TypeError(`A publish target needs an id of lowercase letters, digits and dashes, got ${JSON.stringify(id)}`)
    }
    if (typeof adapter.label !== 'string' || adapter.label === '') {
        throw new TypeError(`Publish target "${id}" needs a label`)
    }
    for (const method of ADAPTER_METHODS) {
        if (typeof adapter[method] !== 'function') {
            throw new TypeError(`Publish target "${id}" needs a ${method}() function`)
        }
    }
    return adapter
}

// A registry over `adapters`, each checked by assertAdapter, ids unique.
// `ids()` lists them in registration order; `resolve(id)` returns the adapter,
// the first registered one when `id` is missing, or throws a message naming
// the registered ids.
export function createRegistry(adapters = TARGETS) {
    const byId = new Map()
    for (const adapter of adapters) {
        assertAdapter(adapter)
        if (byId.has(adapter.id)) {
            throw new TypeError(`Publish target "${adapter.id}" is registered twice`)
        }
        byId.set(adapter.id, adapter)
    }

    const ids = () => [...byId.keys()]
    const available = () =>
        byId.size === 0
            ? 'No publish target is available in this version of Nera yet.'
            : `Available targets: ${ids().join(', ')}.`

    return {
        ids,
        resolve(id) {
            if (id === undefined || id === '') {
                const [first] = byId.values()
                if (first) return first
                throw new Error(`Name a target with --target <id>. ${available()}`)
            }
            const adapter = byId.get(id)
            if (!adapter) throw new Error(`Unknown publish target "${id}". ${available()}`)
            return adapter
        },
    }
}
