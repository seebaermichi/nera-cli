import {
    scaffoldProject,
    isCurrentDir,
    validateProjectName,
    validateThemeSpec,
    validateSiteName,
    validateLang,
} from '../scaffold.js'
import { validateStarterSpec } from '../starter.js'

// Options that take a value, as `--opt <value>` or `--opt=<value>`.
const VALUE_OPTIONS = { '--theme': 'theme', '--starter': 'starter', '--name': 'name', '--lang': 'lang' }

// `nera new <name> [--starter <spec>] [--theme <spec>] [--name <text>]
// [--lang <code>] [--yes] [--no-install]`
export function parseNewArgs(args = []) {
    let projectName
    const values = {}
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        const eq = arg.indexOf('=')
        const flag = eq === -1 ? arg : arg.slice(0, eq)
        if (Object.hasOwn(VALUE_OPTIONS, flag)) {
            values[VALUE_OPTIONS[flag]] = eq === -1 ? (args[++i] ?? '') : arg.slice(eq + 1)
        } else if (!arg.startsWith('-') && projectName === undefined) {
            projectName = arg
        }
    }
    return {
        projectName,
        ...values,
        yes: args.includes('--yes'),
        install: !args.includes('--no-install'),
    }
}

// Lazily loaded: the picker and the registry lookup are only needed on a
// terminal.
async function defaultPrompt(options) {
    const [{ runPicker }, { listStarters }] = await Promise.all([
        import('../prompt.js'),
        import('../starter.js'),
    ])
    return runPicker({ ...options, listStarters, validateSiteName, validateLang })
}

// `prompt`, `scaffold` and the streams are injectable for tests.
export async function runNew(args = [], {
    stdin = process.stdin,
    stdout = process.stdout,
    prompt = defaultPrompt,
    scaffold = scaffoldProject,
} = {}) {
    const { projectName, yes, install, ...rest } = parseNewArgs(args)
    const options = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined)
    )

    const { shouldPrompt } = await import('../prompt.js')
    if (shouldPrompt({ yes, starter: options.starter, stdin, stdout })) {
        // Fail on a bad flag before asking anything.
        if (!isCurrentDir(projectName)) validateProjectName(projectName)
        if (options.theme !== undefined) validateThemeSpec(options.theme)
        if (options.name !== undefined) validateSiteName(options.name)
        if (options.lang !== undefined) validateLang(options.lang)
        const answers = await prompt({
            input: stdin,
            output: stdout,
            // A theme rules out a starter, so that question is not asked.
            skip: {
                starter: options.theme !== undefined,
                name: options.name !== undefined,
                lang: options.lang !== undefined,
            },
        })
        Object.assign(options, answers)
        if (options.starter !== undefined) validateStarterSpec(options.starter)
    }

    return scaffold(projectName, { ...options, install })
}
