import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import fssync from 'node:fs'
import os from 'node:os'
import { npmCommand, runNpm, runNpmAsync, spawnChild } from '../src/npm.js'

describe('npmCommand', () => {
    it('leaves npm and its arguments untouched on posix, without a shell', () => {
        const args = ['install', '@nera-static/theme-blog@^1.0.0', '--save']
        for (const platform of ['linux', 'darwin']) {
            expect(npmCommand(args, platform)).toEqual({ file: 'npm', args, shell: false })
        }
    })

    it('runs npm.cmd through cmd.exe on win32, every argument quoted once', () => {
        expect(
            npmCommand(['install', 'a&b', 'C:\\Temp dir\\x.tgz', ''], 'win32'),
        ).toEqual({
            file: 'npm.cmd',
            args: ['"install"', '"a&b"', '"C:\\Temp dir\\x.tgz"', '""'],
            shell: true,
        })
    })

    it('doubles trailing backslashes on win32, so the closing quote stays a quote', () => {
        expect(npmCommand(['C:\\out\\'], 'win32').args).toEqual(['"C:\\out\\\\"'])
    })

    it.each([
        ['a double quote', 'a"b'],
        ['a percent sign', '%PATH%'],
        ['a newline', 'a\nb'],
        ['a carriage return', 'a\rb'],
        ['a NUL', 'a\0b'],
    ])('refuses an argument with %s on win32', (_, arg) => {
        expect(() => npmCommand(['install', arg], 'win32')).toThrow(
            /cannot pass .* to npm on Windows/,
        )
    })

    it('passes those characters on posix, where no shell reads them', () => {
        expect(npmCommand(['a"b', '%PATH%'], 'linux').args).toEqual(['a"b', '%PATH%'])
    })
})

