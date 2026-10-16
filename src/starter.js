import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import path from 'path'
import { BUNDLED_STARTERS } from './starters.js'

// What `--starter` accepts (ROADMAP-ai.md L5), validated before anything is
// written because the package forms end up on the npm command line:
//   blank                                  → @nera-static/starter-blank
//   @acme/starter-x, nera-starter-x        → verbatim
//   https://github.com/o/r[.git][#ref]     → github:o/r[#ref]
//   github:o/r[#ref]                       → verbatim
//   ./x, ../x, /abs/x                      → read in place
const BARE_STARTER = /^[a-z0-9][a-z0-9._-]*$/
const SCOPED_STARTER = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const UNSCOPED_STARTER = /^nera-starter-[a-z0-9][a-z0-9._-]*$/
const GH_OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?'
const GH_REPO = '[A-Za-z0-9._-]+?'
const GH_REF = '[A-Za-z0-9._][A-Za-z0-9._/-]*'
const GITHUB_URL = new RegExp(
    `^https://github\\.com/(${GH_OWNER})/(${GH_REPO})(?:\\.git)?(?:#(${GH_REF}))?$`
)
const GITHUB_SHORT = new RegExp(
    `^github:(${GH_OWNER})/(${GH_REPO})(?:\\.git)?(?:#(${GH_REF}))?$`
)
// LOCAL_THEME in scaffold.js, plus absolute paths.
const LOCAL_STARTER = /^(?:\.{1,2}(?:\/[A-Za-z0-9._-]+)*|(?:\/[A-Za-z0-9._-]+)+)\/?$/

const isLocal = (spec) => LOCAL_STARTER.test(spec)

export function validateStarterSpec(spec) {
    if (
        typeof spec === 'string' &&
        (BARE_STARTER.test(spec) ||
            SCOPED_STARTER.test(spec) ||
            UNSCOPED_STARTER.test(spec) ||
            GITHUB_URL.test(spec) ||
            GITHUB_SHORT.test(spec) ||
            isLocal(spec))
    ) {
        return spec
    }
    throw new Error(
        `Invalid starter "${spec}". Use a starter name (blank), a package ` +
            'name (@scope/starter-x or nera-starter-x), a GitHub URL ' +
            '(https://github.com/owner/repo#ref or github:owner/repo) or a ' +
            'local path (./my-starter).'
    )
}

