import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { parseDocument } from 'yaml'
import {
    githubPages,
    BUILD_TYPE,
    APP_CONFIG,
    PAGES_A,
    PAGES_AAAA,
    basePathOf,
    writeBasePath,
} from '../src/publish/pages.js'
import { assertAdapter } from '../src/publish/targets.js'
import { createGitHubClient, GitHubError, GITHUB_API } from '../src/publish/github.js'
import { PRIVATE_NOTE } from '../src/publish/repository.js'
import { renderWorkflow, writeWorkflow, BUILD_JOB_ID, BUILD_STEPS, WORKFLOW_FILE } from '../src/publish/workflow.js'
import { fakeResolver } from './helpers/fake-dns.js'

// The GitHub Pages adapter of `nera publish` (ROADMAP-ai.md L6 step 4).
// GitHub is a stub behind the real github.js client and DNS a stub resolver:
// no test uses the network or a real token.

const TOKEN = 'ghu_fake_access_token'
const PAGES = 'GET /repos/octo/site/pages'
const ENABLE = 'POST /repos/octo/site/pages'
const SWITCH = 'PUT /repos/octo/site/pages'

const jsonResponse = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: `status ${status}`,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
})

const pagesSite = (extra = {}) => ({
    url: `${GITHUB_API}/repos/octo/site/pages`,
    html_url: 'https://octo.github.io/site/',
    build_type: 'workflow',
    cname: null,
    ...extra,
})

const repository = (extra = {}) => ({
    repository: 'octo/site',
    owner: 'octo',
    name: 'site',
    private: false,
    ...extra,
})

// A stub GitHub. `routes` maps "METHOD /path" to a handler(body) returning
// [status, json] (or a queue of them); every request is recorded.
function fakeGitHub(routes) {
    const requests = []
    const fetch = async (url, init = {}) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        const body = init.body === undefined ? undefined : JSON.parse(init.body)
        requests.push({ route, body })
        let handler = routes[route]
        if (Array.isArray(handler)) handler = handler.length > 1 ? handler.shift() : handler[0]
        if (!handler) return jsonResponse(404, { message: 'Not Found' })
        const [status, json] = handler(body)
        return jsonResponse(status, json)
    }
    return { client: createGitHubClient({ token: TOKEN, fetch }), requests }
}

// The host context publishSite hands every adapter method, with a log that
// records its lines. `cwd` is the temp site of the test; `extra` adds to the
// context (`options`, `resolver`, whose default finds no records).
function host(client, repo = repository(), cwd = site, extra = {}) {
    const lines = []
    const ctx = { cwd, client, repository: repo, resolver: fakeResolver(), log: (line) => lines.push(line), ...extra }
    return { ctx, lines }
}

const APP_YAML = `# The site's settings
lang: en
name: My Nera Site # shown in the title
`

// A temp site with config/app.yaml for every test; tests that need another
// file content write it.
let site
const appYaml = () => fs.readFile(path.join(site, APP_CONFIG), 'utf-8')
const writeAppYaml = (text) => fs.writeFile(path.join(site, APP_CONFIG), text)

beforeEach(async () => {
    site = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-publish-pages-'))
    await fs.mkdir(path.join(site, 'config'))
    await writeAppYaml(APP_YAML)
})

afterEach(async () => {
    await fs.rm(site, { recursive: true, force: true })
})

// The line setUp logs while GitHub has no certificate for the custom domain.
const httpsLater = (domain) =>
    `HTTPS is not enforced for ${domain} yet: GitHub issues its certificate once the DNS records point to GitHub Pages, and running nera publish again then switches HTTPS on.`

describe('githubPages adapter', () => {
    it('has the adapter interface', () => {
        expect(assertAdapter(githubPages)).toBe(githubPages)
        expect(githubPages.id).toBe('github-pages')
        expect(githubPages.label).toBe('GitHub Pages')
    })
})

