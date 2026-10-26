import path from 'path'
import { GITHUB_WEB } from './github.js'
import { parseRepository } from './site-config.js'
import { BUILD_JOB_ID, BUILD_STEPS, WORKFLOW_FILE } from './workflow.js'

// Following the deploy after the push (ROADMAP-ai.md L6 step 5): the Actions
// run of the generated workflow for the pushed commit is polled until it
// completes; a failed run is reported with its failing job and step, an
// excerpt of that job's log and a hint at the fix. `client` is a github.js
// client acting with the user's token, so tests stub its fetch.

// How often and how long to wait for the run. A first deploy installs the
// site's dependencies and builds it, which takes a minute or two.
export const RUN_POLL_MS = 5_000
export const RUN_TIMEOUT_MS = 15 * 60_000

// The workflow's path as the Actions API reports it (`/`, on every OS).
export const WORKFLOW_PATH = WORKFLOW_FILE.split(path.sep).join('/')

// At most this many log lines in the excerpt.
export const EXCERPT_LINES = 20

const sleepFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// "2026-10-26T10:00:00.1234567Z " at the start of every line of a job log.
const LOG_TIMESTAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z ?/
const ERROR_MARKER = '##[error]'

// The hint for a failed step of the build job, by the step's name.
const BUILD_HINTS = {
    [BUILD_STEPS.install]: 'Installing the dependencies failed. Run npm install in the site folder so package-lock.json matches package.json, then run nera publish again.',
    [BUILD_STEPS.render]: 'The site did not build. Run nera build in the site folder to see the same error, fix it, then run nera publish again.',
    [BUILD_STEPS.upload]: 'The build wrote no public/ folder. Run nera build in the site folder and check that it writes public/, then run nera publish again.',
}

// A deploy run that did not succeed, or did not finish in time. `details`
// is what the `--json` object carries next to the message: `{ run, job?,
// step?, excerpt?, hint }`, `run` being the run's address on GitHub.
export class DeployError extends Error {
    constructor(message, details) {
        super(message)
        this.name = 'DeployError'
        this.details = details
    }
}

// The newest run of the generated workflow for exactly `sha`, or null. The
// `head_sha` filter narrows the list, and each run is checked again: another
// workflow, or a later push, must never be mistaken for this deploy.
// A run's `path` may carry the ref it ran from (`….yml@main`), so that
// suffix is ignored.
const workflowOf = (run) => String(run.path ?? '').split('@')[0]

async function findRun(client, { owner, name }, sha) {
    const data = await client.get(`/repos/${owner}/${name}/actions/runs?head_sha=${sha}&per_page=100`)
    const runs = (data?.workflow_runs ?? []).filter((run) => run.head_sha === sha && workflowOf(run) === WORKFLOW_PATH)
    return runs.reduce((newest, run) => (newest === null || run.id > newest.id ? run : newest), null)
}

// Wait for the deploy run of the commit `sha` in `repository` (`owner/name`)
// to complete, polling every RUN_POLL_MS. Resolves the completed run as
// GitHub lists it (`id`, `conclusion`, `html_url`, …). Throws a DeployError
// with the run's address (the repository's Actions page while no run has
// started) after RUN_TIMEOUT_MS.
export async function waitForRun({
    client,
    repository,
    sha,
    sleep = sleepFor,
    now = Date.now,
    log = (line) => console.log(line),
} = {}) {
    const repo = parseRepository(repository)
    const deadline = now() + RUN_TIMEOUT_MS
    let announced = null
    for (;;) {
        const run = await findRun(client, repo, sha)
        if (run && announced !== run.id) {
            log(`Deploying: ${run.html_url}`)
            announced = run.id
        }
        if (run?.status === 'completed') return run
        if (now() >= deadline) {
            const address = run?.html_url ?? `${GITHUB_WEB}/${repository}/actions`
            const what = run ? 'The deploy run did not finish' : 'No deploy run started'
            throw new DeployError(`${what} within ${RUN_TIMEOUT_MS / 60_000} minutes. Follow it at ${address}, then run nera publish again once it is done.`, {
                run: address,
                hint: 'Run nera publish again once the run is done.',
            })
        }
        await sleep(RUN_POLL_MS)
    }
}

