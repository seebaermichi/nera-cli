import fssync from 'fs'
import run from '@nera-static/core'
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

    // Presentation lives under theme/ in the current layout, or the deprecated
    // root views/ on an unmigrated site — watch whichever exists.
    const watchDirs = [
        'pages',
        'config',
        fssync.existsSync('theme') ? 'theme' : 'views',
    ].filter((d) => fssync.existsSync(d))

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
        if (queued) {
            queued = false
            await rebuild()
        }
    }

    chokidar
        .watch(watchDirs, { ignoreInitial: true })
        .on('all', async (event, filePath) => {
            console.log(`↻ ${event} ${filePath} — rebuilding`)
            await rebuild()
        })

    return server
}

const parsePort = (args) => {
    const i = args.indexOf('--port')
    const val = i >= 0 ? Number(args[i + 1]) : NaN
    return Number.isInteger(val) ? val : 3000
}
