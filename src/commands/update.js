import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { syncAgentFiles, SITE_NOTES_MARKER } from '../agent-files.js'
import { ownRange, templateDir as packageTemplateDir } from '../scaffold.js'
import { installedSkillDir, skillSourceDir, syncSkill } from '../skill.js'

const defaultRunNpm = (npmArgs, cwd) =>
    execFileSync('npm', npmArgs, { cwd, stdio: 'inherit' })

// The Nera packages a site consumes, so `nera update` bumps only those and
// leaves the user's other dependencies alone.
export function neraDeps(pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return Object.keys(deps).filter(
        (name) => name === '@nera-static/nera' || name.startsWith('@nera-static/')
    )
}

// The caret range `range` raised to the installed `version`, or null when it
// stays: only a plain `^x.y.z` with x ≥ 1, only upwards, never across a major.
// Exact, tilde, tag, git and 0.x ranges are the user's choice and stay as
// they are. `npm update` installs within the range but never rewrites it.
export function raisedRange(range, version) {
    const from = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range ?? '')
    const to = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
    if (!from || !to) return null
    const [a, b] = [from, to].map((m) => m.slice(1).map(Number))
    if (a[0] < 1 || a[0] !== b[0]) return null
    const newer = b[1] > a[1] || (b[1] === a[1] && b[2] > a[2])
    return newer ? `^${version}` : null
}

const indentOf = (text) => /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  '

// Raise the site's caret ranges of `names` to what is installed in its
// node_modules, keeping the file's own indentation, and the same ranges in
// the root entry of package-lock.json, so the two stay in sync. Returns the
// changes as [name, from, to].
export async function raiseRanges(cwd, names) {
    const pkgPath = path.join(cwd, 'package.json')
    const text = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(text)
    const raised = {}
    const changes = []
    for (const field of ['dependencies', 'devDependencies']) {
        for (const name of names) {
            const range = pkg[field]?.[name]
            if (typeof range !== 'string') continue
            let version
            try {
                const installed = path.join(cwd, 'node_modules', ...name.split('/'), 'package.json')
                version = JSON.parse(await fs.readFile(installed, 'utf-8')).version
            } catch {
                continue
            }
            const to = raisedRange(range, version)
            if (to) {
                pkg[field][name] = to
                raised[field] = { ...raised[field], [name]: [range, to] }
                changes.push([name, range, to])
            }
        }
    }
    if (changes.length === 0) return changes
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, indentOf(text))}\n`)

    const lockPath = path.join(cwd, 'package-lock.json')
    let lockText
    try {
        lockText = await fs.readFile(lockPath, 'utf-8')
    } catch {
        return changes
    }
    const lock = JSON.parse(lockText)
    const root = lock.packages?.['']
    let lockChanged = false
    for (const [field, entries] of Object.entries(raised)) {
        for (const [name, [from, to]] of Object.entries(entries)) {
            if (root?.[field]?.[name] === from) {
                root[field][name] = to
                lockChanged = true
            }
        }
    }
    if (lockChanged) {
        await fs.writeFile(lockPath, `${JSON.stringify(lock, null, indentOf(lockText))}\n`)
    }
    return changes
}

// A THIN site depends on @nera-static/nera and carries no engine source.
// A LEGACY site is a clone of the old generator: it vendors the engine under
// src/ and has no @nera-static/nera dependency — the case `nera update` migrates.
export function classifyProject(pkg, cwd = process.cwd()) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if (deps['@nera-static/nera']) return 'thin'

    const vendorsEngine =
        fssync.existsSync(path.join(cwd, 'src', 'core.js')) &&
        fssync.existsSync(path.join(cwd, 'src', 'render.js'))
    if (vendorsEngine) return 'legacy'

    return 'unknown'
}

function printLegacyGuidance() {
    console.log(
        '🔧 This is a legacy Nera site — a clone that vendors the engine under `src/`.'
    )
    console.log(
        '   `nera update` can convert it to the thin @nera-static/nera model:'
    )
    console.log('     • add @nera-static/nera as a dependency')
    console.log('     • rewrite scripts to `nera build`/`dev`/`serve`')
    console.log('     • remove the vendored `src/` engine and root `index.js`')
    console.log('     • run `npm install`')
    console.log('   Your pages/, config/ and theme/ are left untouched.')
    console.log('\n👉 Run `nera update --migrate` to do it.')
}

// The scaffold template whose AGENTS.md / CLAUDE.md the site is synced to:
// the one in the site's installed @nera-static/nera (read after npm has
// updated it), so the instructions match the Nera version the site runs even
// when a global or older `nera` performs the update. Falls back to the
// running package's template when nothing is installed there or the installed
// version predates 1.6.0, which shipped no AGENTS.md.
export function agentTemplateDir(cwd, fallbackDir) {
    const installed = path.join(cwd, 'node_modules', '@nera-static', 'nera', 'template')
    return fssync.existsSync(path.join(installed, 'AGENTS.md')) ? installed : fallbackDir
}

const AGENT_FILE_MESSAGES = {
    created: (file) => `  ✓ Created ${file}`,
    updated: (file) => `  ✓ Refreshed the Nera part of ${file}`,
    // Neutral on purpose: an existing CLAUDE.md is kept without comparing it.
    unchanged: (file) => `  ✓ ${file} unchanged`,
    skipped: (file) => `  ⚠️  Left ${file} alone: it has no \`${SITE_NOTES_MARKER}\` line`,
}

