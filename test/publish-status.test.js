import { describe, it, expect } from 'vitest'
import { createGitHubClient, GitHubError, GITHUB_API } from '../src/publish/github.js'
import {
    waitForRun,
    watchDeploy,
    describeFailure,
    logExcerpt,
    DeployError,
    RUN_POLL_MS,
    RUN_TIMEOUT_MS,
    TRANSIENT_RETRIES,
    EXCERPT_LINES,
    WORKFLOW_PATH,
} from '../src/publish/status.js'
import { BUILD_STEPS } from '../src/publish/workflow.js'
import { jsonResponse } from './helpers/fake-github.js'

// Following the deploy run after the push (ROADMAP-ai.md L6 step 5). The
// Actions API is an in-memory fake behind the real github.js client; the
// clock is fake too, so no test waits or touches the network.

const TOKEN = 'ghu_fake_access_token'
const REPOSITORY = 'octo/site'
const SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const adapter = { id: 'fake-host', label: 'Fake Host' }
const OFFLINE = 'offline'

const run = (id, overrides = {}) => ({
    id,
    head_sha: SHA,
    path: WORKFLOW_PATH,
    status: 'completed',
    conclusion: 'success',
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
    ...overrides,
})

// A fake Actions API. `polls` is the list of run lists answered one per
// poll (the last one repeats); a number in their place is an HTTP status to
// answer that poll with, OFFLINE a network failure. `jobs` and `logs` answer
// the failure report.
function fakeActions({ polls = [[]], jobs = [], logs = {} } = {}) {
    const requests = []
    let poll = 0
    const fetch = async (url, init) => {
        const route = `${init.method} ${url.slice(GITHUB_API.length)}`
        requests.push(route)
        let match
        if (route.startsWith(`GET /repos/${REPOSITORY}/actions/runs?`)) {
            const runs = polls[Math.min(poll++, polls.length - 1)]
            if (runs === OFFLINE) throw new TypeError('fetch failed')
            if (typeof runs === 'number') return jsonResponse(runs, { message: `Status ${runs}` })
            return jsonResponse(200, { total_count: runs.length, workflow_runs: runs })
        }
        if ((match = route.match(/\/actions\/runs\/(\d+)\/jobs/))) {
            return jsonResponse(200, { total_count: jobs.length, jobs: jobs.filter((job) => job.run_id === Number(match[1])) })
        }
        if ((match = route.match(/\/actions\/jobs\/(\d+)\/logs$/))) {
            const text = logs[match[1]]
            if (text === undefined) return jsonResponse(410, { message: 'Gone' })
            return { ok: true, status: 200, statusText: 'OK', text: async () => text }
        }
        return jsonResponse(404, { message: 'Not Found' })
    }
    return { client: createGitHubClient({ token: TOKEN, fetch }), requests }
}

// A clock that advances only when slept.
function fakeClock() {
    let time = 0
    const sleeps = []
    return {
        sleeps,
        now: () => time,
        sleep: async (ms) => {
            sleeps.push(ms)
            time += ms
        },
    }
}

const recorder = () => {
    const lines = []
    return { lines, log: (line) => lines.push(line) }
}

const step = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion })

describe('waitForRun', () => {
    it('polls until the run for the pushed sha completes, announcing its address once', async () => {
        const github = fakeActions({
            polls: [[], [run(7, { status: 'queued', conclusion: null })], [run(7, { status: 'in_progress', conclusion: null })], [run(7)]],
        })
        const clock = fakeClock()
        const { lines, log } = recorder()
        const result = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log, ...clock })
        expect(result.id).toBe(7)
        expect(clock.sleeps).toEqual([RUN_POLL_MS, RUN_POLL_MS, RUN_POLL_MS])
        expect(lines).toEqual([`Deploying: https://github.com/${REPOSITORY}/actions/runs/7`])
        expect(github.requests[0]).toBe(`GET /repos/${REPOSITORY}/actions/runs?head_sha=${SHA}&per_page=100`)
    })

    it('takes only the generated workflow\'s run for exactly that sha, never the newest run on the repository', async () => {
        const github = fakeActions({
            polls: [[
                run(9, { head_sha: OTHER_SHA, conclusion: 'failure' }),
                run(8, { path: '.github/workflows/test.yml', conclusion: 'failure' }),
                run(5, { conclusion: 'success' }),
            ]],
        })
        const result = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...fakeClock() })
        expect(result.id).toBe(5)
    })

    it('accepts the workflow path with the ref GitHub may append (deploy.yml@main)', async () => {
        const github = fakeActions({ polls: [[run(6, { path: `${WORKFLOW_PATH}@main` }), run(5, { path: '.github/workflows/test.yml@main' })]] })
        const result = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...fakeClock() })
        expect(result.id).toBe(6)
    })

    it('of several runs for the sha (a manual re-run), takes the newest', async () => {
        const github = fakeActions({ polls: [[run(3, { conclusion: 'failure' }), run(4)]] })
        const result = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...fakeClock() })
        expect(result.id).toBe(4)
    })

    it('times out with the run\'s address when it does not finish', async () => {
        const github = fakeActions({ polls: [[run(7, { status: 'in_progress', conclusion: null })]] })
        const clock = fakeClock()
        const error = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...clock }).catch((err) => err)
        expect(error).toBeInstanceOf(DeployError)
        expect(error.message).toBe(`The deploy run did not finish within 15 minutes. Follow it at https://github.com/${REPOSITORY}/actions/runs/7, then run nera publish again once it is done.`)
        expect(error.details.run).toBe(`https://github.com/${REPOSITORY}/actions/runs/7`)
        expect(clock.now()).toBe(RUN_TIMEOUT_MS)
    })

    it('times out with the Actions page when no run ever started', async () => {
        const github = fakeActions({ polls: [[]] })
        const error = await waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...fakeClock() }).catch((err) => err)
        expect(error.message).toContain('No deploy run started within 15 minutes')
        expect(error.details.run).toBe(`https://github.com/${REPOSITORY}/actions`)
    })
})