// The last EXCERPT_LINES lines of a job log up to and including its first
// error line (the end of the log when it has none), without timestamps and
// with the Actions markers turned into words. '' for an empty log.
export function logExcerpt(text) {
    const lines = String(text).split(/\r?\n/).map((line) => line.replace(LOG_TIMESTAMP, ''))
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    const errorAt = lines.findIndex((line) => line.startsWith(ERROR_MARKER))
    const end = errorAt === -1 ? lines.length : errorAt + 1
    return lines
        .slice(Math.max(0, end - EXCERPT_LINES), end)
        .filter((line) => !line.startsWith('##[endgroup]'))
        .map((line) => line.replace(ERROR_MARKER, 'Error: ').replace('##[group]', ''))
        .join('\n')
}

// The fix hint for the failed `job` and `step` (names as the Actions API
// reports them; either may be undefined) of a run at `runUrl`.
function hintFor({ job, step, adapter, runUrl }) {
    if (job === BUILD_JOB_ID && BUILD_HINTS[step]) return BUILD_HINTS[step]
    if (job !== undefined && job !== BUILD_JOB_ID) {
        return `The deploy to ${adapter.label} failed. The full log is at ${runUrl}; run nera publish again once the cause is fixed.`
    }
    return `The full log is at ${runUrl}. If nera publish fails the same way again, the cause is in that log.`
}

// The failure report for the completed, unsuccessful `run`: its first failed
// job and that job's first failed step, the log excerpt and the hint. A log
// that cannot be read leaves the excerpt out rather than hiding the report.
export async function describeFailure({ client, repository, run, adapter }) {
    const { owner, name } = parseRepository(repository)
    const data = await client.get(`/repos/${owner}/${name}/actions/runs/${run.id}/jobs?per_page=100`)
    const failedJob = (data?.jobs ?? []).find((job) => job.conclusion !== 'success' && job.conclusion !== 'skipped')
    const failedStep = failedJob?.steps?.find((step) => step.conclusion === 'failure')
        ?? failedJob?.steps?.find((step) => step.conclusion !== 'success' && step.conclusion !== 'skipped')

    let excerpt = ''
    if (failedJob) {
        excerpt = await client.getText(`/repos/${owner}/${name}/actions/jobs/${failedJob.id}/logs`)
            .then(logExcerpt, () => '')
    }

    const details = {
        run: run.html_url,
        hint: hintFor({ job: failedJob?.name, step: failedStep?.name, adapter, runUrl: run.html_url }),
    }
    if (failedJob) details.job = failedJob.name
    if (failedStep) details.step = failedStep.name
    if (excerpt !== '') details.excerpt = excerpt
    return details
}

// The message for a failure report, in the order a reader needs it: what
// failed, where, the log, the fix.
export function failureMessage(conclusion, details) {
    const where = details.step ? ` at the step "${details.step}" of the job "${details.job}"` : details.job ? ` in the job "${details.job}"` : ''
    const lines = [`The deploy ${conclusion === 'cancelled' ? 'was cancelled' : 'failed'}${where}: ${details.run}`]
    if (details.excerpt) lines.push('', details.excerpt, '')
    lines.push(details.hint)
    return lines.join('\n')
}

// Wait for the deploy run of `sha` and resolve it when it succeeded; throw a
// DeployError carrying the failure report (describeFailure) otherwise.
// Takes the options of waitForRun plus `adapter`, whose label the deploy
// job's hint names.
export async function watchDeploy(options) {
    const run = await waitForRun(options)
    if (run.conclusion === 'success') return run
    const details = await describeFailure({ ...options, run })
    throw new DeployError(failureMessage(run.conclusion, details), details)
}