describe('githubPages.deployJob, in the rendered workflow', () => {
    const rendered = async () => {
        const text = await renderWorkflow(githubPages, {})
        const doc = parseDocument(text)
        expect(doc.errors).toEqual([])
        return doc.toJS()
    }

    it('names the workflow after GitHub Pages and keeps the shared build job', async () => {
        const workflow = await rendered()
        expect(workflow.name).toBe('Deploy to GitHub Pages')
        expect(Object.keys(workflow.jobs)).toEqual([BUILD_JOB_ID, 'deploy'])
        expect(workflow.permissions).toEqual({ contents: 'read' })
        expect(workflow.jobs[BUILD_JOB_ID].permissions).toBeUndefined()
    })

    it('deploys after the build with the scopes deploy-pages needs, in the github-pages environment', async () => {
        const { deploy } = (await rendered()).jobs
        expect(deploy.needs).toBe(BUILD_JOB_ID)
        expect(deploy['runs-on']).toBe('ubuntu-latest')
        expect(deploy.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
        expect(deploy.environment).toEqual({
            name: 'github-pages',
            url: '${{ steps.deployment.outputs.page_url }}',
        })
    })

    it('uploads public as the github-pages artifact in the build job, under the build job\'s upload step name', async () => {
        const { build } = (await rendered()).jobs
        const uploads = build.steps.filter((step) => step.name === BUILD_STEPS.upload)
        expect(uploads).toEqual([{
            name: BUILD_STEPS.upload,
            uses: 'actions/upload-pages-artifact@v5',
            with: { path: 'public' },
        }])
        expect(build.steps.at(-1)).toBe(uploads[0])
        expect(build.steps.some((step) => step.uses?.startsWith('actions/upload-artifact@'))).toBe(false)
    })

    it('only configures Pages and deploys in the deploy job, with no site artifact', async () => {
        const text = await renderWorkflow(githubPages, {})
        const { steps } = (await rendered()).jobs.deploy
        expect(steps.map((step) => step.uses)).toEqual([
            'actions/configure-pages@v6',
            'actions/deploy-pages@v5',
        ])
        expect(steps[1].id).toBe('deployment')
        expect(text).not.toMatch(/download-artifact|name: site\b/)
    })

    it('needs no secret or token', async () => {
        const text = await renderWorkflow(githubPages, {})
        expect(text).not.toMatch(/secrets\.|github_token|gh[opsu]_/i)
    })
})

// The Pages workflow 1.27.0 generated, rendered from that release's source:
// its deploy job uploaded github-pages and deployed it in the same job, which
// deploy-pages could not find (GitHub #18).
const PAGES_WORKFLOW_1_27_0 = fileURLToPath(new URL('./fixtures/pages-deploy-1.27.0.yml', import.meta.url))

describe('a site with the 1.27.0 Pages workflow', () => {
    it('gets the new workflow when nera publish writes it again', async () => {
        const old = await fs.readFile(PAGES_WORKFLOW_1_27_0, 'utf-8')
        const file = path.join(site, WORKFLOW_FILE)
        await fs.mkdir(path.dirname(file), { recursive: true })
        await fs.writeFile(file, old)

        const result = await writeWorkflow(githubPages, {}, site)

        expect(result).toEqual({ file, status: 'updated', message: `Updated ${WORKFLOW_FILE}.` })
        const written = await fs.readFile(file, 'utf-8')
        expect(written).toBe(await renderWorkflow(githubPages, {}))
        expect(old).toMatch(/download-artifact/)
        expect(written).not.toMatch(/download-artifact/)
    })
})

describe('githubPages.setUp', () => {
    it('enables Pages with the workflow build type when the repository has none', async () => {
        const site = pagesSite()
        const { client, requests } = fakeGitHub({
            [ENABLE]: () => [201, site],
        })
        const { ctx, lines } = host(client)

        await expect(githubPages.setUp(ctx)).resolves.toEqual(site)
        expect(requests.map((r) => r.route)).toEqual([PAGES, ENABLE])
        expect(requests[1].body).toEqual({ build_type: BUILD_TYPE })
        expect(BUILD_TYPE).toBe('workflow')
        expect(lines).toEqual([
            'Switching on GitHub Pages for octo/site…',
            'Set base_path to /site in config/app.yaml: https://octo.github.io/site/ serves the site below /site.',
        ])
    })

    it('reuses a Pages site that already deploys with GitHub Actions', async () => {
        const site = pagesSite({ cname: 'example.com', html_url: 'https://example.com/' })
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, site],
        })
        const { ctx, lines } = host(client, repository(), undefined, { resolver: fakeResolver({ A: PAGES_A }) })

        await expect(githubPages.setUp(ctx)).resolves.toEqual(site)
        expect(requests.map((r) => r.route)).toEqual([PAGES])
        expect(lines).toEqual([
            'GitHub Pages is already on for octo/site',
            'DNS for example.com is set up: it points to GitHub Pages.',
            httpsLater('example.com'),
        ])
    })

    it('switches a branch-deployed (legacy) Pages site to the workflow build type', async () => {
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, pagesSite({ build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } })],
            [SWITCH]: () => [204],
        })
        const { ctx, lines } = host(client)

        const site = await githubPages.setUp(ctx)
        expect(site.build_type).toBe('workflow')
        expect(site.html_url).toBe('https://octo.github.io/site/')
        expect(requests.map((r) => r.route)).toEqual([PAGES, SWITCH])
        expect(requests[1].body).toEqual({ build_type: 'workflow' })
        expect(lines).toEqual([
            'GitHub Pages of octo/site deployed from a branch; switching it to GitHub Actions, which the Nera workflow deploys with.',
            'Set base_path to /site in config/app.yaml: https://octo.github.io/site/ serves the site below /site.',
        ])
    })

    it.each([
        [422, 'Your current plan does not support GitHub Pages for this repository.'],
        [403, 'Upgrade to GitHub Pro or make this repository public to enable Pages.'],
    ])('explains GitHub\'s %i refusal for a private repository on a free plan', async (status, message) => {
        const { client } = fakeGitHub({
            [ENABLE]: () => [status, { message }],
        })
        const { ctx } = host(client, repository({ private: true }))

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).not.toBeInstanceOf(GitHubError)
        expect(error.message).toBe(`GitHub Pages cannot be switched on for the private repository octo/site. ${PRIVATE_NOTE}`)
    })

    it('lets a 403 without a plan message through unchanged (missing permission)', async () => {
        const { client } = fakeGitHub({
            [ENABLE]: () => [403, { message: 'Resource not accessible by integration' }],
        })
        const { ctx } = host(client, repository({ private: true }))

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(403)
        expect(error.message).toBe('GitHub answered 403 to POST /repos/octo/site/pages: Resource not accessible by integration')
    })

    it('lets a plan message for a public repository through unchanged', async () => {
        const { client } = fakeGitHub({
            [ENABLE]: () => [422, { message: 'Your current plan does not support GitHub Pages for this repository.' }],
        })
        const { ctx } = host(client)

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(422)
    })

    it('lets any other error of the Pages lookup through unchanged', async () => {
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [500, { message: 'Server Error' }],
        })
        const { ctx } = host(client)

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.message).toBe('GitHub answered 500 to GET /repos/octo/site/pages: Server Error')
        expect(requests.map((r) => r.route)).toEqual([PAGES])
    })

    it('lets a failed switch from legacy through unchanged', async () => {
        const { client } = fakeGitHub({
            [PAGES]: () => [200, pagesSite({ build_type: 'legacy' })],
            [SWITCH]: () => [403, { message: 'Resource not accessible by integration' }],
        })
        const { ctx } = host(client)

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(403)
    })
})

