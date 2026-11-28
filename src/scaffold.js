import fs from 'node:fs/promises'
import fssync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ownVersion, themePackage } from '@nera-static/plugin-utils/packages'
import { satisfiesFloor } from '@nera-static/plugin-utils/guard'
import { isText } from '@nera-static/plugin-utils/values'
import { runNpmAsync } from './npm.js'
import { skillSourceDir, syncSkill } from './skill.js'
import {
    applyStarter,
    fetchStarter as defaultFetchStarter,
    readStarterManifest,
    starterSetsTheme,
    validateStarterSpec,
} from './starter.js'

// Directory-safe and npm-safe: no separators, no traversal, no leading dot or
// dash, nothing the shell could reinterpret. Deliberately stricter than npm's
// own package-name rules, because this value is also a directory name.
const VALID_PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateProjectName(projectName) {
    if (typeof projectName !== 'string' || projectName.trim() === '') {
        throw new Error(
            'Project name is required. Usage: nera new <project-name> ' +
                '(or `nera new .` for the current folder)',
        )
    }

    if (!VALID_PROJECT_NAME.test(projectName)) {
        throw new Error(
            `Invalid project name "${projectName}". Use letters, digits, dots, ` +
                'dashes and underscores only, starting with a letter or digit.',
        )
    }

    return projectName
}

// `nera new .` scaffolds into the current folder. Only these two spellings:
// `..`, absolute paths and every other name still go through
// validateProjectName unchanged.
const CURRENT_DIR = new Set(['.', './'])

export const isCurrentDir = (projectName) => CURRENT_DIR.has(projectName)

// Letters NFKD does not decompose into a base letter plus an accent.
const LETTER_FOLDS = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd' }

// npm refuses these names outright, and longer ones than this.
const NPM_RESERVED = new Set(['node_modules', 'favicon.ico'])
const NPM_MAX_LENGTH = 214

// The package name for a site scaffolded in place, derived from the folder's
// basename and normalised until it passes validateProjectName and npm's own
// rules: accents dropped (`Bäckerei` → `backerei`, `Straße` → `strasse`),
// lower-case, each run of other characters → one `-`, no leading dot, dash or
// underscore, at most 214 characters. `nera-site` when nothing usable is left.
export function projectNameFromDir(dir) {
    const name = path
        .basename(path.resolve(dir))
        .toLowerCase()
        .replace(/[ßæœøłđ]/g, (c) => LETTER_FOLDS[c])
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+/, '')
        .slice(0, NPM_MAX_LENGTH)
        .replace(/[-.]+$/, '')
    return name === '' || NPM_RESERVED.has(name)
        ? 'nera-site'
        : validateProjectName(name)
}

// Files an AI assistant may have written before running `nera new .`. They
// do not make the folder count as non-empty, and the user's copy is kept.
// Exact names only, matched case-sensitively.
const AGENT_FILES = new Set(['AGENTS.md', 'CLAUDE.md'])

// In-place scaffolding only goes ahead in an empty folder. Dotfiles such as
// `.git` or an editor folder do not count: `git init` first is the usual way
// to start a project. Neither do AGENT_FILES.
async function assertEmptyDir(dir) {
    const entries = (await fs.readdir(dir)).filter(
        (n) => !n.startsWith('.') && !AGENT_FILES.has(n),
    )
    if (entries.length > 0) {
        throw new Error(
            `The current folder is not empty (${entries.slice(0, 3).join(', ')}` +
                `${entries.length > 3 ? ', …' : ''}). Run \`nera new .\` in an ` +
                'empty folder, or `nera new <name>` to create a new one.',
        )
    }
}

// What `--theme` accepts, mirroring the three forms `app.theme` takes in
// @nera-static/core (src/theme.js): a bare name (`example` →
// @nera-static/theme-example), a full package name (`@acme/my-theme`), or a
// local path (`./my-theme`). Validated because it lands in app.yaml and, for
// the package forms, on the npm command line.
const BARE_THEME = /^[a-z0-9][a-z0-9._-]*$/
const SCOPED_THEME = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/
const LOCAL_THEME = /^\.{1,2}(\/[A-Za-z0-9._-]+)*\/?$/

