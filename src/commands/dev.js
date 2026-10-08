import fssync from 'fs'
import path from 'path'
import run, { resolveSiteModel } from '@nera-static/core'
import { startServer } from './serve.js'

// Build once, serve `public/`, then rebuild on any change to the site's
// sources. `run()` already copies assets as part of a build, so a single
// watcher over pages/, config/ and the presentation folder covers everything —
// no separate asset-copy watcher (this replaces the old `concurrently` script
// that chained render + vite + watch-assets + nodemon).
//
// This is the code form of the previous npm-script orchestration. chokidar is
// imported lazily so loading this module does not require it to be installed.
export async function runDev(args = []) {
    const port = parsePort(args)

    await run()
    const server = await startServer(port)
    server.printUrls()

    const { default: chokidar } = await import('chokidar')

    const watched = new Set(watchTargets())
    const watcher = chokidar.watch([...watched], { ignoreInitial: true })

    // Serialise rebuilds: coalesce changes that land mid-build into one re-run.
    let building = false
    let queued = false
    const rebuild = async () => {
        if (building) {
            queued = true
            return
        }
        building = true
        try {
            await run()
        } catch (err) {
            console.error('❌ Build error:', err.message)
        }
        building = false
        // config/app.yaml may now name a different local theme — start
        // watching it too. A dropped one stays watched; that only costs an
        // extra rebuild if it is edited.
        for (const dir of watchTargets()) {
            if (!watched.has(dir)) {
                watched.add(dir)
                watcher.add(dir)
            }
        }
        if (queued) {
            queued = false
            await rebuild()
        }
    }

    watcher.on('all', async (event, filePath) => {
        console.log(
            `↻ ${event} ${path.relative(process.cwd(), filePath)} — rebuilding`
        )
        await rebuild()
    })

    return server
}

// What a rebuild depends on: pages/, config/, the site's presentation folder
// — theme/ in the current layout, or the deprecated root views/ on an
// unmigrated site — and a LOCAL theme (`theme: ./themes/classic`, or the same
// via NERA_THEME), which lives outside all of those. The theme is resolved
// through core, so the watcher follows exactly the spec the build uses. Only
// the theme's payload folders are watched, never its root: `theme: .` makes
// the root the site itself, and watching public/ would rebuild forever. An
// installed theme package under node_modules is left alone: it changes only on
// npm install, and watching node_modules is expensive.
export function watchTargets(cwd = process.cwd()) {
    const dirs = [
        'pages',
        'config',
        fssync.existsSync(path.join(cwd, 'theme')) ? 'theme' : 'views',
    ].map((d) => path.join(cwd, d))

    const { theme } = resolveSiteModel({ cwd })
    if (theme && !theme.root.split(path.sep).includes('node_modules')) {
        dirs.push(
            theme.viewsRoot,
            theme.assetsRoot,
            path.join(theme.root, 'config')
        )
    }

    return [...new Set(dirs)].filter((d) => fssync.existsSync(d))
}

const parsePort = (args) => {
    const i = args.indexOf('--port')
    const val = i >= 0 ? Number(args[i + 1]) : NaN
    return Number.isInteger(val) ? val : 3000
}
