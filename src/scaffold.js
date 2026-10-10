import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

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

// In-place scaffolding only goes ahead in an empty folder. Dotfiles such as
// `.git` or an editor folder do not count: `git init` first is the usual way
// to start a project.
async function assertEmptyDir(dir) {
    const entries = (await fs.readdir(dir)).filter((n) => !n.startsWith('.'))
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
            // Only in place, and then only a dotfile such as .gitignore can be
            // there already (assertEmptyDir): the user's copy wins.
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
}

// Scaffold a thin Nera site: copy the template, name it, and (by default)
// install its single dependency, @nera-static/nera. No git clone, no vendored
// engine — the opposite of the old installer's clone-and-strip flow.
export async function scaffoldProject(projectName, options = {}) {
    const { install = true, cwd = process.cwd(), theme } = options

    const inPlace = isCurrentDir(projectName)
    if (!inPlace) validateProjectName(projectName)
    if (theme !== undefined) validateThemeSpec(theme)

    const targetDir = path.resolve(cwd, inPlace ? '.' : projectName)
    if (inPlace) {
        await assertEmptyDir(targetDir)
    } else if (fssync.existsSync(targetDir)) {
        throw new Error(`Target directory "${projectName}" already exists.`)
    }
    const packageName = inPlace ? projectNameFromDir(targetDir) : projectName

    console.log(`📦 Creating a new Nera site in ${targetDir}...`)
    await copyDir(templateDir(), targetDir, { skipStarters: Boolean(theme) })
    await personalize(targetDir, packageName)
    if (theme) await applyTheme(targetDir, theme)

    if (install) {
        console.log('📦 Installing dependencies...')
        // Naming the theme package installs everything else too, and makes npm
        // replace the `latest` placeholder with a caret range for the version
        // it resolved.
        const themePkg = theme ? themePackageName(theme) : null
        const args = themePkg ? ['install', themePkg] : ['install']
        execFileSync('npm', args, { cwd: targetDir, stdio: 'inherit' })
    }

    // `npm run dev`, not `nera dev`: it works without a global `nera`.
    const nextSteps = [
        ...(inPlace ? [] : [`cd ${projectName}`]),
        ...(install ? [] : ['npm install']),
        'npm run dev',
    ]
    console.log('✅ Done!')
    console.log(
        `👉 Next steps:\n${nextSteps.map((l) => `  ${l}\n`).join('')}`
    )
    return targetDir
}