export function validateThemeSpec(theme) {
    if (
        typeof theme === 'string' &&
        (BARE_THEME.test(theme) ||
            SCOPED_THEME.test(theme) ||
            LOCAL_THEME.test(theme))
    ) {
        return theme
    }
    throw new Error(
        `Invalid theme "${theme}". Use a theme name (example), a package ` +
            'name (@scope/theme) or a local path (./my-theme).',
    )
}

// Starter templates carry this marker on their first line. With a theme they
// are left out: site views win over theme views file by file, so a starter
// layout would hide the theme's own. @nera-static/validate warns on the same
// marker (`theme-shadowed`) for sites that kept them.
const SCAFFOLD_MARKER = 'nera:scaffold-default'

const isStarterTemplate = async (file) =>
    file.endsWith('.pug') &&
    (await fs.readFile(file, 'utf-8')).includes(SCAFFOLD_MARKER)

// The scaffold template ships inside this package (package.json `files`).
export const templateDir = () =>
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template')

// The range a new or migrated site depends on: this CLI's own version, so the
// site never claims to work with an older one that lacks what set it up
// (starters, `nera check`, the `validate`/`check` scripts).
export const ownRange = () => `^${ownVersion(import.meta.url)}`

async function copyDir(src, dest, { skipStarters = false, log }) {
    await fs.mkdir(dest, { recursive: true })
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name)
        // `_gitignore` → `.gitignore`: npm strips a literal .gitignore from the
        // published tarball, so the template ships it under an underscore name.
        const name = entry.name === '_gitignore' ? '.gitignore' : entry.name
        const to = path.join(dest, name)
        if (entry.isDirectory()) {
            await copyDir(from, to, { skipStarters, log })
        } else if (skipStarters && (await isStarterTemplate(from))) {
            continue
        } else if (fssync.existsSync(to)) {
            // Only in place, and then only a dotfile such as .gitignore, or
            // AGENTS.md / CLAUDE.md, can be there already (assertEmptyDir):
            // the user's copy wins.
            log(`  • Kept your existing ${path.basename(to)}`)
        } else {
            await fs.copyFile(from, to)
        }
    }
}

async function personalize(targetDir, projectName, log) {
    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    pkg.name = projectName
    pkg.dependencies = { ...pkg.dependencies, '@nera-static/nera': ownRange() }
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    log(`  ✓ Configured project as "${projectName}"`)
}

// Point the site at its theme: `theme:` in app.yaml (appended, so the
// template's own lines and comments stay as they are) and, for a package
// theme, a dependency that `npm install` resolves.
async function applyTheme(targetDir, theme, log) {
    const appYaml = path.join(targetDir, 'config', 'app.yaml')
    const yaml = await fs.readFile(appYaml, 'utf-8')
    await fs.writeFile(
        appYaml,
        `${yaml.replace(/\n*$/, '\n')}\ntheme: ${theme}\n`,
    )

    const pkgName = themePackage(theme)
    if (pkgName) {
        const pkgPath = path.join(targetDir, 'package.json')
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
        pkg.dependencies = { ...pkg.dependencies, [pkgName]: 'latest' }
        await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    }
    log(`  ✓ Using theme "${theme}"${pkgName ? ` (${pkgName})` : ''}`)
    // The scaffold's footer, which links the imprint and privacy
    // placeholders, is a starter template and so left out with a theme.
    log(
        '  • pages/imprint.md and pages/privacy.md are placeholders: link them ' +
            'from the theme\'s layout (theme-blog and theme-business take ' +
            '`footer_links` in config/theme.yaml), or `nera build --check` ' +
            'keeps warning legal-imprint-link and legal-privacy-link.',
    )
}

// `--name`: any non-empty text without control characters (line breaks,
// tabs). It is written as a JSON string, which is also valid YAML, so `:`,
// `#` and quotes are safe.
export function validateSiteName(name) {
    if (isText(name) && !/\p{Cc}/u.test(name)) {
        return name
    }
    throw new Error(
        `Invalid site name ${JSON.stringify(name)}. Give a name on one line, ` +
            'e.g. --name "Brot & Zeit".',
    )
}