// Where a (valid) spec comes from: a folder read in place, or a spec for
// `npm pack`.
export function starterSource(spec) {
    validateStarterSpec(spec)
    if (isLocal(spec)) return { kind: 'local', path: spec }
    const gh = spec.match(GITHUB_URL) ?? spec.match(GITHUB_SHORT)
    if (gh) {
        const [, owner, repo, ref] = gh
        return { kind: 'npm', spec: `github:${owner}/${repo}${ref ? `#${ref}` : ''}` }
    }
    if (spec.startsWith('@') || UNSCOPED_STARTER.test(spec)) {
        return { kind: 'npm', spec }
    }
    return { kind: 'npm', spec: `@nera-static/starter-${spec}` }
}

const downloadError = (spec, npmSpec, err) => {
    const said = String(err?.stderr ?? '')
        .split('\n')
        .find((l) => /^npm (error|ERR!) /.test(l) && !/ (code|errno) |A complete log/.test(l))
    return new Error(
        `Could not download the starter "${spec}" (npm pack ${npmSpec} failed` +
            `${said ? `: ${said.replace(/^npm (error|ERR!)\s*/, '')}` : ''}). ` +
            'Check the starter name for typos and your network connection, ' +
            'then run `nera new` again.'
    )
}

// Download a package or GitHub starter into a temp folder: `npm pack` (with
// --ignore-scripts, so a git dependency's `prepare` never runs) and `tar`.
// npm tarballs unpack to `package/`. The temp folder is gone on failure, and
// `cleanup()` removes it after use. `exec` is injectable for tests.
export async function packStarter(npmSpec, { spec = npmSpec, exec = execFileSync } = {}) {
    console.log(`📦 Downloading the starter "${spec}"...`)
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-starter-'))
    const cleanup = () => fs.rm(tmp, { recursive: true, force: true })
    try {
        const packDir = path.join(tmp, 'pack')
        const outDir = path.join(tmp, 'out')
        await fs.mkdir(packDir)
        await fs.mkdir(outDir)
        try {
            exec(
                'npm',
                ['pack', npmSpec, '--ignore-scripts', '--pack-destination', packDir],
                { stdio: 'pipe', encoding: 'utf-8' }
            )
        } catch (err) {
            throw downloadError(spec, npmSpec, err)
        }
        const tarball = (await fs.readdir(packDir)).find((n) => n.endsWith('.tgz'))
        if (!tarball) throw downloadError(spec, npmSpec)
        exec('tar', ['-xzf', path.join(packDir, tarball), '-C', outDir], {
            stdio: 'pipe',
        })
        return { dir: path.join(outDir, 'package'), cleanup }
    } catch (err) {
        await cleanup()
        throw err
    }
}

// The starter as a folder on disk plus a `cleanup()`. A local path is read in
// place (relative to `cwd`) and needs no cleanup.
export async function fetchStarter(spec, { cwd = process.cwd(), pack = packStarter } = {}) {
    const source = starterSource(spec)
    if (source.kind === 'local') {
        const dir = path.resolve(cwd, source.path)
        if (!fssync.existsSync(dir)) {
            throw new Error(
                `Starter folder "${spec}" not found (looked in ${dir}). ` +
                    'Check the path; a local starter is a folder with a package.json.'
            )
        }
        return { dir, cleanup: async () => {} }
    }
    return pack(source.spec, { spec })
}

// The starter's package.json. Only a package with a `nera.starter` field is a
// starter; anything else is refused before the site is written.
export async function readStarterManifest(dir, spec = dir) {
    let pkg
    try {
        pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'))
    } catch {
        throw new Error(
            `"${spec}" is not a Nera starter: it has no readable package.json. ` +
                'A starter is a folder whose package.json has a `nera.starter` field.'
        )
    }
    const starter = pkg?.nera?.starter
    if (!starter || typeof starter !== 'object') {
        throw new Error(
            `"${spec}" is not a Nera starter: its package.json has no ` +
                '`nera.starter` field.'
        )
    }
    return pkg
}

// Does the starter's config/app.yaml pick a theme? Then the base template's
// own views (nera:scaffold-default) are left out, as with `--theme`.
export async function starterSetsTheme(dir) {
    try {
        const yaml = await fs.readFile(path.join(dir, 'config', 'app.yaml'), 'utf-8')
        return /^theme:[ \t]*[^\s#]/m.test(yaml)
    } catch {
        return false
    }
}

// The only parts of a starter copied into the site. Never its package.json,
// AGENTS.md, CLAUDE.md, .claude/, .agents/, node_modules/ or anything else.
export const STARTER_ENTRIES = ['pages', 'config', 'theme', 'assets', 'plugins', '.neraignore']

// The site's own CLI dependency is never replaced by a starter's.
const OWN_PACKAGE = '@nera-static/nera'

// Lay the starter over a scaffolded site, file by file (the starter wins),
// and merge its `dependencies` into the site's package.json. Symlinks are not
// copied. Returns the "First steps" section of the starter's README, or null.
export async function applyStarter(targetDir, starterDir) {
    const pkg = await readStarterManifest(starterDir)
    const notLink = async (src) => !(await fs.lstat(src)).isSymbolicLink()
    for (const entry of STARTER_ENTRIES) {
        const from = path.join(starterDir, entry)
        if (!fssync.existsSync(from) || !(await notLink(from))) continue
        await fs.cp(from, path.join(targetDir, entry), {
            recursive: true,
            force: true,
            filter: notLink,
        })
    }

    const deps = Object.fromEntries(
        Object.entries(pkg.dependencies ?? {}).filter(
            ([name, range]) => name !== OWN_PACKAGE && typeof range === 'string'
        )
    )
    if (Object.keys(deps).length > 0) {
        const pkgPath = path.join(targetDir, 'package.json')
        const site = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
        site.dependencies = { ...site.dependencies, ...deps }
        await fs.writeFile(pkgPath, `${JSON.stringify(site, null, 4)}\n`)
    }

    const label = pkg.nera.starter.label ?? pkg.name
    console.log(`  ✓ Applied the "${label}" starter${pkg.name ? ` (${pkg.name})` : ''}`)

    try {
        return firstStepsSection(await fs.readFile(path.join(starterDir, 'README.md'), 'utf-8'))
    } catch {
        return null
    }
}

const FIRST_STEPS = /^## +first steps *#* *$/i
const SECTION_END = /^#{1,2} /
const FENCE = /^ {0,3}(`{3,}|~{3,})/

// The `## First steps` section of a starter README, from its heading to the
// next `#`/`## ` heading or the end, trimmed; null when there is none. Headings
// inside fenced code blocks do not count. Line endings come back as `\n`.
export function firstStepsSection(readme) {
    const lines = readme.replace(/\r\n?/g, '\n').split('\n')
    let fence = null
    let start = -1
    let end = lines.length
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const marker = FENCE.exec(line)?.[1]
        if (fence) {
            // A fence closes on the same character, at least as long, alone on its line.
            const closes = marker && marker[0] === fence[0] && marker.length >= fence.length
            if (closes && line.trim() === marker) fence = null
            continue
        }
        if (marker) {
            fence = marker
            continue
        }
        if (start < 0) {
            if (FIRST_STEPS.test(line)) start = i
        } else if (SECTION_END.test(line)) {
            end = i
            break
        }
    }
    if (start < 0) return null
    return lines.slice(start, end).join('\n').trim()
}

const REGISTRY_SEARCH =
    'https://registry.npmjs.org/-/v1/search?text=keywords:nera-starter&size=50'
const OFFICIAL_PREFIX = '@nera-static/'
const OFFICIAL_STARTER_PREFIX = '@nera-static/starter-'

// The name the picker shows and `--starter` takes: the bare name for an
// official starter, the full package name otherwise.
const displayName = (pkg) =>
    pkg.startsWith(OFFICIAL_STARTER_PREFIX) ? pkg.slice(OFFICIAL_STARTER_PREFIX.length) : pkg

// Only results whose shown name leads back to the same package: an unscoped
// `cool-site` would otherwise be offered as `cool-site`, which `--starter`
// reads as @nera-static/starter-cool-site.
const roundTrips = ({ name, package: pkg }) => {
    try {
        return starterSource(name).spec === pkg
    } catch {
        return false
    }
}

// The starters on npm (keyword `nera-starter`), official ones first, then
// alphabetically: `[{ name, package, description }]`. Labels come from the
// search result's description; manifests are not fetched. On any failure
// (offline, timeout, non-200, bad JSON) the bundled list is returned instead.
export async function listStarters({ fetch = globalThis.fetch, timeout = 3000 } = {}) {
    try {
        const res = await fetch(REGISTRY_SEARCH, { signal: AbortSignal.timeout(timeout) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = await res.json()
        if (!Array.isArray(body?.objects)) throw new Error('unexpected response')
        const seen = new Set()
        return body.objects
            .map((o) => o?.package)
            .filter((p) => typeof p?.name === 'string' && !seen.has(p.name) && seen.add(p.name))
            .map((p) => ({
                name: displayName(p.name),
                package: p.name,
                description: typeof p.description === 'string' ? p.description : '',
            }))
            .filter(roundTrips)
            .sort((a, b) => {
                const official = (s) => (s.package.startsWith(OFFICIAL_PREFIX) ? 0 : 1)
                return official(a) - official(b) || a.package.localeCompare(b.package)
            })
    } catch {
        return BUNDLED_STARTERS.map(({ name, package: pkg, label, description }) => ({
            name,
            package: pkg,
            description: label ? `${label}: ${description}` : description,
        }))
    }
}
