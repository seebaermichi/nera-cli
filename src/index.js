// The public API of @nera-static/nera, for programs that drive Nera without
// spawning the `nera` bin, such as @nera-static/mcp. It covers the catalogs,
// site creation and the two validator passes; build, dev, serve and publish
// stay `nera` child processes, because the engine and every plugin read
// process.cwd() and log to stdout.
//
// Nothing here writes to stdout or reads stdin, so a caller whose stdout is a
// protocol channel (an MCP server over stdio) can import it as is. Heavy
// dependencies (vite, chokidar) are not loaded by this module.
import { validateSite, validateOutput } from '@nera-static/validate'
import { createSite as createSiteWithOptions } from './scaffold.js'

export { listCatalog, CatalogError } from './catalog.js'
export { listStarters } from './starter.js'
export { BUNDLED_STARTERS } from './starters.js'
export { hasErrors } from '@nera-static/validate'

const logToStderr = (line) => process.stderr.write(`${line}\n`)

// npm install's output goes to stderr and its stdin is closed, so npm can
// neither write to stdout nor wait for an answer.
const INSTALL_STDIO = ['ignore', 2, 2]

/**
 * Create a Nera site, the same way `nera new` does, without a prompt.
 *
 * No child blocks the event loop: the starter download (`npm pack`, `tar`)
 * and `npm install` run asynchronously. With a `theme` from npm, the install
 * names the theme package, so npm replaces its `latest` placeholder with a
 * caret range.
 *
 * @param {string} projectName the new folder under `cwd`, or `.` to scaffold
 *     into `cwd` itself (which must be empty)
 * @param {{ cwd?: string, starter?: string, theme?: string, name?: string,
 *     lang?: string, install?: boolean, log?: (line: string) => void,
 *     env?: NodeJS.ProcessEnv, signal?: AbortSignal }} [options]
 *     `starter` and `theme` exclude each other; `install` (default true) runs
 *     `npm install`; `log` receives every progress line (default: stderr);
 *     `env` (default process.env) is the environment of every child
 *     (`npm --version`, `npm pack`, `tar`, `npm install`); `signal` kills the
 *     running child and rejects with `signal.reason` — a new folder is then
 *     removed, while for `.` nothing is removed and the error names what was
 *     written. A failed install, without an abort, keeps the folder.
 * @returns {Promise<{ dir: string, firstSteps: string|null }>} the site's
 *     folder and the `## First steps` section of the starter's README
 */
export function createSite(projectName, options = {}) {
    return createSiteWithOptions(projectName, {
        ...options,
        stdio: options.stdio ?? INSTALL_STDIO,
        log: options.log ?? logToStderr,
    })
}

/**
 * Validate a site's sources, like `nera validate`.
 *
 * @param {{ cwd?: string }} [options] the site's folder (default process.cwd())
 * @returns {Array<{ file: string, line: number|null, severity: string,
 *     rule: string, message: string }>} the validator's records
 */
export function validate({ cwd = process.cwd() } = {}) {
    return validateSite({ cwd })
}

/**
 * Check a site's built output in public/, like `nera check`. Throws when
 * there is no build yet ("run `nera build` first").
 *
 * @param {{ cwd?: string }} [options] the site's folder (default process.cwd())
 * @returns {Array<{ file: string, line: number|null, severity: string,
 *     rule: string, message: string }>} the validator's records
 */
export function check({ cwd = process.cwd() } = {}) {
    return validateOutput({ cwd })
}
