import fs from 'node:fs/promises'
import path from 'node:path'
import { parseDocument } from 'yaml'

// The site's publish state, `config/publish.yaml` (ROADMAP-ai.md L6, D3):
//
//   target: github-pages
//   repository: owner/name
//   netlify:
//       site_id: <the Netlify site's id>    (the netlify target only)
//
// Committed with the site, so the CLI, the hosted MCP and Nera Pro read the
// same. Holds no secret: tokens live in the keychain (credentials.js).

export const PUBLISH_CONFIG = path.join('config', 'publish.yaml')
const KEYS = ['target', 'repository']
// Keys that hold a mapping of text values, and the keys each mapping knows.
const SECTIONS = { netlify: ['site_id'] }

const isMapping = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

// GitHub's rules for an account name and a repository name. A repository
// name is letters, digits, `.`, `-` and `_`, at most 100 characters, neither
// `.` nor `..`, and GitHub strips a trailing `.git`, so that is refused too.
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/

export function isValidRepoName(name) {
    return typeof name === 'string'
        && REPO_NAME_PATTERN.test(name)
        && name !== '.' && name !== '..'
        && !name.toLowerCase().endsWith('.git')
}

// `owner/name` split into `{ owner, name }`; throws, naming the file, when
// the value is not of that form.
export function parseRepository(value) {
    const parts = typeof value === 'string' ? value.split('/') : []
    if (parts.length !== 2 || !OWNER_PATTERN.test(parts[0]) || !isValidRepoName(parts[1])) {
        throw new Error(`${PUBLISH_CONFIG}: "repository" must be owner/name, got ${JSON.stringify(value)}`)
    }
    return { owner: parts[0], name: parts[1] }
}

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

// The known keys of the site's publish config, as `{ target?, repository?,
// netlify?: { site_id? } }`; `{}` when the file does not exist or is empty. A
// key that is set must be a non-empty string; a section must be a mapping,
// and one without a known key is left out.
export async function readPublishConfig(cwd = process.cwd()) {
    const doc = await readDocument(publishConfigFile(cwd))
    const value = doc?.toJS() ?? {}
    const config = {}
    for (const key of KEYS) {
        if (value[key] === undefined || value[key] === null) continue
        if (typeof value[key] !== 'string' || value[key] === '') {
            throw new Error(`${PUBLISH_CONFIG}: "${key}" must be a text value`)
        }
        if (key === 'repository') parseRepository(value[key])
        config[key] = value[key]
    }
    for (const [section, keys] of Object.entries(SECTIONS)) {
        if (value[section] === undefined || value[section] === null) continue
        if (!isMapping(value[section])) throw new Error(`${PUBLISH_CONFIG}: "${section}" must be a mapping`)
        const entries = {}
        for (const key of keys) {
            const entry = value[section][key]
            if (entry === undefined || entry === null) continue
            if (typeof entry !== 'string' || entry === '') {
                throw new Error(`${PUBLISH_CONFIG}: "${section}.${key}" must be a text value`)
            }
            entries[key] = entry
        }
        if (Object.keys(entries).length > 0) config[section] = entries
    }
    return config
}

// `value` checked as the non-empty string `name` must be.
function assertText(name, value) {
    if (typeof value !== 'string' || value === '') {
        throw new TypeError(`${PUBLISH_CONFIG}: "${name}" must be a non-empty string`)
    }
}

// Set the given keys in the site's publish config, creating the file when it
// is missing; a section (`netlify: { site_id }`) sets the keys it names and
// keeps its others. Comments and keys the CLI does not know are kept.
// Returns the config as readPublishConfig reads it afterwards.
export async function writePublishConfig(updates, cwd = process.cwd()) {
    const file = publishConfigFile(cwd)
    const text = (await readIfExists(file)) ?? ''
    const doc = (await readDocument(file)) ?? parseDocument('')
    if (doc.contents === null) doc.contents = doc.createNode({})
    for (const [key, value] of Object.entries(updates)) {
        if (Object.hasOwn(SECTIONS, key)) {
            if (!isMapping(value)) throw new TypeError(`${PUBLISH_CONFIG}: "${key}" must be a mapping`)
            for (const [entry, entryValue] of Object.entries(value)) {
                if (!SECTIONS[key].includes(entry)) throw new TypeError(`Unknown ${PUBLISH_CONFIG} key "${key}.${entry}"`)
                assertText(`${key}.${entry}`, entryValue)
            }
            const current = doc.toJS()?.[key]
            if (current === undefined || current === null) {
                doc.set(key, doc.createNode({}))
            } else if (!isMapping(current)) {
                throw new Error(`${PUBLISH_CONFIG}: "${key}" must be a mapping`)
            }
            for (const [entry, entryValue] of Object.entries(value)) doc.setIn([key, entry], entryValue)
            continue
        }
        if (!KEYS.includes(key)) throw new TypeError(`Unknown ${PUBLISH_CONFIG} key "${key}"`)
        assertText(key, value)
        if (key === 'repository') parseRepository(value)
        doc.set(key, value)
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    // A section keeps the nesting indent the user's file already has.
    const indent = /^( +)[^\s#-]/m.exec(text)?.[1].length ?? 2
    await fs.writeFile(file, doc.toString({ indent }))
    return readPublishConfig(cwd)
}
