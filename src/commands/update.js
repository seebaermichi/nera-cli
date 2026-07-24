import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'

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

async function migrateLegacy(cwd, pkg, runNpm) {
    console.log('🔧 Migrating this cloned site to the thin @nera-static/nera model...')

    pkg.dependencies = {
        ...pkg.dependencies,
        '@nera-static/nera': '^1.0.0',
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

    console.log('✅ Migrated. Run `nera dev` to start.')
    if (movedPlugins) {
        console.log(
            '⚠️  Local plugins moved to plugins/. Add `folders:\\n  plugins: ./plugins`' +
                ' to config/app.yaml so the engine discovers them (see ROADMAP-core.md).'
        )
    }
}

export async function runUpdate(args = [], options = {}) {
    const { cwd = process.cwd(), runNpm = defaultRunNpm } = options

    const pkg = JSON.parse(
        await fs.readFile(path.join(cwd, 'package.json'), 'utf-8')
    )
    const kind = classifyProject(pkg, cwd)

    if (kind === 'legacy') {
        if (args.includes('--migrate') || args.includes('--yes')) {
            await migrateLegacy(cwd, pkg, runNpm)
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
    console.log('✅ Up to date.')
}
