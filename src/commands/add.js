import { addPlugin } from '../plugin.js'
import { runJson } from '../json-output.js'
import { STDIO_OFF_STDOUT } from '../npm.js'

export const ADD_USAGE = 'Usage: nera add <plugin> [--json], e.g. `nera add sitemap`'

// The summary's config line for each config status (plugin.js).
const CONFIG_SUMMARY = {
    copied: (file) => `${file} (copied from the plugin's defaults)`,
    kept: (file) => `${file} (kept, the site already had one)`,
    none: () => 'none (the plugin ships no default)',
}

// `nera add <plugin> [--json]`: exactly one plugin, no other flag. Like
// `nera publish`, an unknown flag or a second argument is an error, so a
// mistyped flag never reaches npm as a package name.
export function parseAddArgs(args = []) {
    const options = { json: false }
    const specs = []
    for (const arg of args) {
        if (arg === '--json') options.json = true
        else if (arg.startsWith('-')) throw new Error(`Unknown argument for nera add: ${arg}. ${ADD_USAGE}`)
        else specs.push(arg)
    }
    if (specs.length === 0) throw new Error(`nera add needs a plugin. ${ADD_USAGE}`)
    if (specs.length > 1) throw new Error(`nera add takes one plugin, got ${specs.length}. ${ADD_USAGE}`)
    return { ...options, spec: specs[0] }
}

// The `--json` object (plan D5): `{ ok: true, plugin, config: { file, status },
// templates }`, or `{ ok: false, error }`.
export const ADD_ENVELOPE = {
    success: (result) => ({ ok: true, ...result }),
    failure: (error) => ({ ok: false, error: error.message }),
}

const logToStderr = (line) => process.stderr.write(`${line}\n`)

// Add an official plugin to the site in `cwd` (ROADMAP-ai.md, S8): the work is
// addPlugin's (plugin.js), shared with the public API. Returns the exit code:
// 0 once the plugin is added, 1 for a failure in --json mode (text mode throws
// and bin/nera.js prints it). `runNpm` and `runNode` reach addPlugin, for tests.
export async function runAdd(args = [], { cwd = process.cwd(), runNpm, runNode } = {}) {
    // An undefined runNpm/runNode leaves addPlugin's default in place.
    const deps = { cwd, runNpm, runNode }

    if (args.includes('--json')) {
        return runJson(() => {
            const { spec } = parseAddArgs(args)
            // npm's and the template bin's output to stderr (npm.js).
            return addPlugin(spec, { ...deps, log: logToStderr, stdio: STDIO_OFF_STDOUT })
        }, ADD_ENVELOPE)
    }

    const { spec } = parseAddArgs(args)
    const result = await addPlugin(spec, { ...deps, log: console.log, stdio: 'inherit' })
    console.log(`   Config:    ${CONFIG_SUMMARY[result.config.status](result.config.file)}`)
    console.log(`   Templates: ${result.templates === 'published' ? 'published by the plugin' : 'none'}`)
    return 0
}
