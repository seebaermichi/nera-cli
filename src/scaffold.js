import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
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
                '(or `nera new .` for the current folder)'
        )
    }

    if (!VALID_PROJECT_NAME.test(projectName)) {
        throw new Error(
            `Invalid project name "${projectName}". Use letters, digits, dots, ` +
                'dashes and underscores only, starting with a letter or digit.'
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
        (n) => !n.startsWith('.') && !AGENT_FILES.has(n)
    )
    if (entries.length > 0) {
        throw new Error(
            `The current folder is not empty (${entries.slice(0, 3).join(', ')}` +
                `${entries.length > 3 ? ', …' : ''}). Run \`nera new .\` in an ` +
                'empty folder, or `nera new <name>` to create a new one.'
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
            'name (@scope/theme) or a local path (./my-theme).'
    )
}

// The npm package a theme spec installs, or null for a local path. Same rule
// as core's packageName() — keep the two in step.
export function themePackageName(theme) {
    if (theme.startsWith('.')) return null
    return theme.includes('/') || theme.startsWith('@')
        ? theme
        : `@nera-static/theme-${theme}`
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
export const ownRange = () => {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    return `^${JSON.parse(fssync.readFileSync(pkgPath, 'utf-8')).version}`
}

async function copyDir(src, dest, { skipStarters = false } = {}) {
    await fs.mkdir(dest, { recursive: true })
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name)
        // `_gitignore` → `.gitignore`: npm strips a literal .gitignore from the
        // published tarball, so the template ships it under an underscore name.
        const name = entry.name === '_gitignore' ? '.gitignore' : entry.name
        const to = path.join(dest, name)
        if (entry.isDirectory()) {
            await copyDir(from, to, { skipStarters })
        } else if (skipStarters && (await isStarterTemplate(from))) {
            continue
        } else if (fssync.existsSync(to)) {
            // Only in place, and then only a dotfile such as .gitignore, or
            // AGENTS.md / CLAUDE.md, can be there already (assertEmptyDir):
            // the user's copy wins.
            console.log(`  • Kept your existing ${path.basename(to)}`)
        } else {
            await fs.copyFile(from, to)
        }
    }
}

async function personalize(targetDir, projectName) {
    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    pkg.name = projectName
    pkg.dependencies = { ...pkg.dependencies, '@nera-static/nera': ownRange() }
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    console.log(`  ✓ Configured project as "${projectName}"`)
}

// Point the site at its theme: `theme:` in app.yaml (appended, so the
// template's own lines and comments stay as they are) and, for a package
// theme, a dependency that `npm install` resolves.
async function applyTheme(targetDir, theme) {
    const appYaml = path.join(targetDir, 'config', 'app.yaml')
    const yaml = await fs.readFile(appYaml, 'utf-8')
    await fs.writeFile(
        appYaml,
        `${yaml.replace(/\n*$/, '\n')}\ntheme: ${theme}\n`
    )

    const pkgName = themePackageName(theme)
    if (pkgName) {
        const pkgPath = path.join(targetDir, 'package.json')
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
        pkg.dependencies = { ...pkg.dependencies, [pkgName]: 'latest' }
        await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    }
    console.log(`  ✓ Using theme "${theme}"${pkgName ? ` (${pkgName})` : ''}`)
    // The scaffold's footer, which links the imprint and privacy
    // placeholders, is a starter template and so left out with a theme.
    console.log(
        '  • pages/imprint.md and pages/privacy.md are placeholders: link them ' +
            'from the theme\'s layout (theme-blog and theme-business take ' +
            '`footer_links` in config/theme.yaml), or `nera build --check` ' +
            'keeps warning legal-imprint-link and legal-privacy-link.'
    )
}

// `--name`: any non-empty text without line breaks. It is written as a JSON
// string, which is also valid YAML, so `:`, `#` and quotes are safe.
export function validateSiteName(name) {
    if (typeof name === 'string' && name.trim() !== '' && !/[\0-\x1f\x7f]/.test(name)) {
        return name
    }
    throw new Error(
        `Invalid site name ${JSON.stringify(name)}. Give a name on one line, ` +
            'e.g. --name "Brot & Zeit".'
    )
}

// `--lang`: a BCP 47-style language tag (`de`, `en`, `pt-BR`).
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/

