import run from '@nera-static/core'

// Render the current site (pages/ → public/) using the shared engine. `run`
// reads config and folders relative to the current working directory, so this
// builds whichever site the CLI is invoked in.
export async function runBuild() {
    await run()
}
