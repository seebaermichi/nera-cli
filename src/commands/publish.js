import { runJson } from '../json-output.js'
import { createRegistry } from '../publish/targets.js'
import { readPublishConfig } from '../publish/site-config.js'
import { normalizeDomain } from '../publish/domain.js'

// `nera publish`: from a site folder to a live URL. This module is the
// command's contract: its flags, the TTY rule, the target lookup and the
// `--json` object. The work itself is the `publish` collaborator, so the CLI,
// the wizard and the MCP tools share one pipeline.

// Options that take a value, as `--opt <value>` or `--opt=<value>`.
const VALUE_OPTIONS = { '--target': 'target', '--repo': 'repo', '--domain': 'domain' }
const SWITCHES = { '--private': 'private', '--yes': 'yes', '--json': 'json', '--sign-out': 'signOut' }

export const REVOKE_URL = 'https://github.com/settings/apps/authorizations'
export const NETLIFY_REVOKE_URL = 'https://app.netlify.com/user/applications'

// `nera publish [--target <id>] [--repo <name>] [--domain <host>] [--private]
// [--yes] [--json] [--sign-out]`. Unlike `nera new`, an unknown flag or a
// stray argument is an error: a mistyped `--repos` must not publish to a
// repository nobody named. `--domain` is normalized here (domain.js), so a
// bad value fails before any sign-in or network call.
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
    if (options.domain !== undefined) options.domain = normalizeDomain(options.domain)
    return options
}

// The `--json` object: `{ ok: true, url, repository, sha, run, movedFrom? }` from the
// pipeline (`{ ok: true, signedOut, removed }` for --sign-out), `{ ok: false, error }`
// on failure, plus the `repository` and `sha` the pipeline had reached
// (publishSite's `published`), and `deploy: { run, job?, step?, excerpt?,
// hint }` when the Actions run failed or did not finish (status.js).
export const PUBLISH_ENVELOPE = {
    success: (result) => ({ ok: true, ...result }),
    failure: (error) => ({
        ok: false,
        error: error.message,
        ...error.published,
        ...(error.details ? { deploy: error.details } : {}),
    }),
}

// Lazily loaded, so the keyring binding is touched only by a sign-out.
async function defaultDeleteToken(options) {
    const { deleteToken } = await import('../publish/credentials.js')
    return deleteToken(options)
}

// The end-to-end pipeline, in this order: sign in → the app's
// installation → the repository → `adapter.setUp` → the deploy workflow →
// commit and push → the Actions run for the pushed commit. The host is set
// up before the first push, so the workflow's push trigger finds it ready.
// `target` is written to config/publish.yaml only once `setUp` succeeded, so
// a move whose set-up fails is still a move on the next run. Its modules are
// imported here, so the keyring and git are never loaded by another command.
// Resolves `{ url, repository, sha, run }`, plus `movedFrom` (the old
// target's id) on a move, after logging what the old host still serves
// (`previous.leftBehind`, targets.js).
// - `ctx`: what runPublish hands every pipeline (see there)
// - `deps`: the collaborators the modules take, for tests: `fetch`,
//   `readToken`/`saveToken` (credentials.js, the GitHub account),
//   `readNetlifyToken`/`saveNetlifyToken` (the Netlify account), `sleep`/
//   `now`, `open`, `useGit`/`exec` (commit.js), `resolver` (the DNS check of
//   dns.js), `log` and `emit` (the action_required / action_done events of
//   the browser steps: auth.js, repository.js, netlify-auth.js; a no-op by
//   default)
// Every adapter method gets the same host context: `{ cwd, client,
// repository, installation, user, options, config, interactive, log, emit,
// resolver, fetch, sleep, now, open, readNetlifyToken, saveNetlifyToken }`,
// where `client` is the GitHub client, `config` config/publish.yaml as read
// before the run and `repository` what ensureRepository resolved (its
// `created` is true on the first run). A failure is rethrown with
// `published: { repository?, sha? }`, what the pipeline had reached.
export async function publishSite({ cwd, adapter, previous, options, config, interactive, env }, deps = {}) {
    const [auth, credentials, github, repository, workflow, commit, status, siteConfig] = await Promise.all([
        import('../publish/auth.js'),
        import('../publish/credentials.js'),
        import('../publish/github.js'),
        import('../publish/repository.js'),
        import('../publish/workflow.js'),
        import('../publish/commit.js'),
        import('../publish/status.js'),
        import('../publish/site-config.js'),
    ])
    const {
        fetch = globalThis.fetch,
        readToken = () => credentials.readToken({ env }),
        saveToken,
        sleep,
        now,
        open,
        useGit,
        exec,
        resolver,
        readNetlifyToken = () => credentials.readToken({ account: 'netlify', env }),
        saveNetlifyToken,
        log = (line) => console.log(line),
        emit = () => {},
    } = deps
    const clock = { sleep, now, log }

    // What the pipeline has reached, for the `--json` object of a failure:
    // the repository once it is known, the pushed commit once it is pushed.
    const published = {}
    try {
        const tokens = await auth.ensureToken({ readToken, saveToken, fetch, open, tty: interactive, emit, ...clock })
        const client = github.createGitHubClient({ token: tokens.accessToken, fetch })
        const user = await client.get('/user')
        const installation = await repository.ensureInstallation({
            client,
            login: user.login,
            open,
            tty: interactive,
            emit,
            ...clock,
        })
        const repo = await repository.ensureRepository({ client, cwd, options, config, log })
        published.repository = repo.repository

        const host = {
            cwd,
            client,
            repository: repo,
            installation,
            user,
            options,
            config,
            interactive,
            log,
            emit,
            resolver,
            fetch,
            sleep,
            now,
            open,
            readNetlifyToken,
            saveNetlifyToken,
        }
        await adapter.setUp(host)
        if (config.target !== adapter.id) await siteConfig.writePublishConfig({ target: adapter.id }, cwd)
        log((await workflow.writeWorkflow(adapter, host, cwd)).message)

        const pushed = await commit.commitAndPush({
            client,
            token: tokens.accessToken,
            repository: repo.repository,
            user,
            created: repo.created,
            cwd,
            useGit,
            exec,
            env,
            log,
        })
        published.sha = pushed.sha
        const run = await status.watchDeploy({
            client,
            repository: repo.repository,
            sha: pushed.sha,
            adapter,
            ...clock,
        })
        const result = {
            url: await adapter.liveUrl(host),
            repository: repo.repository,
            sha: pushed.sha,
            run: run.html_url,
        }
        if (previous) {
            log(`Moved from ${previous.label} to ${adapter.label}. The site on ${previous.label} was left untouched.`)
            for (const line of (await previous.leftBehind?.(host)) ?? []) log(`  ${line}`)
            result.movedFrom = previous.id
        }
        return result
    } catch (error) {
        if (error instanceof Error) error.published = published
        throw error
    }
}