describe('githubPages.setUp: base_path follows the Pages address', () => {
    const setUpWith = async (pages) => {
        const { client } = fakeGitHub({ [PAGES]: () => [200, pages] })
        const { ctx, lines } = host(client)
        await githubPages.setUp(ctx)
        return lines.slice(1)
    }

    it('sets base_path for a project page, keeping comments and the other keys', async () => {
        const lines = await setUpWith(pagesSite())

        expect(await appYaml()).toBe(`${APP_YAML}base_path: /site\n`)
        expect(lines).toEqual(['Set base_path to /site in config/app.yaml: https://octo.github.io/site/ serves the site below /site.'])
    })

    it('replaces a wrong base_path in place', async () => {
        await writeAppYaml('lang: en\nbase_path: /old # set by hand\nname: Site\n')

        await setUpWith(pagesSite())
        expect(await appYaml()).toBe('lang: en\nbase_path: /site # set by hand\nname: Site\n')
    })

    it.each([
        ['a user.github.io repository', 'https://octo.github.io/'],
        ['a custom domain', 'https://example.com/'],
        ['a custom domain without a trailing slash', 'https://example.com'],
    ])('removes base_path for %s', async (_, htmlUrl) => {
        await writeAppYaml('# settings\nlang: en\nbase_path: /site\nname: Site # title\n')

        const lines = await setUpWith(pagesSite({ html_url: htmlUrl }))
        expect(await appYaml()).toBe('# settings\nlang: en\nname: Site # title\n')
        expect(lines).toEqual([`Removed base_path from config/app.yaml: ${htmlUrl} serves the site from the root.`])
    })

    it.each([['\'\''], ['/']])('removes a root base_path of %s rather than keeping it', async (value) => {
        await writeAppYaml(`lang: en\nbase_path: ${value}\n`)

        await setUpWith(pagesSite({ html_url: 'https://example.com/' }))
        expect(await appYaml()).toBe('lang: en\n')
    })

    it.each([
        ['already right', 'https://octo.github.io/site/', 'lang: en # kept as it is\nbase_path: /site\n'],
        ['spelled the way core normalises', 'https://octo.github.io/site/', 'lang: en\nbase_path: site/\n'],
        ['absent for a root-served site', 'https://example.com/', APP_YAML],
    ])('leaves config/app.yaml untouched when base_path is %s', async (_, htmlUrl, text) => {
        await writeAppYaml(text)
        const before = (await fs.stat(path.join(site, APP_CONFIG))).mtimeMs

        const lines = await setUpWith(pagesSite({ html_url: htmlUrl }))
        expect(await appYaml()).toBe(text)
        expect((await fs.stat(path.join(site, APP_CONFIG))).mtimeMs).toBe(before)
        expect(lines).toEqual([])
    })

    it('fails, naming the file, when the site has no config/app.yaml', async () => {
        await fs.rm(path.join(site, APP_CONFIG))

        await expect(setUpWith(pagesSite())).rejects.toThrow(
            'config/app.yaml is missing; nera publish needs the site\'s config to set base_path.',
        )
    })

    it('fails, naming the file, when config/app.yaml is not a mapping', async () => {
        await writeAppYaml('- just\n- a list\n')

        await expect(setUpWith(pagesSite())).rejects.toThrow('config/app.yaml must be a mapping of keys to values')
    })

    it('fails when GitHub reports no address for the Pages site', async () => {
        await expect(setUpWith(pagesSite({ html_url: null }))).rejects.toThrow(
            'GitHub reported no address for the GitHub Pages site, so base_path cannot be set.',
        )
        expect(await appYaml()).toBe(APP_YAML)
    })
})

