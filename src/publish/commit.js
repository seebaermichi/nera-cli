import { execFile } from 'child_process'
import { createHash } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { promisify } from 'util'
import { GitHubError, GITHUB_WEB, redact } from './github.js'
import { parseRepository } from './site-config.js'

// Committing the site and pushing it to its GitHub repository (ROADMAP-ai.md
// L6 step 5, D4): with git when it is installed, else through GitHub's Git
// Data API, so git is not a prerequisite. Both paths publish the branch
// PUBLISH_BRANCH and refuse to overwrite commits made somewhere else since
// the last publish. With git, the token reaches `git push` through
// GIT_CONFIG_* environment variables only: never argv, `.git/config` or a
// remote URL.

export const PUBLISH_BRANCH = 'main'
export const DEFAULT_MESSAGE = 'Publish the site with nera publish'

// The remote head after the last publish from this folder, per repository:
// `{ repository, sha }`. A cache, git-ignored by the scaffold.
export const PUBLISH_STATE = path.join('.nera-cache', 'publish.json')

// The text of `.nera-publish`, the file that starts an empty repository on
// the API path; the first publish's tree replaces it.
export const BOOTSTRAP_TEXT = 'Started by nera publish; the first publish replaces this file.\n'

// Top-level paths never published, whatever the site's .gitignore says:
// dependencies, the build output (CI builds it), caches and the env file
// that may hold secrets.
export const ALWAYS_EXCLUDED = ['.env', '.nera-cache', 'node_modules', 'public']

const execFileAsync = promisify(execFile)
const GIT_MAX_BUFFER = 64 * 1024 * 1024

// A refusal to overwrite the remote; `code` lets a caller tell it apart.
function remoteMoved(repository, hint) {
    const err = new Error(`The repository ${repository} on GitHub has commits this folder does not have. ${hint}`)
    err.code = 'remote-moved'
    return err
}

const GIT_MOVED_HINT = `It changed somewhere else since the last publish. Bring them in first (git pull origin ${PUBLISH_BRANCH}), then run nera publish again.`
const GIT_UNRELATED_HINT = `Nothing was published from this folder to it before; bring its commits in first (git pull origin ${PUBLISH_BRANCH} --allow-unrelated-histories), then run nera publish again.`
const API_MOVED_HINT = 'It changed somewhere else since the last publish. Copy those changes into this folder (or install git and pull them), then run nera publish again.'

// The environment that lets git authenticate to github.com with `token`: an
// Authorization header scoped to GITHUB_WEB, and no credential prompt.
export function gitAuthEnv(token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
    return {
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `http.${GITHUB_WEB}/.extraheader`,
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    }
}

// True when a `git` executable runs.
export async function hasGit({ exec = execFileAsync } = {}) {
    try {
        await exec('git', ['--version'])
        return true
    } catch {
        return false
    }
}

// The git object id of a blob with `content`, as git and GitHub compute it.
export function blobSha(content) {
    return createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
}

// The sha last recorded for `repository`, or null.
async function readState(cwd, repository) {
    try {
        const state = JSON.parse(await fs.readFile(path.join(cwd, PUBLISH_STATE), 'utf-8'))
        return state?.repository === repository && typeof state.sha === 'string' ? state.sha : null
    } catch (err) {
        if (err.code === 'ENOENT' || err instanceof SyntaxError) return null
        throw err
    }
}

async function writeState(cwd, repository, sha) {
    const file = path.join(cwd, PUBLISH_STATE)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, `${JSON.stringify({ repository, sha }, null, 4)}\n`)
}

// The sha PUBLISH_BRANCH points to on GitHub, or null when the branch (or
// any commit) does not exist yet.
async function readRemoteHead(client, { owner, name }) {
    try {
        const ref = await client.get(`/repos/${owner}/${name}/git/ref/heads/${PUBLISH_BRANCH}`)
        return ref?.object?.sha ?? null
    } catch (err) {
        // 409: "Git Repository is empty".
        if (err instanceof GitHubError && (err.status === 404 || err.status === 409)) return null
        throw err
    }
}

