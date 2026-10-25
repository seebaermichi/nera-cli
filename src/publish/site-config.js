import fs from 'fs/promises'
import path from 'path'
import { parseDocument } from 'yaml'

// The site's publish state, `config/publish.yaml` (ROADMAP-ai.md L6, D3):
//
//   target: github-pages
//   repository: owner/name
//
// Committed with the site, so the CLI, the hosted MCP and Nera Pro read the
// same. Holds no secret: tokens live in the keychain (credentials.js).

export const PUBLISH_CONFIG = path.join('config', 'publish.yaml')
const KEYS = ['target', 'repository']

export function publishConfigFile(cwd = process.cwd()) {
    return path.join(cwd, PUBLISH_CONFIG)
}

async function readIfExists(file) {
    try {
        return await fs.readFile(file, 'utf-8')
    } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
    }
}

// The file as a yaml Document, or null when there is none. Throws, naming the
// file, when it is not valid YAML or not a mapping.
async function readDocument(file) {
    const text = await readIfExists(file)
    if (text === null) return null
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
        throw new Error(`${PUBLISH_CONFIG} is not valid YAML: ${doc.errors[0].message}`)
    }
    const value = doc.toJS()
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        throw new Error(`${PUBLISH_CONFIG} must be a mapping of keys to values`)
    }
    return doc
}

// The known keys of the site's publish config, as `{ target?, repository? }`;
// `{}` when the file does not exist or is empty. A key that is set must be a
// non-empty string.
export async function readPublishConfig(cwd = process.cwd()) {
    const doc = await readDocument(publishConfigFile(cwd))
    const value = doc?.toJS() ?? {}
    const config = {}
    for (const key of KEYS) {
        if (value[key] === undefined || value[key] === null) continue
        if (typeof value[key] !== 'string' || value[key] === '') {
            throw new Error(`${PUBLISH_CONFIG}: "${key}" must be a text value`)
        }
        config[key] = value[key]
    }
    return config
}

// Set the given keys in the site's publish config, creating the file when it
// is missing. Comments and keys the CLI does not know are kept. Returns the
// config as readPublishConfig reads it afterwards.
export async function writePublishConfig(updates, cwd = process.cwd()) {
    const file = publishConfigFile(cwd)
    const doc = (await readDocument(file)) ?? parseDocument('')
    if (doc.contents === null) doc.contents = doc.createNode({})
    for (const [key, value] of Object.entries(updates)) {
        if (!KEYS.includes(key)) throw new TypeError(`Unknown ${PUBLISH_CONFIG} key "${key}"`)
        if (typeof value !== 'string' || value === '') {
            throw new TypeError(`${PUBLISH_CONFIG}: "${key}" must be a non-empty string`)
        }
        doc.set(key, value)
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, doc.toString())
    return readPublishConfig(cwd)
}
