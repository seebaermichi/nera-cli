import { runJson } from '../json-output.js'
import { createRegistry } from '../publish/targets.js'
import { readPublishConfig } from '../publish/site-config.js'

// `nera publish` (ROADMAP-ai.md L6): from a site folder to a live URL. This
// module is the command's contract: its flags, the TTY rule, the target
// lookup and the `--json` object. The work itself is the `publish`
// collaborator, so the CLI, the wizard and the MCP tools share one pipeline.

// Options that take a value, as `--opt <value>` or `--opt=<value>`.
const VALUE_OPTIONS = { '--target': 'target', '--repo': 'repo' }
const SWITCHES = { '--private': 'private', '--yes': 'yes', '--json': 'json', '--sign-out': 'signOut' }

export const REVOKE_URL = 'https://github.com/settings/apps/authorizations'

// `nera publish [--target <id>] [--repo <name>] [--private] [--yes] [--json]
// [--sign-out]`. Unlike `nera new`, an unknown flag or a stray argument is an
// error: a mistyped `--repos` must not publish to a repository nobody named.
export function parsePublishArgs(args = []) {
    const options = { private: false, yes: false, json: false, signOut: false }
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        const eq = arg.indexOf('=')
        const flag = eq === -1 ? arg : arg.slice(0, eq)
        if (Object.hasOwn(VALUE_OPTIONS, flag)) {
            const value = eq === -1 ? args[++i] : arg.slice(eq + 1)
            if (value === undefined || value === '' || (eq === -1 && value.startsWith('-'))) {
                throw new Error(`${flag} needs a value`)
            }
            options[VALUE_OPTIONS[flag]] = value
        } else if (Object.hasOwn(SWITCHES, arg)) {
            options[SWITCHES[arg]] = true
        } else {
            throw new Error(`Unknown argument for nera publish: ${arg}`)
        }
    }
    return options
}

// The `--json` object: `{ ok: true, url?, repository? }` from the pipeline
// (`{ ok: true, signedOut }` for --sign-out), `{ ok: false, error }` on failure.
export const PUBLISH_ENVELOPE = {
    success: (result) => ({ ok: true, ...result }),
    failure: (error) => ({ ok: false, error: error.message }),
}

// Lazily loaded, so the keyring binding is touched only by a sign-out.
async function defaultDeleteToken() {
    const { deleteToken } = await import('../publish/credentials.js')
    return deleteToken()
}

// The end-to-end pipeline (sign-in, repository, workflow, push, run) is still
// being built; until then publishing stops here with a clear message.
async function defaultPublish({ adapter }) {
    throw new Error(`Publishing to ${adapter.label} is not available in this version of Nera yet.`)
}

// Remove the stored GitHub token. Revoking the app's access is GitHub's, so
// the message sends the user there. Returns `{ signedOut }`, true when a token
// was removed.
async function signOut({ deleteToken, env }) {
    const signedOut = await deleteToken()
    console.log(signedOut
        ? 'Signed out: the GitHub token stored on this computer was removed.'
        : 'No GitHub token was stored on this computer.')
    console.log(`To revoke Nera Static's access to your GitHub account, go to ${REVOKE_URL}`)
    if (env.NERA_GITHUB_TOKEN) {
        console.log('NERA_GITHUB_TOKEN is still set in your environment; unset it to stop using that token.')
    }
    return { signedOut }
}

// Run `nera publish` and return the exit code. Every collaborator is
// injectable so tests need no network, keychain or terminal:
// - `targets`: the adapter registry (targets.js)
// - `deleteToken`: removes the stored token (credentials.js)
// - `publish(ctx)`: the pipeline; resolves `{ url?, repository? }`. `ctx` is
//   `{ cwd, adapter, options, config, interactive }`; `interactive` is false
//   without a terminal, with --yes and with --json, and nothing may be asked
//   then.
// Text mode rethrows a failure, which the bin prints as ❌ with exit 1;
// `--json` prints one object instead (PUBLISH_ENVELOPE).
export async function runPublish(args = [], {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    env = process.env,
    targets = createRegistry(),
    deleteToken = defaultDeleteToken,
    publish = defaultPublish,
} = {}) {
    const body = async () => {
        const options = parsePublishArgs(args)
        if (options.signOut) return signOut({ deleteToken, env })

        const config = await readPublishConfig(cwd)
        const adapter = targets.resolve(options.target ?? config.target)
        const { shouldPrompt } = await import('../prompt.js')
        // In --json mode stdout belongs to the one object, so no question
        // could be shown there either.
        const interactive = shouldPrompt({ yes: options.yes || options.json, stdin, stdout })
        return publish({ cwd, adapter, options, config, interactive })
    }

    if (args.includes('--json')) return runJson(body, PUBLISH_ENVELOPE)
    const result = await body()
    if (result?.url) console.log(`Live at ${result.url}`)
    return 0
}