async function syncAndReportAgentFiles(cwd, fallbackDir) {
    const dir = agentTemplateDir(cwd, fallbackDir)
    const results = await syncAgentFiles({ cwd, templateDir: dir })
    for (const { file, action } of results) {
        console.log(AGENT_FILE_MESSAGES[action](file))
    }
    if (results.some(({ action }) => action === 'skipped')) {
        // Relative inside the site, absolute for a global or npx-cached CLI,
        // where a relative path would be a long run of `../`.
        const template = path.join(dir, 'AGENTS.md')
        const relative = path.relative(cwd, template)
        const source = relative.startsWith('..') ? template : relative
        console.log(
            `   To let \`nera update\` keep Nera's instructions current, copy the \`${SITE_NOTES_MARKER}\`` +
                ` line from ${source} directly above your own notes. Everything above that` +
                ' line is then Nera\'s and is replaced on update; the line and everything below it stay yours.'
        )
    }
}

const SKILL_MESSAGES = {
    created: (dir) => `  ✓ Added the Nera skill in ${dir}`,
    updated: (dir) => `  ✓ Refreshed the Nera skill in ${dir}`,
    unchanged: (dir) => `  ✓ ${dir} unchanged`,
}

// The skill folders are wholly Nera's, so they always follow the installed
// version (see installedSkillDir).
async function syncAndReportSkill(cwd, fallbackDir) {
    const results = await syncSkill({ cwd, sourceDir: installedSkillDir(cwd, fallbackDir) })
    for (const { path: dir, action } of results) {
        console.log(SKILL_MESSAGES[action](dir))
    }
}

async function migrateLegacy(cwd, pkg, runNpm, templateDir, skillDir) {
    console.log('🔧 Migrating this cloned site to the thin @nera-static/nera model...')

    pkg.dependencies = {
        ...pkg.dependencies,
        '@nera-static/nera': ownRange(),
    }

    pkg.scripts = {
        ...pkg.scripts,
        dev: 'nera dev',
        build: 'nera build',
        serve: 'nera serve',
    }
    // Generator-only scripts that no longer apply in the thin model.
    for (const s of ['render', 'preserve', 'watch:assets', 'start', 'dev:old']) {
        delete pkg.scripts[s]
    }
    // The `nera.version` stamp existed only because a cloned engine had no npm
    // version; npm now tracks it.
    delete pkg.nera

    await fs.writeFile(
        path.join(cwd, 'package.json'),
        `${JSON.stringify(pkg, null, 4)}\n`
    )
    console.log('  ✓ Rewrote package.json (dependency + scripts)')

    // A site's own local plugins must survive — move them out of the engine
    // folder before it is deleted, and tell the user how to re-point discovery.
    const srcPlugins = path.join(cwd, 'src', 'plugins')
    let movedPlugins = false
    if (fssync.existsSync(srcPlugins)) {
        await fs.rename(srcPlugins, path.join(cwd, 'plugins'))
        movedPlugins = true
        console.log('  ✓ Moved src/plugins → plugins/')
    }

    await fs.rm(path.join(cwd, 'src'), { recursive: true, force: true })
    await fs.rm(path.join(cwd, 'index.js'), { force: true })
    console.log('  ✓ Removed the vendored engine (src/, index.js)')

    console.log('📦 Installing...')
    runNpm(['install'], cwd)
    await syncAndReportAgentFiles(cwd, templateDir)
    await syncAndReportSkill(cwd, skillDir)

    console.log('✅ Migrated. Run `nera dev` to start.')
    if (movedPlugins) {
        console.log(
            '⚠️  Local plugins moved to plugins/. Add `folders:\\n  plugins: ./plugins`' +
                ' to config/app.yaml so the engine discovers them (see ROADMAP-core.md).'
        )
    }
}

export async function runUpdate(args = [], options = {}) {
    // templateDir: the fallback scaffold template for AGENTS.md / CLAUDE.md
    // (see agentTemplateDir); skillDir: the fallback Nera skill (see
    // installedSkillDir). Both injectable so tests need no installed package.
    const {
        cwd = process.cwd(),
        runNpm = defaultRunNpm,
        templateDir = packageTemplateDir(),
        skillDir = skillSourceDir(),
    } = options

    const pkg = JSON.parse(
        await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')
    )
    const kind = classifyProject(pkg, cwd)

    if (kind === 'legacy') {
        if (args.includes('--migrate') || args.includes('--yes')) {
            await migrateLegacy(cwd, pkg, runNpm, templateDir, skillDir)
        } else {
            printLegacyGuidance()
        }
        return
    }

    if (kind === 'unknown') {
        throw new Error(
            'This does not look like a Nera site — no @nera-static/nera ' +
                'dependency and no vendored engine under src/.'
        )
    }

    const targets = neraDeps(pkg)
    console.log(`🔄 Updating Nera packages: ${targets.join(', ')}`)
    runNpm(['update', ...targets], cwd)
    for (const [name, from, to] of await raiseRanges(cwd, targets)) {
        console.log(`  ✓ ${name}: ${from} → ${to} in package.json`)
    }
    await syncAndReportAgentFiles(cwd, templateDir)
    await syncAndReportSkill(cwd, skillDir)
    console.log('✅ Up to date.')
}
