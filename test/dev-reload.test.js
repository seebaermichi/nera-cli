import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../src/commands/serve.js'
import { createRebuilder } from '../src/commands/dev.js'

// The real wire of `nera dev`'s reload: Vite 8 serving `public/`, a browser-like
// HMR client connected to it, and the rebuild loop wired the way `runDev` wires
// it. The build deletes and recreates `public/`, as core's run() does, and the
// client must then receive `full-reload`. Vite ≥ 6 accepts a socket only with
// the `vite-hmr` subprotocol and, when an Origin is sent, the server's token;
// a client that never connects fails on the timeout below, it cannot pass.

const TIMEOUT_MS = 5000

const writePublic = async (site, body) => {
    await fs.mkdir(path.join(site, 'public'), { recursive: true })
    await fs.writeFile(
        path.join(site, 'public', 'index.html'),
        `<!doctype html><title>t</title><p>${body}</p>`,
    )
}

// Resolves with the first message of `type` (and, when given, `path`) the
// socket receives, rejects after TIMEOUT_MS or on a socket error.
const nextMessage = (socket, type, path) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`no "${type}" message within ${TIMEOUT_MS} ms`)),
            TIMEOUT_MS,
        )
        const onMessage = (event) => {
            const message = JSON.parse(event.data)
            if (message.type !== type) return
            if (path !== undefined && message.path !== path) return
            clearTimeout(timer)
            socket.removeEventListener('message', onMessage)
            resolve(message)
        }
        socket.addEventListener('message', onMessage)
        socket.addEventListener('error', () => {
            clearTimeout(timer)
            reject(new Error('WebSocket error'))
        })
    })

describe('nera dev reload over the real Vite server', () => {
    let site, server, socket

    beforeEach(async () => {
        site = await fs.realpath(
            await fs.mkdtemp(path.join(os.tmpdir(), 'nera-dev-reload-')),
        )
        // A real site has a package.json; without one Vite puts its cache
        // (`.vite/deps_temp_*`) inside its root, public/, and the rebuild's
        // delete races it (ENOTEMPTY).
        await fs.writeFile(path.join(site, 'package.json'), '{}')
        await writePublic(site, 'before')
    })

    afterEach(async () => {
        socket?.close()
        await server?.close()
        socket = undefined
        server = undefined
        await fs.rm(site, { recursive: true, force: true })
    })

    it('delivers full-reload to a connected client after public/ is rebuilt', async () => {
        // Port 0: the OS picks a free port, never the 3000 a real `nera dev` may hold.
        server = await startServer(0, false, { root: path.join(site, 'public') })
        const { port } = server.httpServer.address()

        socket = new WebSocket(
            `ws://localhost:${port}/?token=${server.config.webSocketToken}`,
            'vite-hmr',
        )
        await nextMessage(socket, 'connected')

        const rebuild = createRebuilder({
            build: async () => {
                await fs.rm(path.join(site, 'public'), { recursive: true })
                await writePublic(site, 'after')
            },
            onBuilt: () => server.ws.send({ type: 'full-reload', path: '*' }),
        })
        // Vite's own polling watcher may also send `full-reload` (with the
        // changed file's path) when `public/` is recreated, but not reliably;
        // wait for the `path: '*'` one that `onBuilt` sends.
        const reload = nextMessage(socket, 'full-reload', '*')
        await rebuild()

        expect(await reload).toMatchObject({ type: 'full-reload', path: '*' })
        const page = await fetch(`http://localhost:${port}/`)
        expect(await page.text()).toContain('<p>after</p>')
    }, 3 * TIMEOUT_MS) // two waits of TIMEOUT_MS: our message, not vitest's, names the failure
})
