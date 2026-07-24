import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import {
    scaffoldProject,
    validateProjectName,
    templateDir,
} from '../src/scaffold.js'

let workdir

beforeEach(async () => {
    workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-scaffold-'))
})

afterEach(async () => {
    await fs.rm(workdir, { recursive: true, force: true })
})

describe('validateProjectName', () => {
    it('accepts a normal name', () => {
        expect(validateProjectName('my-site')).toBe('my-site')
    })

    it('rejects empty, traversal and shell-unsafe names', () => {
        expect(() => validateProjectName('')).toThrow()
        expect(() => validateProjectName('../evil')).toThrow()
        expect(() => validateProjectName('.hidden')).toThrow()
        expect(() => validateProjectName('a b')).toThrow()
    })
})

describe('scaffoldProject', () => {
    it('creates a thin site from the template without installing', async () => {
        const target = await scaffoldProject('my-site', {
            cwd: workdir,
            install: false,
        })

        expect(target).toBe(path.join(workdir, 'my-site'))
        // Core structure copied.
        for (const rel of [
            'package.json',
            'config/app.yaml',
            'pages/index.md',
            'theme/views/layouts/layout.pug',
            'theme/views/pages/default.pug',
        ]) {
            expect(fssync.existsSync(path.join(target, rel))).toBe(true)
        }
    })

    it('renames _gitignore to .gitignore and never ships _gitignore', async () => {
        const target = await scaffoldProject('g', { cwd: workdir, install: false })
        expect(fssync.existsSync(path.join(target, '.gitignore'))).toBe(true)
        expect(fssync.existsSync(path.join(target, '_gitignore'))).toBe(false)
    })

    it('personalizes package.json: one dependency, named after the project', async () => {
        const target = await scaffoldProject('acme', { cwd: workdir, install: false })
        const pkg = JSON.parse(
            await fs.readFile(path.join(target, 'package.json'), 'utf-8')
        )
        expect(pkg.name).toBe('acme')
        expect(Object.keys(pkg.dependencies)).toEqual(['@nera-static/nera'])
        expect(pkg.scripts).toMatchObject({
            dev: 'nera dev',
            build: 'nera build',
            serve: 'nera serve',
        })
    })

    it('refuses to overwrite an existing directory', async () => {
        await scaffoldProject('dup', { cwd: workdir, install: false })
        await expect(
            scaffoldProject('dup', { cwd: workdir, install: false })
        ).rejects.toThrow(/already exists/)
    })

    it('ships a _gitignore (not .gitignore) in the template so npm keeps it', () => {
        // npm strips a literal .gitignore from tarballs; the template must carry
        // the underscore form for scaffolding to reproduce it.
        expect(fssync.existsSync(path.join(templateDir(), '_gitignore'))).toBe(true)
        expect(fssync.existsSync(path.join(templateDir(), '.gitignore'))).toBe(false)
    })
})