describe('runNpm', () => {
    it('hands posix calls to exec with the options object unchanged', () => {
        const exec = vi.fn(() => 'ok')
        const options = { cwd: '/site', stdio: 'inherit', encoding: 'utf-8' }
        expect(runNpm(['install'], options, { platform: 'linux', exec })).toBe('ok')
        expect(exec).toHaveBeenCalledWith('npm', ['install'], options)
        expect(exec.mock.calls[0][2]).toBe(options)
    })

    it('adds shell: true on win32 and keeps every other option', () => {
        const exec = vi.fn()
        const options = { cwd: 'C:\\site', stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' }
        runNpm(['--version'], options, { platform: 'win32', exec })
        expect(exec).toHaveBeenCalledWith('npm.cmd', ['"--version"'], {
            ...options,
            shell: true,
        })
        expect(options).not.toHaveProperty('shell')
    })

    it('throws before exec on an argument cmd.exe cannot carry', () => {
        const exec = vi.fn()
        expect(() => runNpm(['%x%'], {}, { platform: 'win32', exec })).toThrow()
        expect(exec).not.toHaveBeenCalled()
    })

    it('really runs npm, in a folder whose name has a space and an ampersand', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera npm & '))
        try {
            const out = runNpm(['--version'], {
                cwd: dir,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            expect(String(out).trim()).toMatch(/^\d+\.\d+\.\d+/)
        } finally {
            await fs.rm(dir, { recursive: true, force: true })
        }
    }, 30000)
})

// Real children: node itself (process.execPath), so no npm or shell is needed.
const node = (code) => [process.execPath, ['-e', code]]

const waitFor = async (check, ms = 10000) => {
    const end = Date.now() + ms
    while (!check()) {
        if (Date.now() > end) throw new Error('timed out waiting')
        await new Promise((r) => setTimeout(r, 20))
    }
}

describe('spawnChild', () => {
    it('resolves to the child\'s stdout', async () => {
        await expect(spawnChild(...node('process.stdout.write("hello")'))).resolves.toBe('hello')
    })

    it('rejects a non-zero exit with its code, stdout and stderr', async () => {
        const err = await spawnChild(
            ...node('process.stdout.write("out"); process.stderr.write("npm error boom"); process.exit(3)'),
        ).catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err).toMatchObject({ code: 3, stdout: 'out', stderr: 'npm error boom' })
        expect(err.message).toMatch(/\(exit code 3\)\nnpm error boom$/)
    })

    it('rejects once with spawn\'s error when the command does not exist', async () => {
        await expect(spawnChild('nera-no-such-command-xyz', [])).rejects.toMatchObject({
            code: 'ENOENT',
        })
    })

    it('hands env and cwd to the child', async () => {
        const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nera-spawn-')))
        try {
            const out = await spawnChild(
                ...node('process.stdout.write(process.env.NERA_SPAWN_TEST + " " + process.cwd())'),
                { cwd: dir, env: { ...process.env, NERA_SPAWN_TEST: 'seen' } },
            )
            expect(out).toBe(`seen ${dir}`)
        } finally {
            await fs.rm(dir, { recursive: true, force: true })
        }
    })

    it('settles with stdio: inherit, resolving to an empty string', async () => {
        await expect(spawnChild(...node(''), { stdio: 'inherit' })).resolves.toBe('')
    })

    it('kills a running child on abort and rejects with the abort reason once it is gone', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-spawn-'))
        const pidFile = path.join(dir, 'pid')
        try {
            const controller = new AbortController()
            const running = spawnChild(
                ...node(
                    `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); ` +
                        'setInterval(() => {}, 1000)',
                ),
                { signal: controller.signal },
            )
            await waitFor(() => fssync.existsSync(pidFile) && fssync.readFileSync(pidFile, 'utf-8'))
            const pid = Number(fssync.readFileSync(pidFile, 'utf-8'))
            const reason = new Error('stop')
            controller.abort(reason)
            await expect(running).rejects.toBe(reason)
            expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
        } finally {
            await fs.rm(dir, { recursive: true, force: true })
        }
    }, 15000)

    it('never starts the child when the signal is already aborted', async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-spawn-'))
        const marker = path.join(dir, 'ran')
        try {
            const signal = AbortSignal.abort()
            const err = await spawnChild(
                ...node(`require("fs").writeFileSync(${JSON.stringify(marker)}, "")`),
                { signal },
            ).catch((e) => e)
            expect(err).toBe(signal.reason)
            expect(err.name).toBe('AbortError')
            expect(fssync.existsSync(marker)).toBe(false)
        } finally {
            await fs.rm(dir, { recursive: true, force: true })
        }
    })
})

describe('runNpmAsync', () => {
    it('hands posix calls to spawn with the options object unchanged', async () => {
        const spawn = vi.fn(async () => 'ok')
        const options = { cwd: '/site', env: { PATH: '/shim' }, stdio: 'inherit' }
        await expect(runNpmAsync(['install'], options, { platform: 'linux', spawn })).resolves.toBe('ok')
        expect(spawn).toHaveBeenCalledWith('npm', ['install'], options)
        expect(spawn.mock.calls[0][2]).toBe(options)
    })

    it('adds shell: true on win32 and keeps every other option', async () => {
        const spawn = vi.fn(async () => '')
        const signal = new AbortController().signal
        const options = { cwd: 'C:\\site', env: { Path: 'C:\\shim' }, signal }
        await runNpmAsync(['--version'], options, { platform: 'win32', spawn })
        expect(spawn).toHaveBeenCalledWith('npm.cmd', ['"--version"'], { ...options, shell: true })
        expect(options).not.toHaveProperty('shell')
    })

    it('throws before spawning on an argument cmd.exe cannot carry', () => {
        const spawn = vi.fn()
        expect(() => runNpmAsync(['%x%'], {}, { platform: 'win32', spawn })).toThrow()
        expect(spawn).not.toHaveBeenCalled()
    })

    it('really runs npm with the given env', async () => {
        const out = await runNpmAsync(['--version'], { env: { ...process.env } })
        expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/)
    }, 30000)
})
