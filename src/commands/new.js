import {
    assertNpmCanInstall,
    probeNpmVersion,
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

async function defaultBlogPrompt(options) {
    const { runBlogPicker } = await import('../prompt.js')
    return runBlogPicker(options)
}

// Fail on a bad flag before asking anything. An npm that would crash on
// install is refused before the questions too; scaffoldProject checks again
// for every caller.
async function checkBeforeAsking(projectName, options, install, npmVersion) {
    if (!isCurrentDir(projectName)) validateProjectName(projectName)
    if (options.theme !== undefined) validateThemeSpec(options.theme)
    if (options.name !== undefined) validateSiteName(options.name)
    if (options.lang !== undefined) validateLang(options.lang)
    if (install) assertNpmCanInstall(await npmVersion())
}

// `prompt`, `blogPrompt`, `scaffold`, `npmVersion` and the streams are
// injectable for tests.
export async function runNew(args = [], {
    stdin = process.stdin,
    stdout = process.stdout,
    prompt = defaultPrompt,
    blogPrompt = defaultBlogPrompt,
    scaffold = scaffoldProject,
    npmVersion = probeNpmVersion,
} = {}) {
    const { projectName, yes, install, ...rest } = parseNewArgs(args)
    const options = Object.fromEntries(
        Object.entries(rest).filter(([, v]) => v !== undefined),
    )

    const { shouldPrompt, shouldAskBlog } = await import('../prompt.js')
    if (shouldPrompt({ yes, starter: options.starter, stdin, stdout })) {
        await checkBeforeAsking(projectName, options, install, npmVersion)
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
    } else if (
        // With --theme, scaffoldProject refuses the starter anyway: no question.
        options.theme === undefined &&
        shouldAskBlog({ yes, starter: options.starter, stdin, stdout })
    ) {
        await checkBeforeAsking(projectName, options, install, npmVersion)
        options.starter = await blogPrompt({ input: stdin, output: stdout })
    }

    return scaffold(projectName, { ...options, install })
}