// The site's files the way git would add them, as sorted `/`-separated
// paths relative to `cwd`: every .gitignore on the way is honoured (the
// deepest one that matches decides, negations included, and an ignored
// directory is never entered), `.git` folders and ALWAYS_EXCLUDED are
// skipped. Symbolic links are listed, not followed.
export async function listPublishFiles(cwd = process.cwd()) {
    const { default: ignore } = await import('ignore')
    const files = []

    async function walk(dir, rel, matchers) {
        const gitignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf-8').catch((err) => {
            if (err.code === 'ENOENT') return null
            throw err
        })
        if (gitignore !== null) matchers = [...matchers, { base: rel, rules: ignore().add(gitignore) }]

        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
            if (entry.name === '.git' || (rel === '' && ALWAYS_EXCLUDED.includes(entry.name))) continue
            const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`
            const isDirectory = entry.isDirectory()
            if (isIgnored(matchers, relPath, isDirectory)) continue
            if (isDirectory) await walk(path.join(dir, entry.name), relPath, matchers)
            else if (entry.isFile() || entry.isSymbolicLink()) files.push(relPath)
        }
    }

    await walk(cwd, '', [])
    return files.sort()
}

// Whether `relPath` is ignored by the stack of .gitignore `matchers`, each
// matching paths relative to its own folder; a later (deeper) file overrides
// an earlier one, as in git.
function isIgnored(matchers, relPath, isDirectory) {
    let ignored = false
    for (const { base, rules } of matchers) {
        const sub = base === '' ? relPath : relPath.slice(base.length + 1)
        const result = rules.test(isDirectory ? `${sub}/` : sub)
        if (result.ignored) ignored = true
        else if (result.unignored) ignored = false
    }
    return ignored
}

// `url` with any user:password@ part removed, for messages.
const withoutCredentials = (url) => url.replace(/\/\/[^@/]+@/, '//')

// Whether the git remote `url` (https, ssh or scp-like form) is the GitHub
// repository `owner/name`.
function isSameRepository(url, { owner, name }) {
    const match = url.match(/^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
    return Boolean(match) && match[1].toLowerCase() === owner.toLowerCase() && match[2].toLowerCase() === name.toLowerCase()
}

const noreplyEmail = ({ login, id }) => (id === undefined ? `${login}@users.noreply.github.com` : `${id}+${login}@users.noreply.github.com`)

// The git path. Resolves `{ changed, sha }`.
async function pushWithGit({ cwd, repo, repository, head, recorded, user, message, token, exec, env, remoteUrl, log }) {
    // English messages, so a rejected push is recognised in any locale.
    const baseEnv = { ...env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    const git = async (args, extraEnv = {}) => {
        const { stdout } = await exec('git', args, { cwd, env: { ...baseEnv, ...extraEnv }, maxBuffer: GIT_MAX_BUFFER })
        return stdout.trim()
    }
    const succeeds = (args) => git(args).then(() => true, () => false)
    const optional = (args) => git(args).catch(() => null)

    const top = await optional(['rev-parse', '--show-toplevel'])
    if (top === null) {
        await git(['init', '-q', '-b', PUBLISH_BRANCH])
        log('Created a git repository in this folder.')
    } else if (await fs.realpath(top) !== await fs.realpath(cwd)) {
        throw new Error(`This site is inside another git repository (${top}). Publish it from a folder that is its own repository: move the site out of ${top}, then run nera publish again.`)
    }

    // A user's existing origin is never rewritten.
    const origin = await optional(['remote', 'get-url', 'origin'])
    if (origin === null) {
        await git(['remote', 'add', 'origin', remoteUrl])
    } else if (origin !== remoteUrl && !isSameRepository(origin, repo)) {
        throw new Error(`This folder's git remote "origin" points to ${withoutCredentials(origin)}, not ${repository}. nera publish does not change your remotes: point origin at ${remoteUrl} yourself (git remote set-url origin ${remoteUrl}), then run nera publish again.`)
    }

    const branch = await optional(['symbolic-ref', '--short', '-q', 'HEAD'])
    if (branch !== PUBLISH_BRANCH) {
        const rename = branch ? ` (or rename this one: git branch -m ${branch} ${PUBLISH_BRANCH})` : ''
        throw new Error(`nera publish publishes the branch ${PUBLISH_BRANCH}, but this folder is ${branch ? `on "${branch}"` : 'not on a branch'}. Switch to ${PUBLISH_BRANCH}${rename}, then run nera publish again.`)
    }

    // An exclude pathspec makes `git add` fail on a path .gitignore already
    // ignores, so ALWAYS_EXCLUDED is taken out of the index afterwards: the
    // tree then matches the API path's, also for a path tracked earlier.
    await git(['add', '-A', '--', '.'])
    await git(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '--', ...ALWAYS_EXCLUDED])
    if (!(await succeeds(['diff', '--cached', '--quiet']))) {
        const name = await optional(['config', 'user.name'])
        const email = await optional(['config', 'user.email'])
        const identity = name && email ? [] : ['-c', `user.name=${name || user.login}`, '-c', `user.email=${email || noreplyEmail(user)}`]
        await git([...identity, 'commit', '-q', '-m', message])
        log('Committed the site.')
    }

    const local = await optional(['rev-parse', '--verify', '-q', 'HEAD'])
    if (local === null) throw new Error('There is nothing to publish: the site folder has no files git would add.')
    if (local === head) return { changed: false, sha: head }

    // Replacing the remote is allowed only while it is exactly what this
    // folder last saw: the repository's auto-init commit on the first
    // publish (D5), or the last publish when local history was rewritten.
    let lease = null
    if (head !== null && !(await succeeds(['merge-base', '--is-ancestor', head, local]))) {
        if (head !== recorded) throw remoteMoved(repository, recorded === null ? GIT_UNRELATED_HINT : GIT_MOVED_HINT)
        lease = head
    }

    const auth = gitAuthEnv(token)
    const leaseArgs = lease ? [`--force-with-lease=refs/heads/${PUBLISH_BRANCH}:${lease}`] : []
    try {
        await git(['push', '-q', ...leaseArgs, remoteUrl, `HEAD:refs/heads/${PUBLISH_BRANCH}`], auth)
    } catch (err) {
        const stderr = String(err.stderr ?? err.message)
        if (/\[rejected\]|non-fast-forward|stale info|fetch first/.test(stderr)) throw remoteMoved(repository, GIT_MOVED_HINT)
        throw new Error(redact(`git push failed: ${stderr.trim()}`, [token, auth.GIT_CONFIG_VALUE_0]))
    }
    // Keep `git status` honest about origin.
    await git(['update-ref', `refs/remotes/origin/${PUBLISH_BRANCH}`, local])
    return { changed: true, sha: local }
}