describe('waitForRun — transient errors', () => {
    const wait = (github, clock = fakeClock()) =>
        waitForRun({ client: github.client, repository: REPOSITORY, sha: SHA, log: () => {}, ...clock })

    it('retries up to TRANSIENT_RETRIES 5xx or network errors in a row at the poll interval, then resolves', async () => {
        // A good answer in between resets the count.
        const github = fakeActions({
            polls: [503, OFFLINE, [run(7, { status: 'in_progress', conclusion: null })], ...Array(TRANSIENT_RETRIES).fill(502), [run(7)]],
        })
        const clock = fakeClock()
        expect((await wait(github, clock)).id).toBe(7)
        expect(clock.sleeps).toEqual(Array(2 + 1 + TRANSIENT_RETRIES).fill(RUN_POLL_MS))
    })

    it('one more in a row: a DeployError with the run\'s address and GitHub\'s message', async () => {
        const github = fakeActions({ polls: [[run(7, { status: 'queued', conclusion: null })], 503] })
        const error = await wait(github).catch((err) => err)
        expect(error).toBeInstanceOf(DeployError)
        expect(error.message).toBe(`Following the deploy failed: GitHub answered 503 to GET /repos/${REPOSITORY}/actions/runs?head_sha=${SHA}&per_page=100: Status 503. Follow it at https://github.com/${REPOSITORY}/actions/runs/7, then run nera publish again once it is done.`)
        expect(error.details).toEqual({ run: `https://github.com/${REPOSITORY}/actions/runs/7`, hint: 'Run nera publish again once the run is done.' })
        expect(github.requests).toHaveLength(1 + TRANSIENT_RETRIES + 1)
    })

    it('before any run is seen, the DeployError points at the Actions page', async () => {
        const github = fakeActions({ polls: [OFFLINE] })
        const error = await wait(github).catch((err) => err)
        expect(error.message).toContain('Could not reach GitHub: fetch failed')
        expect(error.details.run).toBe(`https://github.com/${REPOSITORY}/actions`)
    })

    it.each([401, 403, 404, 422])('a %i is not retried: GitHub\'s error is rethrown at once', async (status) => {
        const github = fakeActions({ polls: [status] })
        const clock = fakeClock()
        const error = await wait(github, clock).catch((err) => err)
        expect(error).toBeInstanceOf(GitHubError)
        expect(error.status).toBe(status)
        expect(github.requests).toHaveLength(1)
        expect(clock.sleeps).toEqual([])
    })

    it('the deadline still ends the wait while errors and good answers alternate', async () => {
        const github = fakeActions({ polls: Array.from({ length: RUN_TIMEOUT_MS / RUN_POLL_MS + 1 }, (_, i) => (i % 2 ? 503 : [])) })
        const clock = fakeClock()
        const error = await wait(github, clock).catch((err) => err)
        expect(error.message).toContain('No deploy run started within 15 minutes')
        expect(clock.now()).toBe(RUN_TIMEOUT_MS)
    })
})

describe('logExcerpt', () => {
    it('ends at the first error line, drops timestamps and turns markers into words', () => {
        const log = [
            '2026-10-26T10:00:00.0000000Z ##[group]Run npm run build',
            '2026-10-26T10:00:00.1000000Z npm run build',
            '2026-10-26T10:00:00.2000000Z ##[endgroup]',
            '2026-10-26T10:00:01.0000000Z Error: layout "post.pug" not found',
            '2026-10-26T10:00:01.1000000Z ##[error]Process completed with exit code 1.',
            '2026-10-26T10:00:02.0000000Z Post job cleanup.',
            '',
        ].join('\n')
        expect(logExcerpt(log)).toBe([
            'Run npm run build',
            'npm run build',
            'Error: layout "post.pug" not found',
            'Error: Process completed with exit code 1.',
        ].join('\n'))
    })

    it('keeps at most EXCERPT_LINES lines; without an error line, the end of the log', () => {
        const lines = Array.from({ length: 50 }, (_, i) => `line ${i}`)
        const excerpt = logExcerpt(`${lines.join('\r\n')}\r\n\r\n`).split('\n')
        expect(excerpt).toHaveLength(EXCERPT_LINES)
        expect(excerpt.at(-1)).toBe('line 49')
        expect(logExcerpt('')).toBe('')
    })
})

