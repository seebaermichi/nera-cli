import fs from 'fs/promises'
import path from 'path'
import { parseDocument } from 'yaml'
import { GitHubError } from './github.js'
import { PRIVATE_NOTE } from './repository.js'
import { BUILD_ARTIFACT, BUILD_OUTPUT } from './workflow.js'

// The GitHub Pages target of `nera publish` (ROADMAP-ai.md L6 step 4): the
// site is built and deployed by the generated Actions workflow, so Pages runs
// with the `workflow` build type. Every call goes through the host context's
// github.js client, so tests stub its fetch and use no network.

export const BUILD_TYPE = 'workflow'
export const APP_CONFIG = path.join('config', 'app.yaml')

// What GitHub says when the account's plan has no Pages for a private
// repository. The exact wording is unverified, so a refusal counts as this
// only when the repository is private, the status is 403 or 422 and the
// message names the plan; any other error goes through unchanged.
const PLAN_REFUSAL = /\bplan\b|upgrade/i
const PLAN_STATUSES = [403, 422]

const pagesPath = (repository) => `/repos/${repository.owner}/${repository.name}/pages`

// The repository's Pages site as GitHub has it, or null when GitHub answers
// 404 (Pages is not enabled).
async function fetchPages(client, repository) {
    try {
        return await client.get(pagesPath(repository))
    } catch (err) {
        if (err instanceof GitHubError && err.status === 404) return null
        throw err
    }
}

// `err` as the error to show: GitHub's refusal to enable Pages on a private
// repository becomes PRIVATE_NOTE, anything else is returned as it is.
function explainRefusal(err, repository) {
    if (err instanceof GitHubError
        && repository.private
        && PLAN_STATUSES.includes(err.status)
        && PLAN_REFUSAL.test(err.message)) {
        return new Error(`GitHub Pages cannot be switched on for the private repository ${repository.repository}. ${PRIVATE_NOTE}`)
    }
    return err
}

// The `base_path` a site served at `htmlUrl` needs (D2): the URL's path
// without its trailing slash (`https://octo.github.io/site/` → `/site`), or ''
// when the site is served from the root (`user.github.io`, a custom domain).
export function basePathOf(htmlUrl) {
    return new URL(htmlUrl).pathname.replace(/\/+$/, '')
}

// A `base_path` value as core reads it (normalizeBasePath in
// @nera-static/core): trimmed, without trailing slashes, with one leading
// slash, '' for none; null for a value that is not text. Lets `site/` count
// as the same as `/site`.
function normalizeBasePath(value) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') return null
    const trimmed = value.trim().replace(/\/+$/, '')
    if (trimmed === '') return ''
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