describe('basePathOf', () => {
    it.each([
        ['https://octo.github.io/site/', '/site'],
        ['https://octo.github.io/site', '/site'],
        ['https://octo.github.io/', ''],
        ['https://example.com', ''],
        ['https://example.com/docs//', '/docs'],
    ])('%s → %j', (htmlUrl, expected) => {
        expect(basePathOf(htmlUrl)).toBe(expected)
    })
})

describe('writeBasePath', () => {
    it('resolves whether the file changed', async () => {
        await expect(writeBasePath(site, '/site')).resolves.toBe(true)
        await expect(writeBasePath(site, '/site')).resolves.toBe(false)
        await expect(writeBasePath(site, '')).resolves.toBe(true)
        await expect(writeBasePath(site, '')).resolves.toBe(false)
        expect(await appYaml()).toBe(APP_YAML)
    })

    it.each([
        ['4-space', '    '],
        ['2-space', '  '],
    ])('keeps the rest of a %s file as written', async (_, pad) => {
        const long = 'A description that runs well past the eighty characters yaml folds lines at by default'
        const text = `lang: en\ndescription: ${long}\nlist: [a, b]\nfolders:\n${pad}plugins: ./plugins\ntranslations:\n${pad}en:\n${pad}${pad}imprint: Imprint\n`
        await writeAppYaml(text)

        await expect(writeBasePath(site, '/site')).resolves.toBe(true)
        expect(await appYaml()).toBe(`${text}base_path: /site\n`)
    })

    it('replaces a base_path that is not text', async () => {
        await writeAppYaml('base_path: 42\n')

        await expect(writeBasePath(site, '/site')).resolves.toBe(true)
        expect(await appYaml()).toBe('base_path: /site\n')
    })

    it('fails, naming the file, on invalid YAML', async () => {
        await writeAppYaml('lang: [en\n')

        await expect(writeBasePath(site, '/site')).rejects.toThrow(/^config\/app\.yaml is not valid YAML: /)
    })
})

