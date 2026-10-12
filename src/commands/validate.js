import { validateSite, hasErrors, formatResults } from '@nera-static/validate'
import { runJson } from '../json-output.js'

// Validate the current site and print the results. Returns the process exit code
// (1 on any error, 0 otherwise) rather than calling process.exit itself, so it
// stays testable; the bin turns the return value into the exit. With `json`, it
// prints one `{ ok, results }` object instead (see json-output.js).
export function runValidate({ cwd = process.cwd(), json = false } = {}) {
    if (json) return runJson(() => validateSite({ cwd }))
    const results = validateSite({ cwd })
    console.log(formatResults(results))
    return hasErrors(results) ? 1 : 0
}
