#!/usr/bin/env node
import { runNew } from '../src/commands/new.js'
import { runBuild } from '../src/commands/build.js'
import { runDev } from '../src/commands/dev.js'
import { runServe } from '../src/commands/serve.js'
import { runUpdate } from '../src/commands/update.js'
import { runValidate } from '../src/commands/validate.js'
import { runCheck } from '../src/commands/check.js'
import { runPublish } from '../src/commands/publish.js'
import { runAdd } from '../src/commands/add.js'

const [, , command, ...rest] = process.argv
const json = rest.includes('--json')

// The long usage lines, one line each in the output: the AGENTS.md test
// looks a flag up on its command's usage line.
const NEW_HELP =
    'scaffold a new Nera site (--starter <name|package|github-url|./path> to start from a starter kit, ' +
    '--theme <name> to start from a theme, --name "<site name>", --lang <code>, --yes to never ask, ' +
    '--no-install to skip npm install; asks what you are building, or with --starter blog which blog, ' +
    'only on a terminal)'
const ADD_HELP =
    'add an official plugin: npm install it, copy its default config/<name>.yaml when the site has none, ' +
    'publish its templates (e.g. nera add sitemap; --json for machine-readable output)'
const PUBLISH_HELP =
    'publish the site through GitHub to GitHub Pages or Netlify (--target github-pages, the default, ' +
    'or --target netlify; without a target it asks on a terminal whether the site is for a business ' +
    'and recommends a host; --target <other> moves a published site and prints how to remove it from ' +
    'the old host; --domain <host> for a custom domain, --repo <name>, --private, --yes to never ask, ' +
    '--json, --sign-out to remove the stored GitHub and Netlify sign-ins)'

const usage = `Nera — the static site generator CLI

Usage:
  nera new <name>    ${NEW_HELP}
  nera new .         scaffold into the current, empty folder
  nera build         render pages/ → public/ (--check to check the output after, --json for machine-readable output)
  nera dev           build, serve and live-reload
  nera serve         serve the built public/ folder
  nera add <plugin>  ${ADD_HELP}
  nera update        update Nera packages (or migrate a cloned site with --migrate)
  nera validate      check the site (layouts, includes, YAML) before publish (--json for machine-readable output)
  nera check         check the built public/ (accessibility, privacy, legal hints) (--json for machine-readable output)
  nera publish       ${PUBLISH_HELP}
`

try {
    switch (command) {
        case 'new':
            await runNew(rest)
            break
        case 'build':
            process.exitCode = await runBuild(rest)
            break
        case 'dev':
            await runDev(rest)
            break
        case 'serve':
            await runServe(rest)
            break
        case 'add':
            process.exitCode = await runAdd(rest)
            break
        case 'update':
            await runUpdate(rest)
            break
        case 'validate':
            process.exitCode = runValidate({ json })
            break
        case 'check':
            process.exitCode = runCheck({ json })
            break
        case 'publish':
            process.exitCode = await runPublish(rest)
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