describe('githubPages.setUp: --domain', () => {
    const withDomain = (client, domain, resolver = fakeResolver()) =>
        host(client, repository(), undefined, { options: { domain }, resolver })

    it('sets the custom domain through the Pages API, drops base_path and reports the DNS records to set', async () => {
        await writeAppYaml('lang: en\nbase_path: /site\n')
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, pagesSite()],
            [SWITCH]: () => [204],
        })
        const resolver = fakeResolver()
        const { ctx, lines } = withDomain(client, 'example.com', resolver)

        const result = await githubPages.setUp(ctx)
        expect(result).toMatchObject({ cname: 'example.com', html_url: 'https://example.com/', build_type: 'workflow' })
        expect(requests.map((r) => r.route)).toEqual([PAGES, SWITCH])
        expect(requests[1].body).toEqual({ cname: 'example.com' })
        expect(await appYaml()).toBe('lang: en\n')
        expect(resolver.lookups.sort()).toEqual(['A example.com', 'AAAA example.com', 'CNAME example.com'])
        expect(lines).toEqual([
            'GitHub Pages is already on for octo/site',
            'Setting the custom domain example.com for GitHub Pages of octo/site…',
            'Removed base_path from config/app.yaml: https://example.com/ serves the site from the root.',
            'DNS for example.com is not set up yet: it has no records. Set these records at your DNS provider:',
            ...PAGES_A.map((ip) => `  A     example.com  ${ip}`),
            ...PAGES_AAAA.map((ip) => `  AAAA  example.com  ${ip}  (optional, for IPv6)`),
            'DNS changes can take a few hours to spread; the publish goes on, and every nera publish checks again.',
            httpsLater('example.com'),
        ])
    })

    it('a site that already has the domain is not changed; its DNS is checked again', async () => {
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, pagesSite({ cname: 'WWW.Example.com', html_url: 'https://www.example.com/' })],
        })
        const { ctx, lines } = withDomain(client, 'www.example.com', fakeResolver({ CNAME: ['octo.github.io'] }))

        await githubPages.setUp(ctx)
        expect(requests.map((r) => r.route)).toEqual([PAGES])
        expect(lines.slice(-2)).toEqual(['DNS for www.example.com is set up: it points to GitHub Pages.', httpsLater('www.example.com')])
    })

    it('a new Pages site gets the domain after it is enabled', async () => {
        const { client, requests } = fakeGitHub({
            [ENABLE]: () => [201, pagesSite()],
            [SWITCH]: () => [204],
        })
        const { ctx } = withDomain(client, 'www.example.com')

        await githubPages.setUp(ctx)
        expect(requests.map((r) => [r.route, r.body])).toEqual([
            [PAGES, undefined],
            [ENABLE, { build_type: 'workflow' }],
            [SWITCH, { cname: 'www.example.com' }],
        ])
        expect(await appYaml()).toBe(APP_YAML)
    })

    it('a legacy site is switched to workflow, then given the domain', async () => {
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, pagesSite({ build_type: 'legacy' })],
            [SWITCH]: () => [204],
        })
        const { ctx } = withDomain(client, 'example.com')

        await githubPages.setUp(ctx)
        expect(requests.map((r) => r.body).slice(1)).toEqual([{ build_type: 'workflow' }, { cname: 'example.com' }])
    })

    it('without --domain and without a custom domain, nothing is looked up', async () => {
        const { client } = fakeGitHub({ [PAGES]: () => [200, pagesSite()] })
        const resolver = fakeResolver()
        const { ctx, lines } = host(client, repository(), undefined, { resolver })

        await githubPages.setUp(ctx)
        expect(resolver.lookups).toEqual([])
        expect(lines.join('\n')).not.toContain('DNS')
    })

    it('lets GitHub\'s refusal of the domain through unchanged', async () => {
        const { client } = fakeGitHub({
            [PAGES]: () => [200, pagesSite()],
            [SWITCH]: () => [400, { message: 'The CNAME `example.com` is already taken.' }],
        })
        const { ctx } = withDomain(client, 'example.com')

        const error = await githubPages.setUp(ctx).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(400)
        expect(await appYaml()).toBe(APP_YAML)
    })
})

