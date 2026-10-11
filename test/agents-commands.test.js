import { describe, it, expect, beforeAll } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { templateDir } from '../src/scaffold.js'

// Resolved from this file, so the test passes whatever vitest's cwd is.
const CLI = fileURLToPath(new URL('../bin/nera.js', import.meta.url))

// `nera <command>`, plus a `--flag` written right after it. Case-sensitive, so
// "Nera" in prose does not match; the lookbehind skips `nera.js.org`,
// `npx nera-navigation` and similar, and the required space after `nera`
// skips `pkill -f nera`.
const COMMAND_PATTERN = /(?<![\w.-])nera ([a-z][a-z-]*)(?: (--[a-z][a-z-]*))?/g

/**
 * Every `nera <command>` an instructions text names, each with the flag
 * written right after it (or `null`).
 */
function extractCommands(text) {
    return [...text.matchAll(COMMAND_PATTERN)].map(([, command, flag]) => ({
        command,
        flag: flag ?? null,
    }))
}

/**
 * The commands (and flags) from `extractCommands` the usage text lacks.
 * A command must be a usage line (`  nera <command>`); its flag must appear
 * on one of that command's usage lines.
 */
function findMissing(commands, usage) {
    const missing = []
    for (const { command, flag } of commands) {
        const lines = usage.match(new RegExp(`^ {2}nera ${command}(?![\\w-]).*$`, 'gm')) ?? []
        if (lines.length === 0) {
            missing.push(`nera ${command}`)
        } else if (flag && !lines.some((line) => new RegExp(`${flag}(?![\\w-])`).test(line))) {
            missing.push(`nera ${command} ${flag}`)
        }
    }
    return [...new Set(missing)]
}

// `npm run <script>`. A script name may contain `:`, `.` and `-` (`build:css`)
// but ends on a word character, so a trailing period, colon or backtick is
// not part of it.
const SCRIPT_PATTERN = /(?<![\w.-])npm run (\w(?:[\w:.-]*\w)?)/g

/**
 * Every script name an instructions text runs with `npm run <script>`.
 */
function extractScripts(text) {
    return [...text.matchAll(SCRIPT_PATTERN)].map(([, script]) => script)
}

/**
 * The `npm run <script>` names from `extractScripts` that are not keys of
 * a package.json `scripts` object.
 */
function findMissingScripts(scripts, packageScripts) {
    const missing = scripts.filter((script) => !Object.hasOwn(packageScripts, script))
    return [...new Set(missing)].map((script) => `npm run ${script}`)
}

let usage
let agents
let templateScripts

beforeAll(async () => {
    // Run outside the repo so no `.env` or site config influences the output.
    usage = execFileSync(process.execPath, [CLI], {
        cwd: os.tmpdir(),
        encoding: 'utf-8',
    })
    agents = await fs.readFile(path.join(templateDir(), 'AGENTS.md'), 'utf-8')
    const pkg = JSON.parse(await fs.readFile(path.join(templateDir(), 'package.json'), 'utf-8'))
    templateScripts = pkg.scripts ?? {}
})

describe('extractCommands', () => {
    it('finds nera commands and the flag right after them', () => {
        expect(extractCommands('Run `npx nera build --check`, then `nera update` keeps it')).toEqual([
            { command: 'build', flag: '--check' },
            { command: 'update', flag: null },
        ])
    })

    it('ignores the docs domain, plugin binaries, process names and prose', () => {
        const text = 'See nera.js.org, run `npx nera-navigation`, never `pkill -f nera`. Nera loads it.'
        expect(extractCommands(text)).toEqual([])
    })

    it('finds the commands the template AGENTS.md names', () => {
        const names = extractCommands(agents).map(({ command }) => command)
        expect(names).toEqual(expect.arrayContaining(['validate', 'build', 'check', 'update']))
    })
})

describe('findMissing', () => {
    it('reports a command the usage lacks', () => {
        const fixture = 'Deploy with `npx nera publish`, then run `npx nera validate`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera publish'])
    })

    it('reports a flag the usage lacks', () => {
        const fixture = 'Run `npx nera build --watch`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera build --watch'])
    })

    it('reports a flag listed only under another command', () => {
        const fixture = 'Run `npx nera build --migrate`, then `npx nera update --migrate`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera build --migrate'])
    })
})

describe('extractScripts', () => {
    it('finds scripts in backticks and prose and stops at the name', () => {
        const text = '- `npm run dev` — serve. Then npm run build. Or npm run build:css, and `npm run lint`'
        expect(extractScripts(text)).toEqual(['dev', 'build', 'build:css', 'lint'])
    })

    it('ignores npm commands that are not npm run', () => {
        expect(extractScripts('Use `npm install` and `npm test`; see snpm run x.')).toEqual([])
    })

    it('finds the scripts the template AGENTS.md names', () => {
        expect(extractScripts(agents)).toEqual(expect.arrayContaining(['dev', 'build']))
    })
})

describe('findMissingScripts', () => {
    it('reports a script package.json lacks', () => {
        const fixture = 'Run `npm run build`, then `npm run deploy`.'
        expect(findMissingScripts(extractScripts(fixture), templateScripts)).toEqual(['npm run deploy'])
    })

    it('does not treat inherited object keys as scripts', () => {
        expect(findMissingScripts(['toString'], {})).toEqual(['npm run toString'])
    })
})

describe('template AGENTS.md', () => {
    it('names only commands and flags the CLI usage lists', () => {
        expect(findMissing(extractCommands(agents), usage)).toEqual([])
    })

    it('names only npm scripts the template package.json defines', () => {
        expect(findMissingScripts(extractScripts(agents), templateScripts)).toEqual([])
    })
})
