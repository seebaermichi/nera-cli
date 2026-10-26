import { GitHubError } from './github.js'
import { PRIVATE_NOTE } from './repository.js'

// The GitHub Pages target of `nera publish` (ROADMAP-ai.md L6 step 4): the
// site is built and deployed by the generated Actions workflow, so Pages runs
// with the `workflow` build type. Every call goes through the host context's
// github.js client, so tests stub its fetch and use no network.

export const BUILD_TYPE = 'workflow'

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

// Enable Pages with the workflow build type, or reuse the site GitHub already
// has; one with the `legacy` (branch) build type is switched to `workflow`
// (D4), since the generated workflow is the only deploy path. Resolves the
// Pages site as GitHub describes it (`html_url`, `build_type`, `cname`, …).
async function setUp({ client, repository, log = (line) => console.log(line) }) {
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

// Not available yet: the adapter joins TARGETS once it contributes the
// deploy job.
function deployJob() {
    throw new Error('The GitHub Pages deploy job is not available in this version of Nera yet.')
}

export const githubPages = {
    id: 'github-pages',
    label: 'GitHub Pages',
    setUp,
    deployJob,
    liveUrl,
}
