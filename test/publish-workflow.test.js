import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { parse, parseDocument } from 'yaml'
import {
    renderWorkflow,
    writeWorkflow,
    WORKFLOW_FILE,
    BUILD_ARTIFACT,
    GENERATED_HEADER,
} from '../src/publish/workflow.js'

// The generated deploy workflow of `nera publish` (ROADMAP-ai.md L6 step 5).
// A fake adapter stands in for GitHub Pages and Netlify; every output is
// parsed with `yaml` so an indentation slip fails here, not in Actions.

const fakeAdapter = (deployJob) => ({
    id: 'fake',
    label: 'Fake Host',
    setUp: async () => {},
    deployJob,
    liveUrl: () => 'https://example.test/',
})

const pagesLike = () => ({
    permissions: { pages: 'write', 'id-token': 'write' },
    job: {
        'runs-on': 'ubuntu-latest',
        environment: { name: 'github-pages', url: '${{ steps.deployment.outputs.page_url }}' },
        steps: [
            { uses: 'actions/download-artifact@v8', with: { name: BUILD_ARTIFACT, path: 'public' } },
            { name: 'Deploy', id: 'deployment', uses: 'actions/deploy-pages@v5' },
        ],
    },
})

async function render(deployJob = pagesLike, ctx) {
    const text = await renderWorkflow(fakeAdapter(deployJob), ctx)
    const doc = parseDocument(text)
    expect(doc.errors).toEqual([])
    return { text, workflow: doc.toJS() }
}