// The remote tree of commit `sha` as `{ tree, blobs }`: its tree sha and the
// set of blob shas it holds (empty when GitHub truncates the listing, so
// every blob is uploaded).
async function readRemoteTree(client, base, sha) {
    const commit = await client.get(`${base}/commits/${sha}`)
    const tree = await client.get(`${base}/trees/${commit.tree.sha}?recursive=1`)
    const blobs = tree.truncated ? [] : tree.tree.filter((entry) => entry.type === 'blob').map((entry) => entry.sha)
    return { tree: commit.tree.sha, blobs: new Set(blobs) }
}

// The git path's equivalent without git: blobs, a full tree of the files
// listPublishFiles admits, a commit on the remote head and a fast-forward
// ref update. Resolves `{ changed, sha }`.
async function pushWithApi({ client, cwd, repo, repository, head, recorded, message, log }) {
    const base = `/repos/${repo.owner}/${repo.name}/git`

    if (head === null) {
        // GitHub's Git Data API cannot write into an empty repository; one
        // file through the contents API starts it, and the full tree below
        // replaces it. The file is not empty, so starting does not depend on
        // GitHub accepting empty content.
        const started = await client.put(`/repos/${repo.owner}/${repo.name}/contents/.nera-publish`, {
            message: 'Start the repository',
            content: Buffer.from(BOOTSTRAP_TEXT).toString('base64'),
        })
        head = started.commit.sha
        recorded = head
        // Recorded now, so a retry after a later failure may still publish.
        await writeState(cwd, repository, head)
    } else if (recorded === null) {
        throw new Error(`The repository ${repository} already has commits, and this folder has no record of publishing them (${PUBLISH_STATE}), so publishing would replace them. Install git so nera publish can compare the history, or publish to a new repository with --repo <name>.`)
    } else if (head !== recorded) {
        throw remoteMoved(repository, API_MOVED_HINT)
    }

    const files = await listPublishFiles(cwd)
    if (files.length === 0) throw new Error('There is nothing to publish: the site folder has no files to add.')

    const remote = await readRemoteTree(client, base, head)
    const entries = []
    for (const file of files) {
        const full = path.join(cwd, file)
        const stat = await fs.lstat(full)
        const symlink = stat.isSymbolicLink()
        const content = symlink ? Buffer.from(await fs.readlink(full)) : await fs.readFile(full)
        let sha = blobSha(content)
        if (!remote.blobs.has(sha)) {
            sha = (await client.post(`${base}/blobs`, { content: content.toString('base64'), encoding: 'base64' })).sha
            remote.blobs.add(sha)
        }
        const mode = symlink ? '120000' : (stat.mode & 0o100 ? '100755' : '100644')
        entries.push({ path: file, mode, type: 'blob', sha })
    }

    const tree = await client.post(`${base}/trees`, { tree: entries })
    if (tree.sha === remote.tree) return { changed: false, sha: head }

    const commit = await client.post(`${base}/commits`, { message, tree: tree.sha, parents: [head] })
    try {
        await client.patch(`${base}/refs/heads/${PUBLISH_BRANCH}`, { sha: commit.sha, force: false })
    } catch (err) {
        if (err instanceof GitHubError && err.status === 422) throw remoteMoved(repository, API_MOVED_HINT)
        throw err
    }
    log(`Committed the site through the GitHub API (${files.length} files).`)
    return { changed: true, sha: commit.sha }
}

