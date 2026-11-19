import { execFileSync, spawn } from 'child_process'

// Characters cmd.exe cannot carry inside a double-quoted argument: a quote
// ends it, `%` expands a variable even inside quotes, and a line break or NUL
// ends the command line.
const CMD_UNSAFE = /["%\r\n\0]/

// The stdio of a child (npm, a plugin's template bin) whose parent's stdout
// is a protocol channel or a --json object: stdin closed, so it never waits
// for an answer, and its stdout and stderr both on fd 2. Rerouting this
// process's writes (json-output.js) does not reach a child, so 'inherit'
// would let it write straight into stdout.
export const STDIO_OFF_STDOUT = Object.freeze(['ignore', 2, 2])

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

// Run one child without blocking the event loop: `spawn`'s own `signal` kills
// it on abort. Resolves to its stdout (a string; '' when stdout is not piped).
// A non-zero exit rejects with an error carrying `code`, `stdout` and `stderr`,
// like execFileSync's; a spawn failure (ENOENT, …) rejects with spawn's error.
// An abort, also one before the start, rejects with `signal.reason` once the
// child has exited, so nothing it writes outlives the promise. `env` defaults
// to process.env; `shell` is for npm.cmd on win32 only (see npmCommand).
export function spawnChild(
    file,
    args,
    { cwd, env = process.env, stdio = 'pipe', signal, shell = false } = {}
) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason)
            return
        }
        let settled = false
        const settle = (fn, value) => {
            if (settled) return
            settled = true
            fn(value)
        }
        let child
        try {
            child = spawn(file, args, { cwd, env, stdio, shell, signal, windowsHide: true })
        } catch (err) {
            settle(reject, err)
            return
        }
        let stdout = ''
        let stderr = ''
        child.stdout?.setEncoding('utf-8').on('data', (chunk) => (stdout += chunk))
        child.stderr?.setEncoding('utf-8').on('data', (chunk) => (stderr += chunk))
        // On abort spawn emits an AbortError here; wait for `exit` instead,
        // which a grandchild holding the pipes open cannot delay.
        child.on('error', (err) => {
            if (!signal?.aborted) settle(reject, err)
        })
        child.on('exit', () => {
            if (signal?.aborted) settle(reject, signal.reason)
        })
        child.on('close', (code, killedBy) => {
            if (signal?.aborted) return settle(reject, signal.reason)
            if (code === 0) return settle(resolve, stdout)
            const err = new Error(
                `Command failed: ${[file, ...args].join(' ')}` +
                    `${killedBy ? ` (killed by ${killedBy})` : ` (exit code ${code})`}` +
                    `${stderr ? `\n${stderr}` : ''}`
            )
            Object.assign(err, { code, signal: killedBy, stdout, stderr })
            settle(reject, err)
        })
    })
}

// runNpm without blocking: npm through npmCommand (npm.cmd on win32) and
// spawnChild, with spawnChild's options (cwd, env, stdio, signal) and result.
// `platform` and `spawn` are injectable for tests.
export function runNpmAsync(
    args,
    options = {},
    { platform = process.platform, spawn: run = spawnChild } = {}
) {
    const command = npmCommand(args, platform)
    return run(
        command.file,
        command.args,
        command.shell ? { ...options, shell: true } : options
    )
}