describe('githubPages.setUp: HTTPS for a custom domain', () => {
    const DOMAIN = 'www.example.com'
    const domainSite = (extra = {}) => pagesSite({ cname: DOMAIN, html_url: `http://${DOMAIN}/`, https_enforced: false, ...extra })
    const certificate = (state) => ({ https_certificate: { state, description: `Certificate ${state}`, domains: [DOMAIN] } })
    const setUp = async (routes, options) => {
        const github = fakeGitHub(routes)
        const { ctx, lines } = host(github.client, repository(), undefined, { options, resolver: fakeResolver({ CNAME: ['octo.github.io'] }) })
        const result = await githubPages.setUp(ctx)
        return { result, lines, requests: github.requests }
    }
    const puts = (requests) => requests.filter((r) => r.route === SWITCH).map((r) => r.body)

    it('the certificate is approved and HTTPS not enforced: one PUT of https_enforced alone, and a log line', async () => {
        const { result, lines, requests } = await setUp({
            [PAGES]: () => [200, domainSite(certificate('approved'))],
            [SWITCH]: () => [204],
        })
        expect(puts(requests)).toEqual([{ https_enforced: true }])
        expect(lines.at(-1)).toBe(`HTTPS is now enforced for ${DOMAIN}: GitHub has its certificate.`)
        expect(result).toMatchObject({ cname: DOMAIN, https_enforced: true })
    })

    it('HTTPS already enforced: no PUT and no HTTPS line', async () => {
        const { lines, requests } = await setUp({
            [PAGES]: () => [200, domainSite({ ...certificate('approved'), https_enforced: true })],
        })
        expect(puts(requests)).toEqual([])
        expect(lines.join('\n')).not.toContain('HTTPS')
    })

    it.each([
        ['a pending certificate', certificate('authorization_pending')],
        ['no certificate', {}],
        ['a certificate of null', { https_certificate: null }],
    ])('%s: no PUT, the "run again" line', async (_, extra) => {
        const { lines, requests } = await setUp({ [PAGES]: () => [200, domainSite(extra)] })
        expect(puts(requests)).toEqual([])
        expect(lines.at(-1)).toBe(httpsLater(DOMAIN))
    })

    it.each([404, 422])('GitHub refuses the PUT with %i: no throw, the "run again" line', async (status) => {
        const { result, lines, requests } = await setUp({
            [PAGES]: () => [200, domainSite(certificate('approved'))],
            [SWITCH]: () => [status, { message: 'The certificate does not exist yet' }],
        })
        expect(puts(requests)).toEqual([{ https_enforced: true }])
        expect(lines.at(-1)).toBe(httpsLater(DOMAIN))
        expect(result.https_enforced).toBe(false)
    })

    it('lets any other error of the PUT through unchanged', async () => {
        const error = await setUp({
            [PAGES]: () => [200, domainSite(certificate('approved'))],
            [SWITCH]: () => [500, { message: 'Server Error' }],
        }).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(500)
    })

    it('a domain set in this run takes the "run again" path, even when the old domain had an approved certificate', async () => {
        const { result, lines, requests } = await setUp({
            [PAGES]: () => [200, pagesSite({ cname: 'old.example.com', html_url: 'https://old.example.com/', https_enforced: true, ...certificate('approved') })],
            [SWITCH]: () => [204],
        }, { domain: DOMAIN })
        expect(puts(requests)).toEqual([{ cname: DOMAIN }])
        expect(lines.at(-1)).toBe(httpsLater(DOMAIN))
        expect(result).not.toHaveProperty('https_certificate')
        expect(result).not.toHaveProperty('https_enforced')
    })

    it('a site without a custom domain: no PUT and no HTTPS line', async () => {
        const { lines, requests } = await setUp({ [PAGES]: () => [200, pagesSite(certificate('approved'))] })
        expect(puts(requests)).toEqual([])
        expect(lines.join('\n')).not.toContain('HTTPS')
    })
})