// Remove the stored GitHub and Netlify tokens. Revoking the apps' access is
// the hosts' business, so the messages send the user there. Returns
// `{ signedOut, removed }`: signedOut is true when a token was removed,
// `removed` names the accounts whose token was.
async function signOut({ deleteToken, env }) {
    const github = await deleteToken({ account: 'github' })
    const netlify = await deleteToken({ account: 'netlify' })
    console.log(github
        ? 'Signed out: the GitHub token stored on this computer was removed.'
        : 'No GitHub token was stored on this computer.')
    console.log(`To revoke Nera Static's access to your GitHub account, go to ${REVOKE_URL}`)
    if (env.NERA_GITHUB_TOKEN) {
        console.log('NERA_GITHUB_TOKEN is still set in your environment; unset it to stop using that token.')
    }
    if (netlify) {
        console.log('Signed out of Netlify: the Netlify token stored on this computer was removed.')
        console.log(`To revoke Nera CLI's access to your Netlify account, go to ${NETLIFY_REVOKE_URL}`)
    } else {
        console.log('No Netlify token was stored on this computer.')
    }
    if (env.NERA_NETLIFY_TOKEN) {
        console.log('NERA_NETLIFY_TOKEN is still set in your environment; unset it to stop using that token.')
    }
    const removed = [github && 'github', netlify && 'netlify'].filter(Boolean)
    return { signedOut: removed.length > 0, removed }
}

// One event of `nera publish --json`, as one JSON line on stderr. Written to
// process.stderr directly, so runJson's rerouting of stdout cannot reach it
// and it lands between the log lines in the order it was emitted.
function writeEvent(event) {
    process.stderr.write(`${JSON.stringify(event)}\n`)
}

// Run `nera publish` and return the exit code. Every collaborator is
// injectable so tests need no network, keychain or terminal:
// - `targets`: the adapter registry (targets.js)
// - `deleteToken({ account })`: removes an account's stored token (credentials.js)
// - `pickTarget({ input, output, targets })`: the target question
//   (prompt.js runTargetPicker); resolves the picked id
// - `publish(ctx, wired)`: the pipeline (publishSite); resolves `{ url?, … }`.
//   `ctx` is `{ cwd, adapter, previous, options, config, interactive, env }`;
//   `interactive` is false without a terminal, with --yes and with --json,
//   and nothing may be asked then. `previous` is the registered adapter
//   config/publish.yaml names when it is not `adapter`: the site moves.
//   `wired` is `{ emit }`, the part of publishSite's `deps` this command
//   chooses: with --json, `emit` writes each event as one JSON line on
//   stderr (an NDJSON stream between the logs; stdout keeps its one
//   object); in text mode it is a no-op, since the log lines say the same.
// The target is `--target`, else config/publish.yaml's, else — only when
// interactive and there is a choice — the target the user picks when
// asked, else the registry's default.
// Text mode rethrows a failure, which the bin prints as ❌ with exit 1;
// `--json` prints one object instead (PUBLISH_ENVELOPE).
export async function runPublish(args = [], {
    cwd = process.cwd(),
    stdin = process.stdin,
    stdout = process.stdout,
    env = process.env,
    targets = createRegistry(),
    deleteToken = defaultDeleteToken,
    pickTarget,
    publish = publishSite,
} = {}) {
    const body = async () => {
        const options = parsePublishArgs(args)
        if (options.signOut) return signOut({ deleteToken, env })

        const config = await readPublishConfig(cwd)
        const prompt = await import('../prompt.js')
        // In --json mode stdout belongs to the one object, so no question
        // could be shown there either.
        const interactive = prompt.shouldPrompt({ yes: options.yes || options.json, stdin, stdout })
        let id = options.target ?? config.target
        const ids = targets.ids()
        if (id === undefined && interactive && ids.length > 1) {
            const ask = pickTarget ?? prompt.runTargetPicker
            id = await ask({ input: stdin, output: stdout, targets: ids.map((known) => targets.resolve(known)) })
        }
        const adapter = targets.resolve(id)
        const moved = config.target !== undefined && config.target !== adapter.id && ids.includes(config.target)
        const previous = moved ? targets.resolve(config.target) : undefined
        const emit = options.json ? writeEvent : () => {}
        return publish({ cwd, adapter, previous, options, config, interactive, env }, { emit })
    }

    if (args.includes('--json')) return runJson(body, PUBLISH_ENVELOPE)
    const result = await body()
    if (result?.url) console.log(`Live at ${result.url}`)
    return 0
}
