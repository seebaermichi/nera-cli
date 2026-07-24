// Serve the already-built `public/` folder with Vite (static preview, no
// rebuild). Vite is imported lazily so merely loading this module — as the CLI
// dispatcher and the tests do — does not require Vite to be installed; it is
// only needed when `serve`/`dev` actually run.

const parsePort = (args) => {
    const i = args.indexOf('--port')
    const val = i >= 0 ? Number(args[i + 1]) : NaN
    return Number.isInteger(val) ? val : 3000
}

export async function startServer(port = 3000, open = true) {
    const { createServer } = await import('vite')
    const server = await createServer({
        root: 'public',
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
