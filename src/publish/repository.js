import path from 'path'
import { GitHubError } from './github.js'
import { openInBrowser } from './auth.js'
import { isValidRepoName, parseRepository, writePublishConfig, PUBLISH_CONFIG } from './site-config.js'

// The GitHub side of `nera publish` before the first push (ROADMAP-ai.md L6
// step 3): the "Nera Static" app must be installed on the account, and the
// site needs a repository. `client` is a github.js client acting with the
// user's token, so tests stub its fetch and use no network.

export const APP_SLUG = 'nera-static'
export const INSTALL_PAGE = `https://github.com/apps/${APP_SLUG}/installations/new`

// How often and how long to wait for the user to install the app.
export const INSTALL_POLL_MS = 5_000
export const INSTALL_TIMEOUT_MS = 15 * 60_000

// What the app may do, shown before the install page (the device-flow page
// lists no permissions; the install page does). The repository selection
// advice covers an account with no repository yet, whose "Only select
// repositories" list has nothing to pick: a repository Nera creates joins a
// "selected" installation by itself (permission test, 2026-10-20).
export const INSTALL_LINES = [
    'Nera Static is not installed on your GitHub account yet. Installed, it may:',
    '  - create repositories for your sites',
    '  - commit the site and its deploy workflow, and change repository settings (to switch on GitHub Pages)',
    '  - start and read GitHub Actions runs, and store the deploy secrets a host needs',
    'It acts only on the repositories you give it.',
    'On the install page choose "All repositories", or "Only select repositories" with any repository: the one Nera creates is added by itself. If you have no repository yet, choose "All repositories".',
]

export const PRIVATE_NOTE = 'A private repository can be published with GitHub Pages only on a paid GitHub plan (Pro, Team or Enterprise); Netlify publishes it on the free plan.'

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Nera Static's installation among those the token can see, or null. With
// `login`, only the installation on that account counts: the repository is
// created there, and an organization's installation does not reach it.
async function findInstallation(client, login) {
    const data = await client.get('/user/installations?per_page=100')
    return (data?.installations ?? []).find((installation) =>
        installation.app_slug === APP_SLUG && (login === undefined || installation.account?.login === login)) ?? null
}

// The app's installation on the account `login` (the signed-in user; any
// account when it is not given). When there is none, say what the app may
// do, print the install page (and open it when `tty` is true), then poll
// every INSTALL_POLL_MS until it appears; give up after INSTALL_TIMEOUT_MS
// with the page in the message. Resolves the installation as GitHub lists it
// (`id`, `account`, `repository_selection`, …).
export async function ensureInstallation({
    client,
    login,
    tty = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    open = openInBrowser,
    sleep = sleepFor,
    now = Date.now,
    log = (line) => console.log(line),
} = {}) {
    const existing = await findInstallation(client, login)
    if (existing) return existing

    for (const line of INSTALL_LINES) log(line)
    log(`Install it at ${INSTALL_PAGE}`)
    if (tty) open(INSTALL_PAGE)
    log('Waiting for you to install Nera Static on GitHub…')

    const deadline = now() + INSTALL_TIMEOUT_MS
    for (;;) {
        await sleep(INSTALL_POLL_MS)
        const installation = await findInstallation(client, login)
        if (installation) {
            log(`Nera Static is installed on ${installation.account?.login ?? 'your account'}.`)
            return installation
        }
        if (now() >= deadline) {
            throw new Error(`Nera Static was not installed within ${INSTALL_TIMEOUT_MS / 60_000} minutes. Install it at ${INSTALL_PAGE}, then run nera publish again.`)
        }
    }
}

// What ensureRepository resolves, from GitHub's repository object.
const summarize = (repo, created) => ({
    repository: repo.full_name,
    owner: repo.owner?.login,
    name: repo.name,
    private: Boolean(repo.private),
    defaultBranch: repo.default_branch,
    htmlUrl: repo.html_url,
    created,
})

// `name` with every run of characters GitHub refuses turned into one dash;
// the suggestion in the error for a name that is not valid ("my-site" when
// nothing valid is left, e.g. for "..").
const suggestName = (name) => {
    const suggestion = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').replace(/\.git$/i, '').slice(0, 100)
    return isValidRepoName(suggestion) ? suggestion : 'my-site'
}

