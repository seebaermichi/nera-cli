import { hasErrors } from '@nera-static/validate'

// `--json` mode, shared by `nera validate`, `nera check`, `nera build` and
// `nera publish`: stdout holds exactly one JSON object and nothing else, so an
// agent can parse it whole. While `body` runs, console.log/info/debug and raw
// stdout writes (the engine's build log, plugin output) go to stderr; they are
// restored afterwards. `body` returns its result, directly or as a promise;
// `envelope` turns that result, or the error `body` threw, into the object.
// The error is reported, not rethrown. Returns the exit code, the same one text
// mode ends with: 0 when the object's `ok` is true, 1 otherwise. A sync body
// keeps the call sync.
export function runJson(body, envelope = VALIDATOR_ENVELOPE) {
    const restore = routeLogsToStderr()
    const finish = (value) => {
        restore()
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
        return value.ok ? 0 : 1
    }

    let pending
    try {
        pending = body()
    } catch (error) {
        return finish(envelope.failure(error))
    }
    if (typeof pending?.then === 'function') {
        return pending.then(
            (result) => finish(envelope.success(result)),
            (error) => finish(envelope.failure(error))
        )
    }
    return finish(envelope.success(pending))
}

// The validator commands' object: `{ ok, results }` with the validator's
// results, or `{ ok: false, error, results: [] }` when the body throws.
export const VALIDATOR_ENVELOPE = {
    success: (results) => ({ ok: !hasErrors(results), results }),
    failure: (error) => ({ ok: false, error: error.message, results: [] }),
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
