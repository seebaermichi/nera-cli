import { validateSite, hasErrors, formatResults } from '@nera-static/validate'

// Validate the current site and print the results. Returns the process exit code
// (1 on any error, 0 otherwise) rather than calling process.exit itself, so it
// stays testable; the bin turns the return value into the exit.
export function runValidate({ cwd = process.cwd() } = {}) {
    const results = validateSite({ cwd })
    console.log(formatResults(results))
    return hasErrors(results) ? 1 : 0
}