// The repository name to create: `--repo`, else the name part of the
// config's repository, else the site folder's name. Throws before any GitHub
// call when it breaks GitHub's naming rules.
function nameToCreate({ cwd, options, configured }) {
    if (options.repo !== undefined) {
        if (!isValidRepoName(options.repo)) {
            throw new Error(`"${options.repo}" is not a valid GitHub repository name: use letters, digits, ".", "-" and "_" (at most 100), e.g. --repo ${suggestName(options.repo)}`)
        }
        return options.repo
    }
    if (configured) return configured.name
    const folder = path.basename(path.resolve(cwd))
    if (!isValidRepoName(folder)) {
        throw new Error(`The folder name "${folder}" is not a valid GitHub repository name. Name the repository with --repo, e.g. --repo ${suggestName(folder)}`)
    }
    return folder
}

// The error for a repository on the account that Nera Static cannot use:
// GitHub hides it from the installation (404, then 422 "already exists" on
// create) or lists it without push permission.
const unreachable = (name) => new Error(`Your repository ${name} exists, but Nera Static cannot reach it. Add it to the app's installation at https://github.com/settings/installations, or choose another name with --repo <name>.`)

// The configured repository as GitHub has it, or null when GitHub answers
// 404 (deleted, renamed away or no longer reachable by the app).
async function fetchRepository(client, { owner, name }) {
    try {
        return await client.get(`/repos/${owner}/${name}`)
    } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null
        throw err
    }
}

// The site's GitHub repository. The one in config/publish.yaml is reused
// while GitHub still has it (unless `--repo` names another); otherwise a new
// one is created with `auto_init` (D5), public unless `options.private`, and
// recorded in config/publish.yaml. A reused one GitHub reports with
// `permissions.push: false` is an error, nothing is created (a missing
// `permissions` field counts as pushable). A name already taken on the
// account is an error with a --repo hint. Resolves `{ repository, owner, name, private,
// defaultBranch, htmlUrl, created }`.
// - `client`: a github.js client acting with the user's token
// - `options`: the parsed `nera publish` flags (`repo`, `private`)
// - `config`: the site's publish config (site-config.js)
export async function ensureRepository({
    client,
    cwd = process.cwd(),
    options = {},
    config = {},
    log = (line) => console.log(line),
} = {}) {
    const configured = config.repository ? parseRepository(config.repository) : null
    const reuse = configured && (options.repo === undefined || options.repo === configured.name)
    const name = nameToCreate({ cwd, options, configured: reuse ? configured : null })

    if (reuse) {
        const repo = await fetchRepository(client, configured)
        if (repo) {
            if (repo.permissions?.push === false) throw unreachable(repo.name)
            log(`Publishing to the repository ${repo.full_name}`)
            return summarize(repo, false)
        }
        log(`GitHub has no repository ${config.repository} any more (it was deleted or renamed); creating a new one.`)
    }
    // Only reached on reuse when GitHub answered 404 for the configured one.
    const configuredMissing = Boolean(reuse)

    const visibility = options.private ? 'private' : 'public'
    log(`Creating the ${visibility} repository ${name} on GitHub…`)
    if (options.private) log(PRIVATE_NOTE)
    else log('It is public: anyone can see the site\'s source. Use --private for a private repository.')

    let repo
    try {
        repo = await client.post('/user/repos', { name, private: Boolean(options.private), auto_init: true })
    } catch (err) {
        if (err instanceof GitHubError && err.status === 422 && /already exists/i.test(err.message)) {
            // GitHub answers 404 for a repository the installation does not
            // include, so the "deleted" one above may still be there.
            if (configuredMissing) throw unreachable(name)
            throw new Error(`You already have a repository named ${name} on GitHub. Choose another name with --repo <name>.`)
        }
        throw err
    }

    await writePublishConfig({ repository: repo.full_name }, cwd)
    log(`Created ${repo.html_url} and recorded it in ${PUBLISH_CONFIG}`)
    return summarize(repo, true)
}