describe('watchDeploy', () => {
    const options = (github) => ({ client: github.client, repository: REPOSITORY, sha: SHA, adapter, log: () => {}, ...fakeClock() })

    it('resolves the run when it succeeded, without asking for jobs or logs', async () => {
        const github = fakeActions({ polls: [[run(7)]] })
        expect((await watchDeploy(options(github))).id).toBe(7)
        expect(github.requests.filter((route) => route.includes('/jobs'))).toEqual([])
    })

    it('a failed build step: the job, the step, a log excerpt and the hint for that step', async () => {
        const github = fakeActions({
            polls: [[run(7, { conclusion: 'failure' })]],
            jobs: [
                { id: 70, run_id: 7, name: 'build', conclusion: 'failure', steps: [step('Set up job'), step(BUILD_STEPS.install), step(BUILD_STEPS.render, 'failure'), step(BUILD_STEPS.upload, 'skipped')] },
                { id: 71, run_id: 7, name: 'deploy', conclusion: 'skipped', steps: [] },
            ],
            logs: { 70: '2026-10-26T10:00:01.0000000Z Error: layout "post.pug" not found\n2026-10-26T10:00:01.1000000Z ##[error]Process completed with exit code 1.\n' },
        })
        const error = await watchDeploy(options(github)).catch((err) => err)
        expect(error).toBeInstanceOf(DeployError)
        expect(error.details).toEqual({
            run: `https://github.com/${REPOSITORY}/actions/runs/7`,
            job: 'build',
            step: BUILD_STEPS.render,
            excerpt: 'Error: layout "post.pug" not found\nError: Process completed with exit code 1.',
            hint: 'The site did not build. Run nera build in the site folder to see the same error, fix it, then run nera publish again.',
        })
        expect(error.message).toBe([
            `The deploy failed at the step "Render site" of the job "build": https://github.com/${REPOSITORY}/actions/runs/7`,
            '',
            'Error: layout "post.pug" not found',
            'Error: Process completed with exit code 1.',
            '',
            error.details.hint,
        ].join('\n'))
    })

    it('a failed deploy job names the host; an unreadable log leaves the excerpt out', async () => {
        const github = fakeActions({
            polls: [[run(7, { conclusion: 'failure' })]],
            jobs: [
                { id: 70, run_id: 7, name: 'build', conclusion: 'success', steps: [step(BUILD_STEPS.render)] },
                { id: 71, run_id: 7, name: 'deploy', conclusion: 'failure', steps: [step('Deploy', 'failure')] },
            ],
        })
        const error = await watchDeploy(options(github)).catch((err) => err)
        expect(error.details.job).toBe('deploy')
        expect(error.details.step).toBe('Deploy')
        expect(error.details).not.toHaveProperty('excerpt')
        expect(error.details.hint).toBe(`The deploy to Fake Host failed. The full log is at https://github.com/${REPOSITORY}/actions/runs/7; run nera publish again once the cause is fixed.`)
        expect(github.requests).toContain(`GET /repos/${REPOSITORY}/actions/jobs/71/logs`)
    })

    it('a cancelled run without jobs says so and points at the run', async () => {
        const github = fakeActions({ polls: [[run(7, { conclusion: 'cancelled' })]] })
        const error = await watchDeploy(options(github)).catch((err) => err)
        expect(error.message).toBe(`The deploy was cancelled: https://github.com/${REPOSITORY}/actions/runs/7\nThe full log is at https://github.com/${REPOSITORY}/actions/runs/7. If nera publish fails the same way again, the cause is in that log.`)
        expect(error.details).toEqual({ run: `https://github.com/${REPOSITORY}/actions/runs/7`, hint: expect.any(String) })
    })

    it('describeFailure asks for the jobs of the failed run only', async () => {
        const github = fakeActions({ jobs: [{ id: 80, run_id: 8, name: 'build', conclusion: 'failure', steps: [] }] })
        const details = await describeFailure({ client: github.client, repository: REPOSITORY, run: run(7, { conclusion: 'failure' }), adapter })
        expect(details).not.toHaveProperty('job')
        expect(github.requests).toEqual([`GET /repos/${REPOSITORY}/actions/runs/7/jobs?per_page=100`])
    })
})
