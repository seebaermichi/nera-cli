// The public API of @nera-static/nera, for programs that drive Nera without
// spawning the `nera` bin, such as @nera-static/mcp. It covers the catalogs,
// site creation and the two validator passes; build, dev, serve and publish
// stay `nera` child processes, because the engine and every plugin read
// process.cwd() and log to stdout. The one piece of publish in the API is the
// text of its deploy workflow (and the base_path rule that goes with it), so
// another tool can commit the same `.github/workflows/deploy.yml`.
//
// Nothing here writes to stdout or reads stdin, so a caller whose stdout is a
// protocol channel (an MCP server over stdio) can import it as is. Heavy
// dependencies (vite, chokidar) are not loaded by this module.
import { validateSite, validateOutput } from '@nera-static/validate'
import { createSite as createSiteWithOptions } from './scaffold.js'
import { addPlugin as addPluginWithOptions } from './plugin.js'
import { STDIO_OFF_STDOUT } from './npm.js'
import { createRegistry } from './publish/targets.js'
import { renderWorkflow } from './publish/workflow.js'

export { listCatalog, CatalogError } from './catalog.js'
export { listStarters } from './starter.js'
export { BUNDLED_STARTERS } from './starters.js'
export { hasErrors } from '@nera-static/validate'
/**
 * basePathOf(htmlUrl): the `base_path` (config/app.yaml) a site served at
 * `htmlUrl` needs, as `nera publish` sets it for GitHub Pages — the URL's
 * path without its trailing slash (`https://octo.github.io/site/` →
 * `/site`), or '' when the site is served from the root (`user.github.io`,
 * a custom domain).
 */
export { basePathOf } from './publish/pages.js'

const logToStderr = (line) => process.stderr.write(`${line}\n`)

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
        stdio: options.stdio ?? STDIO_OFF_STDOUT,
        log: options.log ?? logToStderr,
    })
}

/**
 * Add an official plugin to a site, the same way `nera add` does: install
 * `@nera-static/plugin-<name>`, copy its default `config/<name>.yaml` when
 * the site has none (an existing file is never touched), and run its
 * `publish-template.js` bin when it ships one.
 *
 * The spec and the folder are checked before npm runs: only an official
 * plugin (no other scope, version, path or `plugin-utils`) and only a site
 * that depends on @nera-static/nera.
 *
 * @param {string} spec `<name>`, `plugin-<name>` or `@nera-static/plugin-<name>`
 * @param {{ cwd?: string, log?: (line: string) => void,
 *     env?: NodeJS.ProcessEnv, signal?: AbortSignal }} [options]
 *     `cwd` (default process.cwd()) is the site's folder; `log` receives every
 *     progress line (default: stderr); npm's and the template bin's output go
 *     to stderr with stdin closed; `env` (default process.env) is the
 *     environment of both children; `signal` kills the running child and
 *     rejects with `signal.reason`
 * @returns {Promise<{ plugin: string, config: { file: string,
 *     status: 'copied'|'kept'|'none' }, templates: 'published'|'none' }>}
 *     the package name, the site-relative config file and what happened to
 *     it, and whether templates were published
 */
export function addPlugin(spec, options = {}) {
    return addPluginWithOptions(spec, {
        ...options,
        stdio: options.stdio ?? STDIO_OFF_STDOUT,
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

/**
 * The deploy workflow `nera publish` writes into a site as
 * `.github/workflows/deploy.yml`, as text: the very file, generated first
 * line included, so a site whose workflow came from here is left unchanged
 * by a later `nera publish` to the same target.
 *
 * @param {{ target?: string }} [options] `target` is a `nera publish
 *     --target` id: `github-pages` (the default) or `netlify`. Any other id
 *     rejects with a message naming the available ones.
 * @returns {Promise<string>} the workflow file's content
 */
export async function renderDeployWorkflow({ target } = {}) {
    return renderWorkflow(createRegistry().resolve(target))
}
