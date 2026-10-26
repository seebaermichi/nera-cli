import { describe, it, expect } from 'vitest'
import { parseDocument } from 'yaml'
import { githubPages, BUILD_TYPE } from '../src/publish/pages.js'
import { assertAdapter } from '../src/publish/targets.js'
import { createGitHubClient, GitHubError, GITHUB_API } from '../src/publish/github.js'
import { PRIVATE_NOTE } from '../src/publish/repository.js'
import { renderWorkflow, BUILD_ARTIFACT, BUILD_JOB_ID } from '../src/publish/workflow.js'

// The GitHub Pages adapter of `nera publish` (ROADMAP-ai.md L6 step 4).
// GitHub is a stub behind the real github.js client: no test uses the
// network or a real token.

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
// records its lines.
function host(client, repo = repository()) {
    const lines = []
    return { ctx: { client, repository: repo, log: (line) => lines.push(line) }, lines }
}

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

    it('downloads the build artifact into public, configures, uploads and deploys it', async () => {
        const workflow = await rendered()
        const { steps } = workflow.jobs.deploy
        expect(steps.map((step) => step.uses)).toEqual([
            'actions/download-artifact@v8',
            'actions/configure-pages@v6',
            'actions/upload-pages-artifact@v5',
            'actions/deploy-pages@v5',
        ])
        const upload = workflow.jobs[BUILD_JOB_ID].steps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))
        expect(steps[0].with).toEqual({ name: BUILD_ARTIFACT, path: upload.with.path })
        expect(upload.with).toMatchObject({ name: BUILD_ARTIFACT, path: 'public' })
        expect(steps[2].with).toEqual({ path: 'public' })
        expect(steps[3].id).toBe('deployment')
    })

    it('needs no secret or token', async () => {
        const text = await renderWorkflow(githubPages, {})
        expect(text).not.toMatch(/secrets\.|github_token|gh[opsu]_/i)
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
        expect(lines).toEqual(['Switching on GitHub Pages for octo/site…'])
    })

    it('reuses a Pages site that already deploys with GitHub Actions', async () => {
        const site = pagesSite({ cname: 'example.com', html_url: 'https://example.com/' })
        const { client, requests } = fakeGitHub({
            [PAGES]: () => [200, site],
        })
        const { ctx, lines } = host(client)

        await expect(githubPages.setUp(ctx)).resolves.toEqual(site)
        expect(requests.map((r) => r.route)).toEqual([PAGES])
        expect(lines).toEqual(['GitHub Pages is already on for octo/site'])
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
        expect(lines).toEqual(['GitHub Pages of octo/site deployed from a branch; switching it to GitHub Actions, which the Nera workflow deploys with.'])
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