describe('githubPages.liveUrl', () => {
    it('returns the html_url GitHub reports for the Pages site', async () => {
        const { client } = fakeGitHub({
            [PAGES]: () => [200, pagesSite({ html_url: 'https://example.com/' })],
        })
        const { ctx } = host(client)

        await expect(githubPages.liveUrl(ctx)).resolves.toBe('https://example.com/')
    })

    it('throws when the repository has no Pages site', async () => {
        const { client } = fakeGitHub({})
        const { ctx } = host(client)

        await expect(githubPages.liveUrl(ctx)).rejects.toThrow('GitHub reports no GitHub Pages site for octo/site.')
    })
})

describe('githubPages.leftBehind', () => {
    const unpublish = 'The GitHub Pages site of octo/site is still online. To remove it, choose "Unpublish site" at https://github.com/octo/site/settings/pages'

    it('names where to unpublish the Pages site and how to move a custom domain, without calling GitHub', async () => {
        const { client, requests } = fakeGitHub({})
        const { ctx } = host(client, repository(), site, { options: {} })

        expect(await githubPages.leftBehind(ctx)).toEqual([
            unpublish,
            'If the site has a custom domain, it still points to GitHub Pages until its DNS records change: run nera publish --domain <your domain> to set it on the new host and list the records.',
        ])
        expect(requests).toEqual([])
    })

    it('with --domain, points to the DNS check of the new host instead', async () => {
        const { client, requests } = fakeGitHub({})
        const { ctx } = host(client, repository(), site, { options: { domain: 'www.example.com' } })

        expect(await githubPages.leftBehind(ctx)).toEqual([
            unpublish,
            'www.example.com is now set on the new host; the DNS check above says whether its records still point to GitHub Pages.',
        ])
        expect(requests).toEqual([])
    })
})
