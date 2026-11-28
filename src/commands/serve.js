// Serve the already-built `public/` folder with Vite (static preview, no
// rebuild). Vite is imported lazily so merely loading this module — as the CLI
// dispatcher and the tests do — does not require Vite to be installed; it is
// only needed when `serve`/`dev` actually run.

// The `--port <n>` value of `args`, or 3000 when it is missing or not an
// integer. Shared with `nera dev`.
export const parsePort = (args) => {
    const i = args.indexOf('--port')
    const val = i >= 0 ? Number(args[i + 1]) : NaN
    return Number.isInteger(val) ? val : 3000
}

// Start Vite over `root`, `public/` of the working directory by default (as
// `nera serve` and `nera dev` run it); a test passes the folder it owns.
export async function startServer(port = 3000, open = true, { root = 'public' } = {}) {
    const { createServer } = await import('vite')
    const server = await createServer({
        root,
        server: { port, open, watch: { usePolling: true } },
    })
    await server.listen()
    return server
}

export async function runServe(args = []) {
    const server = await startServer(parsePort(args))
    server.printUrls()
    return server
}
