import fs from 'node:fs/promises'
import path from 'node:path'
import { resolveSiteModel } from '@nera-static/core'
import { pluginPackage } from '@nera-static/plugin-utils/packages'
import { isInside } from '@nera-static/plugin-utils/urls'
import { classifyProject } from './commands/update.js'
import { runNpmAsync, spawnChild } from './npm.js'

// The `bin` entry a plugin ships its template publishing under.
const TEMPLATE_SCRIPT = 'publish-template.js'

// Only a thin site (one that depends on @nera-static/nera) takes a plugin:
// in any other folder `npm install` would create or change a package.json
// that is no Nera site.
async function assertThinSite(cwd) {
    let pkg = null
    try {
        pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf-8'))
    } catch (err) {
        if (err instanceof SyntaxError) {
            throw new Error(`${path.join(cwd, 'package.json')} is not valid JSON: ${err.message}`, { cause: err })
        }
        if (err.code !== 'ENOENT') throw err
    }
    const kind = pkg ? classifyProject(pkg, cwd) : 'unknown'
    if (kind === 'legacy') {
        throw new Error(
            `${cwd} is a legacy Nera site (a clone that vendors the engine). ` +
                'Run `nera update --migrate` first, then add the plugin.',
        )
    }
    if (kind !== 'thin') {
        throw new Error(
            `${cwd} is not a Nera site: no package.json there depends on ` +
                '@nera-static/nera. Run this in a site\'s folder, or create one with `nera new`.',
        )
    }
}

// The real path of `relative` inside the package `packageDir`, or null when
// it does not exist. `outside` is true when it leads out of the package (a
// `..` or a symbolic link), which a caller must never use.
async function resolveInPackage(packageDir, relative) {
    let real
    try {
        real = await fs.realpath(path.resolve(packageDir, relative))
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
        throw err
    }
    const outside = !isInside(await fs.realpath(packageDir), real, { self: false })
    return { real, outside }
}

// Copy the package's `config/<name>.yaml` into the site's config folder
// unless the site has one already. COPYFILE_EXCL makes "already there" the
// file system's call, so an existing file is never opened for writing.
async function copyDefaultConfig(cwd, packageDir, name) {
    const { folders } = resolveSiteModel({ cwd })
    const target = path.resolve(cwd, folders.config, `${name}.yaml`)
    const file = path.relative(cwd, target).split(path.sep).join('/')
    const source = await resolveInPackage(packageDir, path.join('config', `${name}.yaml`))
    if (!source || source.outside) return { file, status: 'none' }
    await fs.mkdir(path.dirname(target), { recursive: true })
    try {
        await fs.copyFile(source.real, target, fs.constants.COPYFILE_EXCL)
        return { file, status: 'copied' }
    } catch (err) {
        if (err.code === 'EEXIST') return { file, status: 'kept' }
        throw err
    }
}

// The package's template publishing script — the `bin` entry whose file is
// `publish-template.js` — as a real path inside the package, or null.
async function templateScript(packageDir, pkg) {
    let manifest
    try {
        manifest = JSON.parse(await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'))
    } catch {
        return null
    }
    const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {})
    const bin = bins.find((entry) => typeof entry === 'string' && path.basename(entry) === TEMPLATE_SCRIPT)
    if (!bin) return null
    const script = await resolveInPackage(packageDir, bin)
    if (!script) return null
    if (script.outside) {
        throw new Error(
            `${pkg} is installed, but its template script "${bin}" lies outside the package; ` +
                'it was not run.',
        )
    }
    return script.real
}

// An abort rejects with `signal.reason` unchanged; any other failure gets
// `prefix` in front of its message, so it names the package.
function failure(err, prefix, signal) {
    if (signal?.aborted) return err
    return new Error(`${prefix}: ${err?.message ?? err}`, { cause: err })
}

const defaultRunNode = (args, options) => spawnChild(process.execPath, args, options)

// Add an official plugin to the thin site in `cwd`: `npm install` it, copy
// its default `config/<name>.yaml` when the site has none, and run its
// `publish-template.js` bin (which copies its Pug templates to
// `views/vendor/plugin-<name>/`) when it ships one. The one code path for
// `nera add` and the public API, so neither can do more than the other.
//
// The spec and the folder are checked before npm runs. Every message goes
// through `log(line)` (default console.log), npm's and the bin's output to
// `stdio` (default 'inherit'); nothing else is written to stdout and nothing
// is read from stdin. `env` (default process.env) reaches both children;
// `signal` kills the running child and rejects with `signal.reason`.
// `runNpm(args, { cwd, stdio, env, signal })` and
// `runNode(args, { cwd, stdio, env, signal })` are injectable for tests.
//
// Returns `{ plugin, config: { file, status }, templates }`: the package
// name, the site-relative config file with `copied | kept | none`, and
// `published | none`.
export async function addPlugin(spec, options = {}) {
    const {
        cwd = process.cwd(),
        log = console.log,
        stdio = 'inherit',
        env = process.env,
        signal,
        runNpm = runNpmAsync,
        runNode = defaultRunNode,
    } = options

    const { name, pkg } = pluginPackage(spec)
    await assertThinSite(cwd)
    signal?.throwIfAborted()

    log(`📦 Installing ${pkg}...`)
    try {
        await runNpm(['install', pkg], { cwd, stdio, env, signal })
    } catch (err) {
        throw failure(err, `Installing ${pkg} failed`, signal)
    }

    const packageDir = path.join(cwd, 'node_modules', ...pkg.split('/'))
    const config = await copyDefaultConfig(cwd, packageDir, name)
    if (config.status === 'copied') log(`📝 Default configuration copied to ${config.file}`)
    if (config.status === 'kept') log(`📝 Kept the site's own ${config.file}`)

    let templates = 'none'
    const script = await templateScript(packageDir, pkg)
    if (script) {
        try {
            await runNode([script], { cwd, stdio, env, signal })
        } catch (err) {
            throw failure(err, `${pkg} is installed, but publishing its templates failed`, signal)
        }
        templates = 'published'
    }

    log(`✅ Added ${pkg}`)
    return { plugin: pkg, config, templates }
}
