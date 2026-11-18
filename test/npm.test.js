import { describe, it, expect, vi } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { npmCommand, runNpm } from '../src/npm.js'

describe('npmCommand', () => {
    it('leaves npm and its arguments untouched on posix, without a shell', () => {
        const args = ['install', '@nera-static/theme-blog@^1.0.0', '--save']
        for (const platform of ['linux', 'darwin']) {
            expect(npmCommand(args, platform)).toEqual({ file: 'npm', args, shell: false })
        }
    })

    it('runs npm.cmd through cmd.exe on win32, every argument quoted once', () => {
        expect(
            npmCommand(['install', 'a&b', 'C:\\Temp dir\\x.tgz', ''], 'win32')
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
            /cannot pass .* to npm on Windows/
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
