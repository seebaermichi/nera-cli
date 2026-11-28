import fs from 'node:fs'
import path from 'node:path'
import { tempDir } from '@nera-static/test-utils'

// The repo root: this package, `@nera-static/nera` itself.
export const REPO = path.resolve(import.meta.dirname, '../..')

let root

// The `root` to pass to test-utils' `nera(cwd, args, { root })` so that it
// runs this repo's `bin/nera.js`. `nera()` runs the `@nera-static/nera`
// installed for a root, and this repo has none in its own `node_modules`:
// it is that package. So the root is a temp dir whose
// `node_modules/@nera-static/nera` links back to the repo. Node runs the
// bin by its real path, so the CLI imports core and validate from this
// repo's `node_modules`. One root per test file, removed after it (the
// symlink is removed, not followed).
export function cliRoot() {
    if (root) return root
    const dir = tempDir('nera-cli-root-')
    const scope = path.join(dir, 'node_modules', '@nera-static')
    fs.mkdirSync(scope, { recursive: true })
    fs.symlinkSync(REPO, path.join(scope, 'nera'), 'dir')
    root = dir
    return root
}
