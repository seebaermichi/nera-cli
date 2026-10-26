import { describe, it, expect, beforeAll } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { templateDir } from '../src/scaffold.js'
import { skillSourceDir } from '../src/skill.js'
import { BUNDLED_STARTERS } from '../src/starters.js'

// Resolved from this file, so the test passes whatever vitest's cwd is.
const CLI = fileURLToPath(new URL('../bin/nera.js', import.meta.url))

// `nera <command>`, plus the rest of its code span: everything up to the
// closing backtick, the end of the line or the next `nera <command>`, so a
// flag of a later command in the same span is not counted. Case-sensitive, so
// "Nera" in prose does not match; the lookbehind skips `nera.js.org`,
// `npx nera-navigation` and similar, and the required space after `nera`
// skips `pkill -f nera`.
const COMMAND_PATTERN = /(?<![\w.-])nera ([a-z][a-z-]*)((?:(?!(?<![\w.-])nera [a-z])[^`\n])*)/g
const FLAG_PATTERN = /(?<![\w-])--[a-z][a-z-]*/g

/**
 * Every `nera <command>` an instructions text names, each with the
 * `--flag`s written after it in the same code span (possibly none).
 */
function extractCommands(text) {
    return [...text.matchAll(COMMAND_PATTERN)].map(([, command, rest]) => ({
        command,
        flags: rest.match(FLAG_PATTERN) ?? [],
    }))
}

/**
 * The commands (and flags) from `extractCommands` the usage text lacks.
 * A command must be a usage line (`  nera <command>`); each of its flags must
 * appear on one of that command's usage lines.
 */
function findMissing(commands, usage) {
    const missing = []
    for (const { command, flags } of commands) {
        const lines = usage.match(new RegExp(`^ {2}nera ${command}(?![\\w-]).*$`, 'gm')) ?? []
        if (lines.length === 0) {
            missing.push(`nera ${command}`)
            continue
        }
        for (const flag of flags) {
            if (!lines.some((line) => new RegExp(`${flag}(?![\\w-])`).test(line))) {
                missing.push(`nera ${command} ${flag}`)
            }
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
let skillFiles

beforeAll(async () => {
    // Run outside the repo so no `.env` or site config influences the output.
    usage = execFileSync(process.execPath, [CLI], {
        cwd: os.tmpdir(),
        encoding: 'utf-8',
    })
    agents = await fs.readFile(path.join(templateDir(), 'AGENTS.md'), 'utf-8')
    const pkg = JSON.parse(await fs.readFile(path.join(templateDir(), 'package.json'), 'utf-8'))
    templateScripts = pkg.scripts ?? {}
    // Every Markdown file of the Nera skill, as [relative path, text].
    const entries = await fs.readdir(skillSourceDir(), { recursive: true, withFileTypes: true })
    skillFiles = await Promise.all(
        entries
            .filter((e) => e.isFile() && e.name.endsWith('.md'))
            .map(async (e) => {
                const file = path.join(e.parentPath, e.name)
                return [path.relative(skillSourceDir(), file), await fs.readFile(file, 'utf-8')]
            })
    )
})

describe('extractCommands', () => {
    it('finds nera commands and the flags after them', () => {
        expect(extractCommands('Run `npx nera build --check`, then `nera update` keeps it')).toEqual([
            { command: 'build', flags: ['--check'] },
            { command: 'update', flags: [] },
        ])
    })

    it('finds every flag up to the end of the code span, values included', () => {
        const text = '`npx @nera-static/nera new site --starter blog --name "A --b" --lang de --yes` and --theme'
        expect(extractCommands(text)).toEqual([
            { command: 'new', flags: ['--starter', '--name', '--b', '--lang', '--yes'] },
        ])
    })

    it('stops at the end of the line', () => {
        expect(extractCommands('run `npx nera validate\n--json` later')).toEqual([
            { command: 'validate', flags: [] },
        ])
    })

    it('gives a flag to the command it follows, not an earlier one in the span', () => {
        expect(extractCommands('`npx nera new site --yes && cd site && npx nera build --check`')).toEqual([
            { command: 'new', flags: ['--yes'] },
            { command: 'build', flags: ['--check'] },
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
        const fixture = 'Deploy with `npx nera deploy`, then run `npx nera validate`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera deploy'])
    })

    it('reports a flag the usage lacks', () => {
        const fixture = 'Run `npx nera build --watch`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera build --watch'])
    })

    it('reports a flag the usage lacks after one it lists', () => {
        const fixture = 'Run `npx nera new site --yes --template blog`.'
        expect(findMissing(extractCommands(fixture), usage)).toEqual(['nera new --template'])
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

    it('names nera new with --starter, --name, --lang and --yes', () => {
        const flags = extractCommands(agents)
            .filter(({ command }) => command === 'new')
            .flatMap(({ flags }) => flags)
        expect(flags).toEqual(expect.arrayContaining(['--starter', '--name', '--lang', '--yes']))
    })

    it('names only npm scripts the template package.json defines', () => {
        expect(findMissingScripts(extractScripts(agents), templateScripts)).toEqual([])
    })
})

describe('the Nera skill (skills/nera)', () => {
    it('is not vacuous: the extraction finds the commands SKILL.md is known to name', () => {
        const [, text] = skillFiles.find(([file]) => file === 'SKILL.md')
        const names = extractCommands(text).map(({ command }) => command)
        expect(names).toEqual(expect.arrayContaining(['new', 'validate', 'build', 'check', 'update']))
        expect(extractScripts(text)).toEqual(expect.arrayContaining(['dev', 'build']))
        expect(skillFiles.length).toBeGreaterThan(1)
    })

    it('names only commands and flags the CLI usage lists', () => {
        const missing = skillFiles.flatMap(([file, text]) =>
            findMissing(extractCommands(text), usage).map((m) => `${file}: ${m}`)
        )
        expect(missing).toEqual([])
    })

    it('names nera new with --starter, --name, --lang and --yes in SKILL.md', () => {
        const [, text] = skillFiles.find(([file]) => file === 'SKILL.md')
        const flags = extractCommands(text)
            .filter(({ command }) => command === 'new')
            .flatMap(({ flags }) => flags)
        expect(flags).toEqual(expect.arrayContaining(['--starter', '--name', '--lang', '--yes']))
    })

    it('names every bundled starter in SKILL.md', () => {
        const [, text] = skillFiles.find(([file]) => file === 'SKILL.md')
        const missing = BUNDLED_STARTERS.filter(({ name }) => !text.includes(`\`${name}\``))
        expect(missing.map(({ name }) => name)).toEqual([])
    })

    it.each([
        ['recipes/business-site.md', 'business'],
        ['recipes/blog.md', 'blog'],
        ['recipes/portfolio.md', 'portfolio'],
    ])('%s starts from --starter %s', (recipe, starter) => {
        const [, text] = skillFiles.find(([file]) => file === recipe)
        expect(text).toMatch(new RegExp(`\`npx @nera-static/nera new [\\w-]+ --starter ${starter}\``))
    })

    it('names only npm scripts the template package.json defines', () => {
        const missing = skillFiles.flatMap(([file, text]) =>
            findMissingScripts(extractScripts(text), templateScripts).map((m) => `${file}: ${m}`)
        )
        expect(missing).toEqual([])
    })
})
