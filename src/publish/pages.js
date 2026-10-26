import { Resolver } from 'dns/promises'
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

// GitHub Pages' addresses for a custom apex domain (GitHub's docs, "Managing
// a custom domain for your GitHub Pages site"); the AAAA ones are optional.
export const PAGES_A = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153']
export const PAGES_AAAA = ['2606:50c0:8000::153', '2606:50c0:8001::153', '2606:50c0:8002::153', '2606:50c0:8003::153']

// A lookup that finds no records is an answer, not a failure.
const NO_RECORDS = ['ENOTFOUND', 'ENODATA']
// Bounds a DNS check that cannot get an answer: milliseconds per try, tries.
const LOOKUP_TIMEOUT = 5000
const LOOKUP_TRIES = 2

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
// (D4), since the generated workflow is the only deploy path. `--domain`
// (`options.domain`) becomes the site's custom domain (D1). Then `base_path`
// in config/app.yaml follows the site's address (D2), before the first push
// commits it, and when the site has a custom domain its DNS is checked and
// reported (D6). Resolves the Pages site as GitHub describes it (`html_url`,
// `build_type`, `cname`, …). `resolver` stands in for the node:dns/promises
// Resolver of the DNS check, for tests.
async function setUp({
    client,
    repository,
    options = {},
    cwd = process.cwd(),
    log = (line) => console.log(line),
    resolver,
}) {
    let site = await enablePages({ client, repository, log })
    if (options.domain && options.domain !== site.cname?.toLowerCase()) {
        site = await setDomain({ client, repository, site, domain: options.domain, log })
    }
    await followPagesAddress(site, { cwd, log })
    if (site.cname) {
        const dns = await checkDns({
            domain: site.cname.toLowerCase(),
            owner: repository.owner,
            resolver: resolver ?? new Resolver({ timeout: LOOKUP_TIMEOUT, tries: LOOKUP_TRIES }),
        })
        reportDns(dns, log)
    }
    return site
}

// Make `domain` the Pages site's custom domain (D1: through the API, since
// GitHub ignores a CNAME file for a site an Actions workflow deploys).
// Resolves `site` as served from the domain's root; GitHub answers the PUT
// with no body, and reading the site back right away may still report the
// old address.
async function setDomain({ client, repository, site, domain, log }) {
    log(`Setting the custom domain ${domain} for GitHub Pages of ${repository.repository}…`)
    await client.put(pagesPath(repository), { cname: domain })
    return { ...site, cname: domain, html_url: `https://${domain}/` }
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

// `{ records }` from `lookup()`, `[]` when the name has none; a lookup that
// fails (a timeout, a server failure) resolves `{ records: [], failed }`
// with the error's code instead of throwing, since the check only reports.
async function lookupRecords(lookup) {
    try {
        return { records: await lookup() }
    } catch (err) {
        if (NO_RECORDS.includes(err?.code)) return { records: [] }
        return { records: [], failed: err?.code ?? String(err?.message ?? err) }
    }
}

// Whether `domain` points at the GitHub Pages site of `owner` (D6), looked up
// with `resolver` (resolveCname/resolve4/resolve6 of node:dns/promises).
// A CNAME counts when it names `<owner>.github.io`; without one, A records
// count when every one is GitHub's, AAAA records when there are none or
// every one is GitHub's. `expected` is what to set: GitHub's A and AAAA
// records for a two-label (apex) domain, a CNAME to `<owner>.github.io` for
// anything longer. Never throws for a failed lookup: `ok` is false and
// `failed` names the error codes. Resolves `{ domain, ok, expected, found,
// failed }`, records as `{ type, value }` (expected ones with `name`, and
// `optional` for AAAA).
export async function checkDns({ domain, owner, resolver }) {
    const target = `${owner.toLowerCase()}.github.io`
    const [cname, a, aaaa] = await Promise.all([
        lookupRecords(() => resolver.resolveCname(domain)),
        lookupRecords(() => resolver.resolve4(domain)),
        lookupRecords(() => resolver.resolve6(domain)),
    ])
    const cnames = cname.records.map((value) => value.toLowerCase().replace(/\.$/, ''))
    const allPages = (records, addresses) => records.every((ip) => addresses.includes(ip))
    const ok = cnames.length > 0
        ? cnames.includes(target)
        : a.records.length > 0 && allPages(a.records, PAGES_A) && allPages(aaaa.records, PAGES_AAAA)

    const expected = domain.split('.').length === 2
        ? [
            ...PAGES_A.map((value) => ({ type: 'A', name: domain, value })),
            ...PAGES_AAAA.map((value) => ({ type: 'AAAA', name: domain, value, optional: true })),
        ]
        : [{ type: 'CNAME', name: domain, value: target }]
    const found = [
        ...cnames.map((value) => ({ type: 'CNAME', value })),
        // A CNAME's own addresses are GitHub's business, not the user's.
        ...(cnames.length > 0 ? [] : [
            ...a.records.map((value) => ({ type: 'A', value })),
            ...aaaa.records.map((value) => ({ type: 'AAAA', value })),
        ]),
    ]
    const failed = [cname, a, aaaa].map((result) => result.failed).filter(Boolean)
    return { domain, ok, expected, found, failed: [...new Set(failed)] }
}

// Log what checkDns found (D6): "set up", or the records to set at the DNS
// provider. A missing or wrong record never fails the publish, since DNS
// changes take hours to spread.
export function reportDns({ domain, ok, expected, found, failed }, log) {
    if (ok) {
        log(`DNS for ${domain} is set up: it points to GitHub Pages.`)
        return
    }
    const now = failed.length > 0 && found.length === 0
        ? `could not be checked (${failed.join(', ')})`
        : found.length === 0
            ? 'is not set up yet: it has no records'
            : `does not point to GitHub Pages yet: it has ${found.map((record) => `${record.type} ${record.value}`).join(', ')}`
    log(`DNS for ${domain} ${now}. Set these records at your DNS provider${found.length > 0 ? ', in place of the ones it has' : ''}:`)
    const width = Math.max(...expected.map((record) => record.type.length))
    for (const record of expected) {
        log(`  ${record.type.padEnd(width)}  ${record.name}  ${record.value}${record.optional ? '  (optional, for IPv6)' : ''}`)
    }
    log('DNS changes can take a few hours to spread; the publish goes on, and every nera publish checks again.')
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