// `--lang`: a BCP 47-style language tag (`de`, `en`, `pt-BR`).
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export function validateLang(lang) {
    if (typeof lang === 'string' && LANG.test(lang)) return lang
    throw new Error(
        `Invalid language "${lang}". Use a language code such as en, de or pt-BR.`,
    )
}

// Set a top-level `key: value` line in an app.yaml text: replace the first
// one, or append it if there is none. Every other line, comment and nested
// block (translations:) stays as it is. `value` is written verbatim.
export function setAppValue(yaml, key, value) {
    const line = new RegExp(`^${key}:.*$`, 'm')
    if (line.test(yaml)) return yaml.replace(line, () => `${key}: ${value}`)
    return `${yaml.replace(/\n*$/, '\n')}${key}: ${value}\n`
}

// Give a new language its own entry in the block-style `translations:` of an
// app.yaml text, copied from language `from`: core's `t(key)` falls back to
// the key itself, so a site switched to `de` with only an `en` block would
// render `app_description` on every page without its own description.
// Line-based like setAppValue; returns the text unchanged when there is no
// such block, `from` has no entry, or `to` already has one.
export function addLangTranslations(yaml, from, to) {
    const lines = yaml.split('\n')
    const start = lines.findIndex((l) => /^translations:[ \t]*(#.*)?$/.test(l))
    if (start === -1 || !from || from === to) return yaml
    let end = start + 1
    while (end < lines.length && (lines[end].trim() === '' || /^[ \t]/.test(lines[end]))) end++
    while (end > start + 1 && lines[end - 1].trim() === '') end--

    // The line `  <lang>:` inside the block, or -1. Codes are validated
    // (letters, digits, dashes), so they are safe in a RegExp.
    const entry = (lang) => {
        const re = new RegExp(`^[ \\t]+${lang}:[ \\t]*(#.*)?$`)
        for (let i = start + 1; i < end; i++) if (re.test(lines[i])) return i
        return -1
    }
    if (entry(to) !== -1) return yaml
    const fromStart = entry(from)
    if (fromStart === -1) return yaml

    const indent = lines[fromStart].match(/^[ \t]+/)[0]
    let fromEnd = fromStart + 1
    while (
        fromEnd < end &&
        (lines[fromEnd].trim() === '' || lines[fromEnd].match(/^[ \t]*/)[0].length > indent.length)
    ) fromEnd++
    while (lines[fromEnd - 1].trim() === '') fromEnd--
    const copy = [`${indent}${to}:`, ...lines.slice(fromStart + 1, fromEnd)]
    return [...lines.slice(0, end), ...copy, ...lines.slice(end)].join('\n')
}

async function applyNameAndLang(targetDir, { name, lang }, log) {
    if (name === undefined && lang === undefined) return
    const appYaml = path.join(targetDir, 'config', 'app.yaml')
    let yaml = await fs.readFile(appYaml, 'utf-8')
    const oldLang = yaml.match(/^lang:[ \t]*["']?([A-Za-z0-9-]+)["']?[ \t]*(#.*)?$/m)?.[1]
    if (name !== undefined) yaml = setAppValue(yaml, 'name', JSON.stringify(name))
    let copied = false
    if (lang !== undefined) {
        yaml = setAppValue(yaml, 'lang', lang)
        const withLang = addLangTranslations(yaml, oldLang, lang)
        copied = withLang !== yaml
        yaml = withLang
    }
    await fs.writeFile(appYaml, yaml)
    const set = [
        ...(name !== undefined ? [`name ${JSON.stringify(name)}`] : []),
        ...(lang !== undefined ? [`language "${lang}"`] : []),
    ]
    log(`  ✓ Set the site's ${set.join(' and ')} in config/app.yaml`)
    if (copied) {
        log(
            `  ✓ Copied the "${oldLang}" translations to "${lang}" in config/app.yaml — translate them there`,
        )
    }
}

// The Nera skill for AI assistants, in both folders the clients read
// (.agents/skills/nera, .claude/skills/nera). Meant to be committed, and
// refreshed by `nera update`.
async function addSkill(targetDir, log) {
    const results = await syncSkill({ cwd: targetDir, sourceDir: skillSourceDir() })
    log(
        `  ✓ Added the Nera skill for AI assistants (${results.map((r) => r.path).join(', ')})`,
    )
}

// npm before 10.9 (bundled with Node < 22.12) crashes in arborist on the
// optional peer chain of vite 8, which every site installs; that is why
// Nera's Node floor is 22.12. Checked before anything is written or asked.
const MIN_NPM = '10.9.0'
// Every version `satisfiesFloor` can read is this one or later.
const ANY_VERSION = '0.0.0'

// Through src/npm.js, so it works on Windows too (npm.cmd), and without
// blocking the event loop.
const defaultExecNpm = (args, options) => runNpmAsync(args, options)

// The installed npm's version, or null when it cannot be read (no npm on the
// PATH, an answer that is no x.y.z version): then nothing is refused, and
// `npm install` reports its own error. `env` decides which npm a shim PATH
// finds; an abort rejects with `signal.reason` instead of answering null.
// `execNpm` may return stdout or a promise of it.
export async function probeNpmVersion(execNpm = defaultExecNpm, { env = process.env, signal } = {}) {
    signal?.throwIfAborted()
    try {
        const out = await execNpm(['--version'], {
            stdio: ['ignore', 'pipe', 'ignore'],
            env,
            signal,
        })
        const version = String(out).trim()
        return satisfiesFloor(version, ANY_VERSION) ? version : null
    } catch {
        signal?.throwIfAborted()
        return null
    }
}

// Throws when `version` is an npm that cannot install a site; null passes.
export function assertNpmCanInstall(version) {
    if (version === null || satisfiesFloor(version, MIN_NPM)) return
    throw new Error(
        `npm ${version} cannot install a Nera site: it crashes on vite's ` +
            'dependencies. Use Node.js 22.12 or later, which bundles npm 10.9, ' +
            'or update npm with `npm i -g npm@10.9`, then run `nera new` ' +
            'again. Nothing was written.',
    )
}

// Append `text` to an error's message. Also for an AbortError DOMException,
// whose `message` is a read-only accessor: an own property shadows it. A
// primitive or frozen abort reason is left as it is.
function appendToMessage(err, text) {
    if (err === null || typeof err !== 'object' || !Object.isExtensible(err)) return
    const message = String(err.message ?? '')
    Object.defineProperty(err, 'message', {
        value: `${message}${/[.!?]$/.test(message) || message === '' ? '' : '.'}${text}`,
        configurable: true,
        writable: true,
    })
}

// Scaffold a thin Nera site: copy the template, lay a starter kit over it if
// one is given, name it, and (by default) install its dependencies. The one
// code path for flags, the interactive picker and the MCP server, so none
// of them can do more than the others: everything comes in as plain options.
// Returns `{ dir, firstSteps }`: the site's folder and the `## First steps`
// section of the starter's README, or null.
//
// Every message goes through `log(line)` (default console.log) and npm
// install's output to `stdio` (default 'inherit'), so a caller whose stdout
// is a protocol channel passes its own `log` and e.g. `['ignore', 2, 2]`;
// nothing else is written to stdout and nothing is read from stdin.
//
// No child blocks the event loop. `env` (default process.env) reaches every
// child: `npm --version`, `npm pack`, `tar` and `npm install`. `signal` (an
// AbortSignal) kills the running child and rejects with `signal.reason`; an
// abort during the download, the copy or the install removes a new site
// folder, while in place nothing is removed and the error names what was
// written. A failed install, by contrast, keeps the folder (`npm install`
// can be rerun there).
// `fetchStarter(spec, { cwd, log, env, signal })` → `{ dir, cleanup }` and
// `execNpm(args, { cwd, stdio, env, signal })`, which returns stdout or a
// promise of it, are injectable for tests.
export async function createSite(projectName, options = {}) {
    const {
        install = true,
        cwd = process.cwd(),
        theme,
        starter,
        name,
        lang,
        log = console.log,
        stdio = 'inherit',
        fetchStarter = defaultFetchStarter,
        execNpm = defaultExecNpm,
        env = process.env,
        signal,
    } = options

    // Everything is checked before anything is written.
    const inPlace = isCurrentDir(projectName)
    if (!inPlace) validateProjectName(projectName)
    if (theme !== undefined) validateThemeSpec(theme)
    if (starter !== undefined) validateStarterSpec(starter)
    if (starter !== undefined && theme !== undefined) {
        throw new Error(
            'A starter brings its own theme; use --starter or --theme, not both.',
        )
    }
    if (name !== undefined) validateSiteName(name)
    if (lang !== undefined) validateLang(lang)
    signal?.throwIfAborted()
    if (install) assertNpmCanInstall(await probeNpmVersion(execNpm, { env, signal }))

    const targetDir = path.resolve(cwd, inPlace ? '.' : projectName)
    if (inPlace) {
        await assertEmptyDir(targetDir)
    } else if (fssync.existsSync(targetDir)) {
        throw new Error(`Target directory "${projectName}" already exists.`)
    }
    const packageName = inPlace ? projectNameFromDir(targetDir) : projectName
    const before = inPlace ? new Set(await fs.readdir(targetDir)) : null

    // Undo what this run wrote, for a copy failure or an abort: a new folder
    // goes entirely, the current folder is never touched and `err` names the
    // entries that were added to it. Returns `err` to rethrow.
    const undo = async (err) => {
        if (!inPlace) {
            await fs.rm(targetDir, { recursive: true, force: true })
            return err
        }
        const written = (await fs.readdir(targetDir)).filter((n) => !before.has(n))
        if (written.length > 0) {
            appendToMessage(
                err,
                ` Already written to the current folder: ${written.join(', ')}. ` +
                    'Remove them before running `nera new .` again.',
            )
        }
        return err
    }

    // The starter is fetched and checked before the site folder exists, so a
    // download error, an abort or a package that is no starter leaves nothing
    // behind.
    const fetched =
        starter === undefined ? null : await fetchStarter(starter, { cwd, log, env, signal })
    let firstSteps = null
    try {
        if (fetched) await readStarterManifest(fetched.dir, starter)
        const skipStarters = Boolean(theme) || (fetched ? await starterSetsTheme(fetched.dir) : false)

        log(`📦 Creating a new Nera site in ${targetDir}...`)
        try {
            await copyDir(templateDir(), targetDir, { skipStarters, log })
            await personalize(targetDir, packageName, log)
            if (theme) await applyTheme(targetDir, theme, log)
            if (fetched) firstSteps = await applyStarter(targetDir, fetched.dir, { log })
            await applyNameAndLang(targetDir, { name, lang }, log)
            await addSkill(targetDir, log)
            signal?.throwIfAborted()
        } catch (err) {
            throw await undo(err)
        }
    } finally {
        await fetched?.cleanup()
    }

    if (install) {
        log('📦 Installing dependencies...')
        // Naming the theme package installs everything else too, and makes npm
        // replace the `latest` placeholder with a caret range for the version
        // it resolved. A starter's dependencies are already in package.json.
        const themePkg = themePackage(theme)
        const args = themePkg ? ['install', themePkg] : ['install']
        try {
            await execNpm(args, { cwd: targetDir, stdio, env, signal })
        } catch (err) {
            // Only an abort undoes the site; a failed install keeps it.
            if (signal?.aborted) throw await undo(signal.reason)
            throw err
        }
    }

    // `npm run dev`, not `nera dev`: it works without a global `nera`.
    const nextSteps = [
        ...(inPlace ? [] : [`cd ${projectName}`]),
        ...(install ? [] : ['npm install']),
        'npm run dev',
    ]
    log('✅ Done!')
    if (firstSteps) log(`\n${firstSteps}\n`)
    log(`👉 Next steps:\n${nextSteps.map((l) => `  ${l}\n`).join('')}`)
    return { dir: targetDir, firstSteps }
}

// `nera new`'s entry point: createSite, returning the site's folder.
export async function scaffoldProject(projectName, options = {}) {
    return (await createSite(projectName, options)).dir
}
