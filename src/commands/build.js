import run from '@nera-static/core'
import { runCheck } from './check.js'

// Render the current site (pages/ → public/) using the shared engine. `run`
// reads config and folders relative to the current working directory, so this
// builds whichever site the CLI is invoked in. With `--check`, the fresh output
// is then checked as by `nera check` — one command for CI. Returns the exit
// code: the check's, or 0 for a plain build.
export async function runBuild(args = []) {
    await run()
    return args.includes('--check') ? runCheck() : 0
}