// Make `base_path` in the site's config/app.yaml say `basePath` (D2): set it
// when there is one, remove the key when it is ''. The file is left untouched
// when it already means the same; otherwise comments and the other keys are
// kept. Resolves true when the file changed. Throws, naming the file, when it
// is missing, not valid YAML or not a mapping.
export async function writeBasePath(cwd, basePath) {
    const file = path.join(cwd, APP_CONFIG)
    let text
    try {
        text = await fs.readFile(file, 'utf-8')
    } catch (err) {
        if (err.code === 'ENOENT') throw new Error(`${APP_CONFIG} is missing; nera publish needs the site's config to set base_path.`)
        throw err
    }
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
        throw new Error(`${APP_CONFIG} is not valid YAML: ${doc.errors[0].message}`)
    }
    const value = doc.toJS()
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${APP_CONFIG} must be a mapping of keys to values`)
    }
    if (basePath === '') {
        // A root-served site has no base_path; a blank or `/` one is removed too.
        if (!doc.has('base_path')) return false
        doc.delete('base_path')
    } else {
        if (normalizeBasePath(value.base_path) === basePath) return false
        doc.set('base_path', basePath)
    }
    // Keep the rest of the user's file as written: its nesting indent, long
    // lines unfolded, flow collections unpadded.
    const indent = /^( +)[^\s#-]/m.exec(text)?.[1].length ?? 2
    await fs.writeFile(file, doc.toString({ indent, lineWidth: 0, flowCollectionPadding: false }))
    return true
}

// Point `base_path` at where Pages serves `site`, with a log line when it
// changes.
async function followPagesAddress(site, { cwd, log }) {
    if (!site?.html_url) throw new Error('GitHub reported no address for the GitHub Pages site, so base_path cannot be set.')
    const basePath = basePathOf(site.html_url)
    if (!(await writeBasePath(cwd, basePath))) return
    log(basePath === ''
        ? `Removed base_path from ${APP_CONFIG}: ${site.html_url} serves the site from the root.`
        : `Set base_path to ${basePath} in ${APP_CONFIG}: ${site.html_url} serves the site below ${basePath}.`)
}

// Enable Pages with the workflow build type, or reuse the site GitHub already
// has; one with the `legacy` (branch) build type is switched to `workflow`
// (D4), since the generated workflow is the only deploy path. Then
// `base_path` in config/app.yaml follows the site's address (D2), before the
// first push commits it. Resolves the Pages site as GitHub describes it
// (`html_url`, `build_type`, `cname`, …).
async function setUp({ client, repository, cwd = process.cwd(), log = (line) => console.log(line) }) {
    const site = await enablePages({ client, repository, log })
    await followPagesAddress(site, { cwd, log })
    return site
}

// The enabling half of setUp: resolves the Pages site, now on `workflow`.
async function enablePages({ client, repository, log }) {
    const existing = await fetchPages(client, repository)
    if (!existing) {
        log(`Switching on GitHub Pages for ${repository.repository}…`)
        try {
            return await client.post(pagesPath(repository), { build_type: BUILD_TYPE })
        } catch (err) {
            throw explainRefusal(err, repository)
        }
    }
    if (existing.build_type !== BUILD_TYPE) {
        log(`GitHub Pages of ${repository.repository} deployed from a branch; switching it to GitHub Actions, which the Nera workflow deploys with.`)
        await client.put(pagesPath(repository), { build_type: BUILD_TYPE })
        return { ...existing, build_type: BUILD_TYPE }
    }
    log(`GitHub Pages is already on for ${repository.repository}`)
    return existing
}

// The site's address as GitHub reports it: the Pages `html_url`.
async function liveUrl({ client, repository }) {
    const pages = await fetchPages(client, repository)
    if (!pages?.html_url) {
        throw new Error(`GitHub reports no GitHub Pages site for ${repository.repository}.`)
    }
    return pages.html_url
}

// The deploy job of the generated workflow (D5): fetch the `public/` folder
// the build job uploaded, hand it to Pages and deploy it. `pages: write` and
// `id-token: write` are what deploy-pages needs; the `github-pages`
// environment shows the deployment's address on the run. Action majors follow
// nera-website's workflow; download-artifact@v8 pairs with the build job's
// upload-artifact@v7.
function deployJob() {
    return {
        permissions: { pages: 'write', 'id-token': 'write' },
        job: {
            'runs-on': 'ubuntu-latest',
            environment: {
                name: 'github-pages',
                url: '${{ steps.deployment.outputs.page_url }}',
            },
            steps: [
                {
                    name: 'Download the built site',
                    uses: 'actions/download-artifact@v8',
                    with: { name: BUILD_ARTIFACT, path: BUILD_OUTPUT },
                },
                { name: 'Configure Pages', uses: 'actions/configure-pages@v6' },
                {
                    name: 'Upload Pages artifact',
                    uses: 'actions/upload-pages-artifact@v5',
                    with: { path: BUILD_OUTPUT },
                },
                { name: 'Deploy to GitHub Pages', id: 'deployment', uses: 'actions/deploy-pages@v5' },
            ],
        },
    }
}

export const githubPages = {
    id: 'github-pages',
    label: 'GitHub Pages',
    setUp,
    deployJob,
    liveUrl,
}
