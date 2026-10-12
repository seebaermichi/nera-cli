import { hasErrors } from '@nera-static/validate'

// `--json` mode, shared by `nera validate`, `nera check` and `nera build`: stdout
// holds exactly one JSON object and nothing else, so an agent can parse it whole.
// While `body` runs, console.log/info/debug and raw stdout writes (the engine's
// build log, plugin output) go to stderr; they are restored afterwards. `body`
// returns the validator's results, directly or as a promise. The object is
// `{ ok, results }`, or `{ ok: false, error, results: [] }` when `body` throws —
// the error is reported here, not rethrown. Returns the exit code, the same one
// text mode ends with: 1 on any error, 0 otherwise. A sync body keeps the call
// sync.
export function runJson(body) {
    const restore = routeLogsToStderr()
    const finish = (value) => {
        restore()
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
        return value.ok ? 0 : 1
    }
    const report = (results) => ({ ok: !hasErrors(results), results })
    const failure = (error) => ({ ok: false, error: error.message, results: [] })

    let pending
    try {
        pending = body()
    } catch (error) {
        return finish(failure(error))
    }
    if (typeof pending?.then === 'function') {
        return pending.then(
            (results) => finish(report(results)),
            (error) => finish(failure(error))
        )
    }
    return finish(report(pending))
}

// Point console.log/info/debug and process.stdout.write at stderr. Returns the
// function that puts the originals back.
function routeLogsToStderr() {
    const saved = {
        log: console.log,
        info: console.info,
        debug: console.debug,
        write: process.stdout.write,
    }
    const toStderr = (...args) => console.error(...args)
    console.log = toStderr
    console.info = toStderr
    console.debug = toStderr
    process.stdout.write = (...args) => process.stderr.write(...args)
    return () => {
        console.log = saved.log
        console.info = saved.info
        console.debug = saved.debug
        process.stdout.write = saved.write
    }
}
