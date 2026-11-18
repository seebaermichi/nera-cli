import { execFileSync } from 'child_process'

// Characters cmd.exe cannot carry inside a double-quoted argument: a quote
// ends it, `%` expands a variable even inside quotes, and a line break or NUL
// ends the command line.
const CMD_UNSAFE = /["%\r\n\0]/

// Quote one argument for cmd.exe and the C runtime that parses it again for
// node.exe (npm.cmd hands `%*` on): inside quotes `&|<>^` and spaces are
// literal; backslashes before the closing quote are doubled, or the last one
// would escape it.
function quoteForCmd(arg) {
    if (CMD_UNSAFE.test(arg)) {
        throw new Error(
            `Nera cannot pass ${JSON.stringify(arg)} to npm on Windows: ` +
                'it contains a double quote, a percent sign, a line break or a NUL.'
        )
    }
    return `"${arg.replace(/(\\+)$/, '$1$1')}"`
}

// How to start npm on `platform`. On Windows npm is a batch file, npm.cmd,
// which execFileSync neither finds without the extension nor spawns without
// a shell (Node refuses since CVE-2024-27980); under `shell: true` Node joins
// the arguments with spaces, so each one is quoted here, exactly once.
// Everywhere else npm runs directly, and no shell ever sees an argument.
export function npmCommand(args, platform = process.platform) {
    if (platform !== 'win32') return { file: 'npm', args, shell: false }
    return { file: 'npm.cmd', args: args.map(quoteForCmd), shell: true }
}

// Run npm with execFileSync's `(file, args, options)` shape and return its
// result. `options` (cwd, stdio, encoding, …) pass through unchanged; win32
// only adds `shell: true`. `platform` and `exec` are injectable for tests.
export function runNpm(
    args,
    options = {},
    { platform = process.platform, exec = execFileSync } = {}
) {
    const command = npmCommand(args, platform)
    return exec(
        command.file,
        command.args,
        command.shell ? { ...options, shell: true } : options
    )
}