describe('renderWorkflow', () => {
    it('starts with the generated header and is valid YAML', async () => {
        const { text } = await render()
        expect(text.startsWith(`${GENERATED_HEADER}\n`)).toBe(true)
        expect(text.endsWith('\n')).toBe(true)
    })

    it('runs on a push to main and by hand, one deploy at a time', async () => {
        const { workflow } = await render()
        expect(workflow.name).toBe('Deploy to Fake Host')
        expect(workflow.on).toEqual({ push: { branches: ['main'] }, workflow_dispatch: null })
        expect(workflow.concurrency).toEqual({ group: 'deploy', 'cancel-in-progress': false })
    })

    it('has the shared build job: checkout, Node 24 with npm cache, npm ci, npm run build, the public artifact', async () => {
        const { workflow } = await render()
        const { steps } = workflow.jobs.build
        expect(workflow.jobs.build['runs-on']).toBe('ubuntu-latest')
        expect(steps.map((step) => step.uses ?? step.run)).toEqual([
            'actions/checkout@v7',
            'actions/setup-node@v7',
            'npm ci',
            'npm run build',
            'actions/upload-artifact@v7',
        ])
        expect(steps[1].with).toEqual({ 'node-version': 24, cache: 'npm' })
        expect(steps[4].with).toEqual({ name: BUILD_ARTIFACT, path: 'public', 'if-no-files-found': 'error' })
    })

    it('appends the adapter deploy job after the build job', async () => {
        const { workflow } = await render()
        const expected = pagesLike().job
        expect(Object.keys(workflow.jobs)).toEqual(['build', 'deploy'])
        expect(workflow.jobs.deploy).toEqual({
            needs: 'build',
            permissions: { contents: 'read', pages: 'write', 'id-token': 'write' },
            ...expected,
        })
    })

    it('gives the workflow and the build job contents: read only, the adapter scopes going to the deploy job', async () => {
        const { workflow } = await render()
        expect(workflow.permissions).toEqual({ contents: 'read' })
        expect(workflow.jobs.build.permissions).toBeUndefined()
        expect(workflow.jobs.deploy.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    })

    it('merges the adapter permissions into contents: read, the higher level winning', async () => {
        const lowered = await render(() => ({ permissions: { contents: 'none', deployments: 'write' }, job: { 'runs-on': 'ubuntu-latest' } }))
        expect(lowered.workflow.jobs.deploy.permissions).toEqual({ contents: 'read', deployments: 'write' })

        const raised = await render(() => ({ permissions: { contents: 'write' }, job: { 'runs-on': 'ubuntu-latest' } }))
        expect(raised.workflow.jobs.deploy.permissions).toEqual({ contents: 'write' })
        expect(raised.workflow.permissions).toEqual({ contents: 'read' })
    })

    it('grants only contents: read when the adapter asks for nothing', async () => {
        const { workflow } = await render(() => ({ job: { 'runs-on': 'ubuntu-latest' } }))
        expect(workflow.jobs.deploy.permissions).toEqual({ contents: 'read' })
    })

    it('hands ctx to deployJob and accepts an async one', async () => {
        const seen = []
        const { workflow } = await render(async (ctx) => {
            seen.push(ctx)
            return { job: { 'runs-on': 'ubuntu-latest', env: { SITE: ctx.repository } } }
        }, { repository: 'octo/site' })
        expect(seen).toEqual([{ repository: 'octo/site' }])
        expect(workflow.jobs.deploy.env).toEqual({ SITE: 'octo/site' })
    })

    it('quotes a label that would not be a plain YAML value', async () => {
        const adapter = { ...fakeAdapter(pagesLike), label: 'Host: #1' }
        expect(parse(await renderWorkflow(adapter)).name).toBe('Deploy to Host: #1')
    })

    it('rejects a deploy job that is missing, sets needs, or asks for an unknown permission level', async () => {
        await expect(renderWorkflow(fakeAdapter(() => undefined))).rejects.toThrow(/deployJob\(\) must return \{ permissions, job \}/)
        await expect(renderWorkflow(fakeAdapter(() => ({ job: [] })))).rejects.toThrow(/with a job object/)
        await expect(renderWorkflow(fakeAdapter(() => ({ job: { needs: 'other' } })))).rejects.toThrow(/must not set job\.needs/)
        await expect(renderWorkflow(fakeAdapter(() => ({ job: { permissions: { pages: 'write' } } })))).rejects.toThrow(/must not set job\.permissions/)
        await expect(renderWorkflow(fakeAdapter(() => ({ permissions: { pages: 'admin' }, job: {} }))))
            .rejects.toThrow(/permission "pages" must be one of none, read, write, got "admin"/)
    })

    it('writes no secret or token of its own', async () => {
        const { text } = await render()
        expect(text).not.toMatch(/secrets\.|github_token|gh[opsu]_/i)
    })
})

describe('writeWorkflow', () => {
    let cwd

    beforeEach(async () => {
        cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-publish-workflow-'))
    })

    afterEach(async () => {
        await fs.rm(cwd, { recursive: true, force: true })
    })

    const file = () => path.join(cwd, WORKFLOW_FILE)

    it('creates the workflow, folders included', async () => {
        const result = await writeWorkflow(fakeAdapter(pagesLike), {}, cwd)
        expect(result).toEqual({ file: file(), status: 'created', message: `Created ${WORKFLOW_FILE}.` })
        expect(await fs.readFile(file(), 'utf-8')).toBe(await renderWorkflow(fakeAdapter(pagesLike)))
    })

    it('reports unchanged when the file is already current, and updates a stale generated one', async () => {
        await writeWorkflow(fakeAdapter(pagesLike), {}, cwd)
        expect((await writeWorkflow(fakeAdapter(pagesLike), {}, cwd)).status).toBe('unchanged')

        await fs.writeFile(file(), `${GENERATED_HEADER}\n# an older generated version\n`)
        const result = await writeWorkflow(fakeAdapter(pagesLike), {}, cwd)
        expect(result.status).toBe('updated')
        expect(result.message).toBe(`Updated ${WORKFLOW_FILE}.`)
        expect(await fs.readFile(file(), 'utf-8')).toBe(await renderWorkflow(fakeAdapter(pagesLike)))
    })

    it('keeps and reports a workflow the user took over', async () => {
        const own = 'name: My own deploy\non: push\njobs: {}\n'
        await fs.mkdir(path.dirname(file()), { recursive: true })
        await fs.writeFile(file(), own)

        const result = await writeWorkflow(fakeAdapter(pagesLike), {}, cwd)
        expect(result.status).toBe('kept')
        expect(result.message).toMatch(/^Kept your \.github\/workflows\/deploy\.yml/)
        expect(result.message).toContain('Fake Host')
        expect(await fs.readFile(file(), 'utf-8')).toBe(own)
    })

    it('does not call the adapter when the workflow is kept', async () => {
        await fs.mkdir(path.dirname(file()), { recursive: true })
        await fs.writeFile(file(), 'name: mine\n')
        let called = false
        await writeWorkflow(fakeAdapter(() => {
            called = true
            return pagesLike()
        }), {}, cwd)
        expect(called).toBe(false)
    })
})