export function validateLang(lang) {
    if (typeof lang === 'string' && LANG.test(lang)) return lang
    throw new Error(
        `Invalid language "${lang}". Use a language code such as en, de or pt-BR.`
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

async function applyNameAndLang(targetDir, { name, lang }) {
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
    console.log(`  ✓ Set the site's ${set.join(' and ')} in config/app.yaml`)
    if (copied) {
        console.log(
            `  ✓ Copied the "${oldLang}" translations to "${lang}" in config/app.yaml — translate them there`
        )
    }
}

// The Nera skill for AI assistants, in both folders the clients read
// (.agents/skills/nera, .claude/skills/nera). Meant to be committed, and
// refreshed by `nera update`.
async function addSkill(targetDir) {
    const results = await syncSkill({ cwd: targetDir, sourceDir: skillSourceDir() })
    console.log(
        `  ✓ Added the Nera skill for AI assistants (${results.map((r) => r.path).join(', ')})`
    )
}

// npm before 10.9 (bundled with Node < 22.12) crashes in arborist on the
// optional peer chain of vite 8, which every site installs (ROADMAP-ai.md,
// slice 5, "the Node floor"). Checked before anything is written or asked.
const MIN_NPM = [10, 9, 0]

const defaultExecNpm = (args, options) => execFileSync('npm', args, options)

// The installed npm's version, or null when it cannot be read (no npm on the
// PATH, an unparseable answer): then nothing is refused, and `npm install`
// reports its own error.
export function probeNpmVersion(execNpm = defaultExecNpm) {
    try {
        const out = execNpm(['--version'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        })
        const version = String(out).trim()
        return /^\d+\.\d+\.\d+/.test(version) ? version : null
    } catch {
        return null
    }
}

// Throws when `version` is an npm that cannot install a site; null passes.
export function assertNpmCanInstall(version) {
    if (version === null) return
    const parts = version.split(/[.-]/).slice(0, 3).map(Number)
    const i = parts.findIndex((n, j) => n !== MIN_NPM[j])
    if (i === -1 || parts[i] > MIN_NPM[i]) return
    throw new Error(
        `npm ${version} cannot install a Nera site: it crashes on vite's ` +
            'dependencies. Use Node.js 22.12 or later, which bundles npm 10.9, ' +
            'or update npm with `npm i -g npm@10.9`, then run `nera new` ' +
            'again. Nothing was written.'
    )
}

// Scaffold a thin Nera site: copy the template, lay a starter kit over it if
// one is given, name it, and (by default) install its dependencies. The one
// code path for flags, the interactive picker and the future MCP tool
// (ROADMAP-ai.md principle 4): everything comes in as plain options.
// `fetchStarter(spec, { cwd })` → `{ dir, cleanup }` and `execNpm(args,
// options)` (execFileSync's shape) are injectable for tests.
export async function scaffoldProject(projectName, options = {}) {
    const {
        install = true,
        cwd = process.cwd(),
        theme,
        starter,
        name,
        lang,
        fetchStarter = defaultFetchStarter,
        execNpm = defaultExecNpm,
    } = options

    // Everything is checked before anything is written.
    const inPlace = isCurrentDir(projectName)
    if (!inPlace) validateProjectName(projectName)
    if (theme !== undefined) validateThemeSpec(theme)
    if (starter !== undefined) validateStarterSpec(starter)
    if (starter !== undefined && theme !== undefined) {
        throw new Error(
            'A starter brings its own theme; use --starter or --theme, not both.'
        )
    }
    if (name !== undefined) validateSiteName(name)
    if (lang !== undefined) validateLang(lang)
    if (install) assertNpmCanInstall(probeNpmVersion(execNpm))

    const targetDir = path.resolve(cwd, inPlace ? '.' : projectName)
    if (inPlace) {
        await assertEmptyDir(targetDir)
    } else if (fssync.existsSync(targetDir)) {
        throw new Error(`Target directory "${projectName}" already exists.`)
    }
    const packageName = inPlace ? projectNameFromDir(targetDir) : projectName

    // The starter is fetched and checked before the site folder exists, so a
    // download error or a package that is no starter leaves nothing behind.
    const fetched = starter === undefined ? null : await fetchStarter(starter, { cwd })
    let readme = null
    try {
        if (fetched) await readStarterManifest(fetched.dir, starter)
        const skipStarters = Boolean(theme) || (fetched ? await starterSetsTheme(fetched.dir) : false)
        const before = inPlace ? new Set(await fs.readdir(targetDir)) : null

        console.log(`📦 Creating a new Nera site in ${targetDir}...`)
        try {
            await copyDir(templateDir(), targetDir, { skipStarters })
            await personalize(targetDir, packageName)
            if (theme) await applyTheme(targetDir, theme)
            if (fetched) readme = await applyStarter(targetDir, fetched.dir)
            await applyNameAndLang(targetDir, { name, lang })
            await addSkill(targetDir)
        } catch (err) {
            if (!inPlace) {
                await fs.rm(targetDir, { recursive: true, force: true })
                throw err
            }
            const written = (await fs.readdir(targetDir)).filter((n) => !before.has(n))
            err.message +=
                written.length > 0
                    ? ` Already written to the current folder: ${written.join(', ')}. ` +
                      'Remove them before running `nera new .` again.'
                    : ''
            throw err
        }
    } finally {
        await fetched?.cleanup()
    }

    if (install) {
        console.log('📦 Installing dependencies...')
        // Naming the theme package installs everything else too, and makes npm
        // replace the `latest` placeholder with a caret range for the version
        // it resolved. A starter's dependencies are already in package.json.
        const themePkg = theme ? themePackageName(theme) : null
        const args = themePkg ? ['install', themePkg] : ['install']
        execNpm(args, { cwd: targetDir, stdio: 'inherit' })
    }

    // `npm run dev`, not `nera dev`: it works without a global `nera`.
    const nextSteps = [
        ...(inPlace ? [] : [`cd ${projectName}`]),
        ...(install ? [] : ['npm install']),
        'npm run dev',
    ]
    console.log('✅ Done!')
    if (readme) console.log(`\n${readme}\n`)
    console.log(
        `👉 Next steps:\n${nextSteps.map((l) => `  ${l}\n`).join('')}`
    )
    return targetDir
}
