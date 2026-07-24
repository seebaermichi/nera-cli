#!/usr/bin/env node
import { runNew } from '../src/commands/new.js'
import { runBuild } from '../src/commands/build.js'
import { runDev } from '../src/commands/dev.js'
import { runServe } from '../src/commands/serve.js'
import { runUpdate } from '../src/commands/update.js'
import { runValidate } from '../src/commands/validate.js'

const [, , command, ...rest] = process.argv

const usage = `Nera — the static site generator CLI

Usage:
  nera new <name>    scaffold a new Nera site
  nera build         render pages/ → public/
  nera dev           build, serve and live-reload
  nera serve         serve the built public/ folder
  nera update        update Nera packages (or migrate a cloned site with --migrate)
  nera validate      check the site (layouts, includes, YAML) before publish
`

try {
    switch (command) {
    case 'new':
        await runNew(rest)
        break
    case 'build':
        await runBuild(rest)
        break
    case 'dev':
        await runDev(rest)
        break
    case 'serve':
        await runServe(rest)
        break
    case 'update':
        await runUpdate(rest)
        break
    case 'validate':
        process.exit(runValidate())
        break
    default:
        console.log(usage)
        // No command → help (exit 0); an unknown command → error (exit 1).
        process.exit(command ? 1 : 0)
    }
} catch (error) {
    console.error('❌', error.message)
    process.exit(1)
}
