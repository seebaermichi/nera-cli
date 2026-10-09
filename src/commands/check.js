import { validateOutput, hasErrors, formatOutputResults } from '@nera-static/validate'

// Check the built output in public/ — accessibility, privacy and legal-notice
// hints — and print the results. `nera validate` checks the sources; this checks
// what the build produced, so it needs a build first: validateOutput throws
// "run `nera build` first" when public/ is missing or holds no HTML. Returns the
// exit code (1 on any error, 0 otherwise), like runValidate.
export function runCheck({ cwd = process.cwd() } = {}) {
    const results = validateOutput({ cwd })
    console.log(formatOutputResults(results))
    return hasErrors(results) ? 1 : 0
}
