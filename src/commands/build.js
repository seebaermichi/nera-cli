import run from '@nera-static/core'
import { validateOutput } from '@nera-static/validate'
import { runCheck } from './check.js'
import { runJson } from '../json-output.js'

// Render the current site (pages/ → public/) using the shared engine. `run`
// reads config and folders relative to the current working directory, so this
// builds whichever site the CLI is invoked in. With `--check`, the fresh output
// is then checked as by `nera check` — one command for CI. Returns the exit
// code: the check's, or 0 for a plain build. With `--json`, the build log goes
// to stderr and stdout holds one object: the check's `{ ok, results }`, empty
// results without `--check`, or the failure (see json-output.js).
export async function runBuild(args = []) {
    const check = args.includes('--check')
    if (args.includes('--json')) {
        return runJson(async () => {
            await run()
            return check ? validateOutput({ cwd: process.cwd() }) : []
        })
    }
    await run()
    return check ? runCheck() : 0
}
