import { isPlainObject } from '@nera-static/plugin-utils/values'
import { githubPages } from './pages.js'
import { netlify } from './netlify.js'
import { assertUploadStep } from './workflow.js'

// The hosts `nera publish` can deploy to. A target adapter is a plain object:
//
//   { id, label, summary?, setUp(ctx), uploadStep?, deployJob(ctx), liveUrl(ctx), leftBehind?(ctx) }
//
// `id` is what `--target` and `config/publish.yaml` name, `label` the name
// shown to people, the optional `summary` one line on what the host suits,
// shown next to the label when `nera publish` asks for the target. `setUp` prepares the host before the first push, `deployJob`
// returns `{ permissions, job }` for the generated workflow (workflow.js),
// the optional `uploadStep` (a step object `{ uses, with }`, no `name`)
// replaces the build job's upload of `public/` as the `site` artifact,
// `liveUrl` the site's address. The optional `leftBehind` returns the lines
// printed when a site moves away from this host: what is still online there
// and how to remove it, from what the run already knows (no sign-in to the
// old host). A new host is one adapter added to TARGETS; nothing else changes.

const ADAPTER_METHODS = ['setUp', 'deployJob', 'liveUrl']
const OPTIONAL_METHODS = ['leftBehind']
const ID_PATTERN = /^[a-z][a-z0-9-]*$/

// The registered adapters. The first, GitHub Pages, is the default when no
// target is named.
export const TARGETS = [githubPages, netlify]

// Throw when `adapter` does not have the interface above; return it otherwise.
export function assertAdapter(adapter) {
    if (!isPlainObject(adapter)) {
        throw new TypeError('A publish target must be an object')
    }
    const { id } = adapter
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        throw new TypeError(
            `A publish target needs an id of lowercase letters, digits and dashes, got ${JSON.stringify(id)}`,
        )
    }
    if (typeof adapter.label !== 'string' || adapter.label === '') {
        throw new TypeError(`Publish target "${id}" needs a label`)
    }
    if (adapter.summary !== undefined && (typeof adapter.summary !== 'string' || adapter.summary === '')) {
        throw new TypeError(`Publish target "${id}": summary must be a non-empty string when it is set`)
    }
    for (const method of ADAPTER_METHODS) {
        if (typeof adapter[method] !== 'function') {
            throw new TypeError(`Publish target "${id}" needs a ${method}() function`)
        }
    }
    for (const method of OPTIONAL_METHODS) {
        if (adapter[method] !== undefined && typeof adapter[method] !== 'function') {
            throw new TypeError(`Publish target "${id}": ${method} must be a function when it is set`)
        }
    }
    assertUploadStep(adapter)
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