// Commit the site at `cwd` and push it to `repository` (`owner/name`) on the
// branch PUBLISH_BRANCH: with git when it is installed (or `useGit` says
// so), else through the GitHub API. "Nothing changed" is not an error.
// Resolves `{ method: 'git' | 'api', changed, sha }`, `sha` being the
// remote head afterwards, which is recorded in PUBLISH_STATE. Throws an
// error with code `remote-moved` when GitHub has commits made elsewhere.
// - `client`: a github.js client acting with `token`
// - `user`: the signed-in account, `{ login, id }`, the commit identity when
//   git has none
// - `created`: true when ensureRepository just created the repository; its
//   auto-init commit is then recorded as the one the first push may replace
// - `exec`, `env`, `remoteUrl`: the git runner, its base environment and
//   the push URL, for tests
export async function commitAndPush({
    client,
    token,
    repository,
    user,
    created = false,
    cwd = process.cwd(),
    message = DEFAULT_MESSAGE,
    useGit,
    exec = execFileAsync,
    env = process.env,
    remoteUrl,
    log = (line) => console.log(line),
} = {}) {
    const repo = parseRepository(repository)
    const head = await readRemoteHead(client, repo)
    if (created && head !== null) await writeState(cwd, repository, head)
    const recorded = await readState(cwd, repository)

    const method = (useGit ?? await hasGit({ exec })) ? 'git' : 'api'
    const options = { client, cwd, repo, repository, head, recorded, user, message, token, exec, env, log }
    const result = method === 'git'
        ? await pushWithGit({ ...options, remoteUrl: remoteUrl ?? `${GITHUB_WEB}/${repository}.git` })
        : await pushWithApi(options)

    await writeState(cwd, repository, result.sha)
    log(result.changed ? `Pushed the site to ${GITHUB_WEB}/${repository}` : 'Nothing changed since the last publish.')
    return { method, ...result }
}
