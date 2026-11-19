import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { parse } from 'yaml'
import {
    netlify,
    ensureSite,
    checkCredits,
    applyDomain,
    monthStart,
    siteNameOf,
    BUDGET_NOTE,
    DEPLOY_CREDITS,
    FREE_CREDITS,
} from '../src/publish/netlify.js'
import { createNetlifyClient, NetlifyError } from '../src/publish/netlify-api.js'
import { createGitHubClient, GITHUB_API } from '../src/publish/github.js'
import { assertAdapter } from '../src/publish/targets.js'
import { renderWorkflow } from '../src/publish/workflow.js'
import { fakeNetlify } from './helpers/fake-netlify.js'
import { fakeResolver } from './helpers/fake-dns.js'
import { jsonResponse } from './helpers/fake-github.js'
import { NETLIFY_API } from '../src/publish/netlify-api.js'
import { NETLIFY_CLIENT_ID, NETLIFY_SIGN_IN, authorizeUrl } from '../src/publish/netlify-auth.js'

// The Netlify adapter of `nera publish` (ROADMAP-ai.md L6 step 4, plan D4–D6
// of the Netlify issue): the site, the credit estimate and the deploy job.
// Netlify is a stub (helpers/fake-netlify.js); the end-to-end run through
// publishSite is in publish.test.js. Fake tokens only.

const TOKEN = 'nfp_fake_netlify_token'
const NOW = Date.UTC(2026, 10, 17, 12)

const clientFor = (host) => createNetlifyClient({ token: TOKEN, fetch: host.fetch })
const recorder = () => {
    const lines = []
    return { lines, log: (line) => lines.push(line) }
}

describe('the netlify adapter', () => {
    it('has the adapter interface', () => {
        expect(assertAdapter(netlify)).toBe(netlify)
        expect(netlify).toMatchObject({ id: 'netlify', label: 'Netlify' })
    })

    it('liveUrl before setUp in the same run is an error, not a guess', async () => {
        await expect(netlify.liveUrl({})).rejects.toThrow('has not been set up in this run')
    })
})

describe('siteNameOf', () => {
    it('makes a repository name a DNS label of netlify.app', () => {
        expect(siteNameOf('my-site')).toBe('my-site')
        expect(siteNameOf('My_Site.v2')).toBe('my-site-v2')
        expect(siteNameOf('--x--')).toBe('x')
        expect(siteNameOf('___')).toBe('nera-site')
        expect(siteNameOf('a'.repeat(70))).toHaveLength(63)
        expect(siteNameOf(`${'a'.repeat(62)}-b`)).toBe('a'.repeat(62))
    })
})

describe('ensureSite', () => {
    it('creates the site named after the repository, with no repository link', async () => {
        const host = fakeNetlify({ token: TOKEN })
        const { lines, log } = recorder()
        const { site, created } = await ensureSite({ client: clientFor(host), name: 'My_Site', log })
        expect(created).toBe(true)
        expect(site).toMatchObject({ id: 'site-1', name: 'my-site' })
        const create = host.requests.find(({ init }) => init.method === 'POST')
        expect(JSON.parse(create.init.body)).toEqual({ name: 'my-site' })
        expect(lines).toEqual(['Created the Netlify site my-site.'])
    })

    it('a taken name gets a random suffix', async () => {
        const host = fakeNetlify({ token: TOKEN, taken: ['my-site'] })
        const { lines, log } = recorder()
        const { site } = await ensureSite({ client: clientFor(host), name: 'my-site', log, random: () => 'k3x9q2' })
        expect(site.name).toBe('my-site-k3x9q2')
        expect(lines[0]).toBe('The Netlify site name my-site is taken; trying another.')
    })

    it('a long taken name is cut so the suffixed name still fits 63 characters', async () => {
        const long = 'a'.repeat(63)
        const host = fakeNetlify({ token: TOKEN, taken: [long] })
        const { site } = await ensureSite({ client: clientFor(host), name: long, log: () => {}, random: () => 'k3x9q2' })
        expect(site.name).toBe(`${'a'.repeat(56)}-k3x9q2`)
    })

    it('gives up after three refused names', async () => {
        const host = fakeNetlify({ token: TOKEN, taken: ['my-site', 'my-site-aaaaaa', 'my-site-bbbbbb'] })
        const suffixes = ['aaaaaa', 'bbbbbb']
        await expect(ensureSite({ client: clientFor(host), name: 'my-site', log: () => {}, random: () => suffixes.shift() }))
            .rejects.toThrow('Netlify refused 3 names for the site, starting with my-site.')
    })

    it('reuses the site that site_id names', async () => {
        const host = fakeNetlify({ token: TOKEN, sites: { abc: { id: 'abc', name: 'kept-site' } } })
        const { lines, log } = recorder()
        const { site, created } = await ensureSite({ client: clientFor(host), siteId: 'abc', name: 'my-site', log })
        expect(created).toBe(false)
        expect(site.id).toBe('abc')
        expect(host.events).toEqual([])
        expect(lines).toEqual(['Using the Netlify site kept-site.'])
    })

    it('a site_id Netlify no longer has: a new site, said so', async () => {
        const host = fakeNetlify({ token: TOKEN })
        const { lines, log } = recorder()
        const { site, created } = await ensureSite({ client: clientFor(host), siteId: 'gone', name: 'my-site', log })
        expect(created).toBe(true)
        expect(site.id).toBe('site-1')
        expect(lines[0]).toBe('Netlify has no site gone (named in config/publish.yaml) for this account; creating a new one.')
    })

    it('any other refusal goes through, without the token', async () => {
        const host = fakeNetlify({ token: 'nfp_other_token' })
        const error = await ensureSite({ client: clientFor(host), siteId: 'abc', name: 'x', log: () => {} }).catch((err) => err)
        expect(error).toBeInstanceOf(NetlifyError)
        expect(error.status).toBe(401)
        expect(error.message).not.toContain(TOKEN)
    })
})

describe('applyDomain', () => {
    const SITE = { id: 'abc', name: 'my-site', url: 'http://my-site.netlify.app', ssl_url: 'https://my-site.netlify.app' }
    async function apply(domain, { site = SITE, records, usedDomains } = {}) {
        const host = fakeNetlify({ token: TOKEN, sites: { abc: { ...site } }, usedDomains })
        const resolver = fakeResolver(records)
        const { lines, log } = recorder()
        const result = await applyDomain({ client: clientFor(host), site, domain, resolver, log })
        return { result, lines, host, resolver }
    }

    it('sets the custom domain through the API and reports the apex record of Netlify\'s load balancer', async () => {
        const { result, lines, host, resolver } = await apply('example.com')
        expect(host.events).toEqual(['update site my-site {"custom_domain":"example.com"}'])
        expect(result).toMatchObject({ id: 'abc', custom_domain: 'example.com' })
        expect(resolver.lookups.sort()).toEqual(['A example.com', 'AAAA example.com', 'CNAME example.com'])
        expect(lines).toEqual([
            'Setting the custom domain example.com for the Netlify site my-site…',
            'DNS for example.com is not set up yet: it has no records. Set these records at your DNS provider:',
            '  A  example.com  75.2.60.5',
            'DNS changes can take a few hours to spread; the publish goes on, and every nera publish checks again.',
            'Netlify issues the HTTPS certificate for example.com by itself once the DNS records point to it.',
        ])
    })

    it('a subdomain: a CNAME to <site>.netlify.app', async () => {
        const { lines } = await apply('www.example.com')
        expect(lines).toContain('  CNAME  www.example.com  my-site.netlify.app')
    })

    it('a site that already has the domain is not changed; its DNS is checked again', async () => {
        const { lines, host } = await apply('www.example.com', {
            site: { ...SITE, custom_domain: 'WWW.Example.com' },
            records: { CNAME: ['my-site.netlify.app'] },
        })
        expect(host.events).toEqual([])
        expect(lines).toEqual(['DNS for www.example.com is set up: it points to Netlify.'])
    })

    it('without --domain, a custom domain the site has is checked; none: nothing is looked up', async () => {
        const kept = await apply(undefined, { site: { ...SITE, custom_domain: 'example.com' }, records: { A: ['75.2.60.5'] } })
        expect(kept.lines).toEqual(['DNS for example.com is set up: it points to Netlify.'])
        const none = await apply(undefined)
        expect(none.resolver.lookups).toEqual([])
        expect(none.lines).toEqual([])
        expect(none.result).toEqual(SITE)
    })

    it('a domain another site uses (422): a clear message, no DNS check', async () => {
        const used = fakeNetlify({ token: TOKEN, sites: { abc: { ...SITE } }, usedDomains: ['example.com'] })
        const lookups = fakeResolver()
        const error = await applyDomain({ client: clientFor(used), site: SITE, domain: 'example.com', resolver: lookups, log: () => {} })
            .catch((err) => err)
        expect(error).toBeInstanceOf(NetlifyError)
        expect(error.status).toBe(422)
        expect(error.message).toMatch(/^Netlify refused the custom domain example\.com \(.*\)\. It may be set on another Netlify site: remove it there under Domain management, or pass another --domain\.$/)
        expect(error.message).not.toContain(TOKEN)
        expect(lookups.lookups).toEqual([])
    })

    it('any other refusal goes through unchanged', async () => {
        const host = fakeNetlify({ token: TOKEN })
        const error = await applyDomain({ client: clientFor(host), site: SITE, domain: 'example.com', resolver: fakeResolver(), log: () => {} })
            .catch((err) => err)
        expect(error.status).toBe(404)
        expect(error.message).toContain('Netlify answered 404 to PATCH /sites/abc')
    })
})

describe('netlify.setUp with --domain, and liveUrl', () => {
    // A GitHub that takes the two repository secrets; Netlify is the stub.
    const github = () => createGitHubClient({
        token: 'ghu_fake_access_token',
        fetch: async (url, init) => {
            const route = `${init.method} ${url.slice(GITHUB_API.length)}`
            if (route === 'GET /repos/octo/site/actions/secrets/public-key') {
                return jsonResponse(200, { key_id: 'fake-key-id', key: Buffer.alloc(32, 9).toString('base64') })
            }
            if (route.startsWith('PUT /repos/octo/site/actions/secrets/')) return jsonResponse(201)
            return jsonResponse(404, { message: 'Not Found' })
        },
    })

    let site
    beforeEach(async () => {
        site = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-publish-netlify-'))
        await fs.mkdir(path.join(site, 'config'))
        await fs.writeFile(path.join(site, 'config/app.yaml'), 'lang: en\nbase_path: /site\n')
    })
    afterEach(async () => {
        await fs.rm(site, { recursive: true, force: true })
    })

    // `overrides` replace fields of the host context.
    async function setUp(options, netlifyHost = fakeNetlify({ token: TOKEN }), overrides = {}) {
        const { lines, log } = recorder()
        const host = {
            cwd: site,
            client: github(),
            repository: { repository: 'octo/site', owner: 'octo', name: 'site' },
            options,
            config: {},
            log,
            resolver: fakeResolver({ CNAME: ['site.netlify.app'] }),
            fetch: netlifyHost.fetch,
            now: () => NOW,
            readNetlifyToken: async () => ({ accessToken: TOKEN, source: 'env' }),
            ...overrides,
        }
        const result = await netlify.setUp(host)
        return { host, result, lines, netlifyHost }
    }

    it('sets the domain after the site exists and base_path is gone; liveUrl is https://<domain>/', async () => {
        const { host, result, lines, netlifyHost } = await setUp({ domain: 'www.example.com' })
        expect(netlifyHost.events).toEqual(['create site site', 'update site site {"custom_domain":"www.example.com"}'])
        expect(result.custom_domain).toBe('www.example.com')
        expect(await fs.readFile(path.join(site, 'config/app.yaml'), 'utf-8')).toBe('lang: en\n')
        expect(lines).toContain('DNS for www.example.com is set up: it points to Netlify.')
        await expect(netlify.liveUrl(host)).resolves.toBe('https://www.example.com/')
    })

    it('a new sign-in reports its action_required and action_done events to the host context\'s emit', async () => {
        const TICKET_ID = 'fake_ticket_7d3b'
        const netlifyHost = fakeNetlify({ token: TOKEN })
        const api = netlifyHost.fetch
        netlifyHost.fetch = async (url, init) => {
            if (url === `${NETLIFY_API}/oauth/tickets?client_id=${NETLIFY_CLIENT_ID}`) return jsonResponse(201, { id: TICKET_ID, authorized: false })
            if (url === `${NETLIFY_API}/oauth/tickets/${TICKET_ID}`) return jsonResponse(200, { id: TICKET_ID, authorized: true })
            if (url === `${NETLIFY_API}/oauth/tickets/${TICKET_ID}/exchange`) return jsonResponse(201, { access_token: TOKEN })
            return api(url, init)
        }
        const events = []
        await setUp({}, netlifyHost, {
            readNetlifyToken: async () => null,
            saveNetlifyToken: async () => ({ store: 'keychain' }),
            sleep: async () => {},
            emit: (event) => events.push(event),
        })
        expect(events).toEqual([
            { event: 'action_required', action: { kind: NETLIFY_SIGN_IN, url: authorizeUrl(TICKET_ID) } },
            { event: 'action_done', kind: NETLIFY_SIGN_IN },
        ])
    })

    it('a valid token needs no sign-in: no event', async () => {
        const events = []
        await setUp({}, undefined, { emit: (event) => events.push(event) })
        expect(events).toEqual([])
    })

    it('without --domain, liveUrl is the site\'s netlify.app address', async () => {
        const { host, lines } = await setUp({})
        expect(lines.join('\n')).not.toContain('DNS')
        await expect(netlify.liveUrl(host)).resolves.toBe('https://site.netlify.app')
    })
})

describe('checkCredits', () => {
    const production = (created_at, overrides = {}) => ({ context: 'production', state: 'ready', created_at, ...overrides })
    const thisMonth = (n) => Array.from({ length: n }, (_, i) => production(new Date(Date.UTC(2026, 10, 1 + (i % 16), 8)).toISOString()))

    async function check(deploys, now = NOW) {
        const host = fakeNetlify({ token: TOKEN, deploys })
        const { lines, log } = recorder()
        const result = await checkCredits({ client: clientFor(host), siteId: 'abc', now: () => now, log })
        return { result, lines, host }
    }

    it('15 production deploys this month: no warning', async () => {
        const { result, lines } = await check(thisMonth(15))
        expect(result).toEqual({ deploys: 15, credits: 15 * DEPLOY_CREDITS })
        expect(lines).toEqual([])
    })

    it('16 production deploys (80 % of the budget): a warning that counts no bandwidth', async () => {
        const { result, lines } = await check(thisMonth(16))
        expect(result).toEqual({ deploys: 16, credits: 240 })
        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain(`this site had 16 production deploys this month (UTC), about 240 of the free plan's ${FREE_CREDITS} credits`)
        expect(lines[0]).toContain('Bandwidth and your other Netlify sites are not counted')
    })

    it('deploy previews, branch deploys, failed deploys and last month do not count', async () => {
        const deploys = [
            ...thisMonth(15),
            production('2026-11-10T00:00:00Z', { context: 'deploy-preview' }),
            production('2026-11-10T00:00:00Z', { context: 'branch-deploy' }),
            production('2026-11-10T00:00:00Z', { state: 'error' }),
            production('2026-10-31T23:59:59Z'),
        ]
        const { result, lines } = await check(deploys)
        expect(result.deploys).toBe(15)
        expect(lines).toEqual([])
    })

    it('the month starts at 00:00 UTC on the first, whatever the local time zone', async () => {
        expect(monthStart(Date.UTC(2026, 10, 1, 0, 0, 0))).toBe(Date.UTC(2026, 10, 1))
        expect(monthStart(Date.UTC(2026, 10, 30, 23, 59, 59))).toBe(Date.UTC(2026, 10, 1))
        expect(monthStart(Date.UTC(2027, 0, 1, 0, 0, 1))).toBe(Date.UTC(2027, 0, 1))
        const deploys = [production('2026-11-30T23:59:59Z'), production('2026-12-01T00:00:00Z')]
        const { result } = await check(deploys, Date.UTC(2026, 11, 1, 0, 0, 1))
        expect(result.deploys).toBe(1)
    })

    it('asks for production deploys only, at most a page of 100', async () => {
        const { host } = await check([])
        expect(host.events).toEqual(['list deploys production=true&per_page=100'])
    })

    it('a failing deploys call: a short note, null, no throw', async () => {
        const { result, lines } = await check(500)
        expect(result).toBeNull()
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatch(/^Could not count this month's Netlify deploys \(Netlify answered 500 .*\); the credit estimate is skipped and the publish goes on\.$/)
    })

    it('an answer that is not a list: a short note, null', async () => {
        const { result, lines } = await check({ message: 'odd' })
        expect(result).toBeNull()
        expect(lines[0]).toContain('the credit estimate is skipped and the publish goes on')
    })

    it('the budget note names the budget, the deploy cost and the warning share', () => {
        expect(BUDGET_NOTE).toContain('300 credits a month')
        expect(BUDGET_NOTE).toContain('costs 15')
        expect(BUDGET_NOTE).toContain('about 20 deploys')
        expect(BUDGET_NOTE).toContain('warns at 80 %')
    })
})

// The deploy job of the rendered workflow, and its deploy step's shell.
const deploy = async () => parse(await renderWorkflow(netlify)).jobs.deploy
const script = async () => (await deploy()).steps[1].run

describe('the deploy job', () => {
    it('downloads the built site and deploys it with the secrets from env:, no extra permission', async () => {
        const job = await deploy()
        expect(job.needs).toBe('build')
        expect(job.permissions).toEqual({ contents: 'read' })
        expect(job.steps[0]).toEqual({
            name: 'Download the built site',
            uses: 'actions/download-artifact@v8',
            with: { name: 'site', path: 'public' },
        })
        expect(job.steps[1].name).toBe('Deploy to Netlify')
        expect(job.steps[1].env).toEqual({
            NETLIFY_AUTH_TOKEN: '${{ secrets.NETLIFY_AUTH_TOKEN }}',
            NETLIFY_SITE_ID: '${{ secrets.NETLIFY_SITE_ID }}',
        })
        expect(job.steps.some((step) => step.uses && !step.uses.startsWith('actions/'))).toBe(false)
    })

    it('holds no token literal and no ${{ }} expression in the shell', async () => {
        const run = await script()
        expect(run).not.toContain('${{')
        expect(run).not.toContain(TOKEN)
        expect(run).not.toMatch(/netlify-cli|npx/)
        expect(run).toContain('auth="Authorization: Bearer $NETLIFY_AUTH_TOKEN"')
        expect(run).toContain('"$api/sites/$NETLIFY_SITE_ID/deploys"')
    })

    it('fails on errors: set -euo pipefail, non-2xx answers, a deploy in state error, a bounded poll', async () => {
        const run = await script()
        expect(run.startsWith('set -euo pipefail\n')).toBe(true)
        expect(run).toContain('if [ "$1" -lt 200 ] || [ "$1" -ge 300 ]; then')
        expect(run).toContain('check "$code" \'the upload\'')
        expect(run).toContain('check "$code" \'the deploy poll\'')
        expect(run).toMatch(/error\)\n\s+echo "::error::Netlify could not deploy the site: .*"\n\s+exit 1/)
        expect(run).toContain('for _ in $(seq 1 60); do')
        expect(run).toMatch(/done\necho '::error::The Netlify deploy did not finish within 5 minutes\.'\nexit 1\n$/)
        expect(run).toContain('-H \'Content-Type: application/zip\' --data-binary @site.zip')
    })

    it('the shell is valid bash', async () => {
        const result = spawnSync('bash', ['-n'], { input: await script(), encoding: 'utf-8' })
        expect(result.stderr).toBe('')
        expect(result.status).toBe(0)
    })
})

// The deploy step's shell, run for real with bash, zip and jq, against a
// fake `curl` that answers from a list and a `sleep` that returns at once.
const hasTools = ['zip', 'jq'].every((tool) => spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0)

describe.skipIf(!hasTools)('the deploy step, run against a fake curl', () => {
    // Run the step with `answers` (`[status, body]` per curl call, in order)
    // in a temp folder holding a built `public/`. Resolves the exit status,
    // the output and each curl call's arguments.
    async function runStep(answers) {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-netlify-step-'))
        try {
            const bin = path.join(dir, 'bin')
            await fs.mkdir(bin)
            await fs.mkdir(path.join(dir, 'public'))
            await fs.writeFile(path.join(dir, 'public', 'index.html'), '<h1>Hi</h1>\n')
            const answersDir = path.join(dir, 'answers')
            await fs.mkdir(answersDir)
            for (const [i, [status, body]] of answers.entries()) {
                await fs.writeFile(path.join(answersDir, `${i}.status`), String(status))
                await fs.writeFile(path.join(answersDir, `${i}.json`), JSON.stringify(body))
            }
            // Each call: log the arguments, copy the next answer's body to the
            // -o file and print its status, like -w '%{http_code}'. Shell
            // builtins only besides cp, so the 61-call poll test stays fast.
            await fs.writeFile(path.join(bin, 'curl'), `#!/bin/sh
n=0
if [ -f "$CALLS.n" ]; then read -r n < "$CALLS.n"; fi
echo $((n + 1)) > "$CALLS.n"
printf '%s\\n' "$*" >> "$CALLS"
out=''
while [ $# -gt 0 ]; do
    if [ "$1" = '-o' ]; then out="$2"; fi
    shift
done
cp "$ANSWERS/$n.json" "$out"
read -r code < "$ANSWERS/$n.status"
printf '%s' "$code"
`, { mode: 0o755 })
            await fs.writeFile(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
            const result = spawnSync('bash', ['-c', await script()], {
                cwd: dir,
                encoding: 'utf-8',
                env: {
                    PATH: `${bin}:${process.env.PATH}`,
                    CALLS: path.join(dir, 'calls'),
                    ANSWERS: path.join(dir, 'answers'),
                    NETLIFY_AUTH_TOKEN: TOKEN,
                    NETLIFY_SITE_ID: 'site-1',
                },
            })
            const calls = (await fs.readFile(path.join(dir, 'calls'), 'utf-8').catch(() => '')).split('\n').filter(Boolean)
            const zipped = await fs.stat(path.join(dir, 'site.zip')).then(() => true, () => false)
            return { status: result.status, output: result.stdout + result.stderr, calls, zipped }
        } finally {
            await fs.rm(dir, { recursive: true, force: true })
        }
    }

    it('uploads the zip, polls until ready and prints the address', async () => {
        const { status, output, calls, zipped } = await runStep([
            [200, { id: 'dep-1', state: 'uploaded' }],
            [200, { id: 'dep-1', state: 'processing' }],
            [200, { id: 'dep-1', state: 'ready', ssl_url: 'https://my-site.netlify.app' }],
        ])
        expect(status).toBe(0)
        expect(zipped).toBe(true)
        expect(output).toContain('Deployed to https://my-site.netlify.app')
        expect(calls).toHaveLength(3)
        expect(calls[0]).toContain('-X POST')
        expect(calls[0]).toContain('https://api.netlify.com/api/v1/sites/site-1/deploys')
        expect(calls[1]).toContain('https://api.netlify.com/api/v1/deploys/dep-1')
    })

    it('a non-2xx upload fails with Netlify\'s message and no poll', async () => {
        const { status, output, calls } = await runStep([[401, { code: 401, message: 'Access Denied' }]])
        expect(status).toBe(1)
        expect(output).toContain('::error::Netlify answered 401 to the upload: Access Denied')
        expect(calls).toHaveLength(1)
        expect(output).not.toContain(TOKEN)
    })

    it('a deploy in state error fails with its reason', async () => {
        const { status, output } = await runStep([
            [200, { id: 'dep-1' }],
            [200, { id: 'dep-1', state: 'error', error_message: 'Upload too large' }],
        ])
        expect(status).toBe(1)
        expect(output).toContain('::error::Netlify could not deploy the site: Upload too large')
    })

    it('a failing poll fails the step', async () => {
        const { status, output } = await runStep([[200, { id: 'dep-1' }], [503, { message: 'Unavailable' }]])
        expect(status).toBe(1)
        expect(output).toContain('::error::Netlify answered 503 to the deploy poll: Unavailable')
    })

    it('an upload answer without an id fails', async () => {
        const { status, output } = await runStep([[200, {}]])
        expect(status).toBe(1)
        expect(output).toContain('::error::Netlify sent no deploy id for the upload.')
    })

    it('a deploy that never finishes fails after the bounded poll', async () => {
        const pending = Array.from({ length: 60 }, () => [200, { id: 'dep-1', state: 'processing' }])
        const { status, output, calls } = await runStep([[200, { id: 'dep-1' }], ...pending])
        expect(status).toBe(1)
        expect(calls).toHaveLength(61)
        expect(output).toContain('::error::The Netlify deploy did not finish within 5 minutes.')
    }, 60_000) // 61 polls, each starting curl and jq
})

describe('netlify.leftBehind', () => {
    const repository = { repository: 'octo/site', owner: 'octo', name: 'site' }
    const secrets = 'The repository secrets NETLIFY_AUTH_TOKEN and NETLIFY_SITE_ID are no longer used; delete them at https://github.com/octo/site/settings/secrets/actions'
    const domainNote = 'If the site has a custom domain, it still points to Netlify until its DNS records change: run nera publish --domain <your domain> to set it on the new host and list the records.'

    // A fetch that fails the test when anything calls it: the hint is offline.
    const calls = []
    const fetch = async (...args) => {
        calls.push(args)
        throw new Error('leftBehind must not call the network')
    }
    beforeEach(() => {
        calls.length = 0
    })

    it('names the stored site, the unused secrets and the custom domain, without calling Netlify', async () => {
        const lines = await netlify.leftBehind({
            repository,
            config: { target: 'netlify', netlify: { site_id: 'site-1' } },
            options: {},
            fetch,
            readNetlifyToken: async () => ({ accessToken: TOKEN, source: 'env' }),
        })
        expect(lines).toEqual([
            'The Netlify site site-1 is still online. To remove it, delete it in its settings at https://app.netlify.com (General → Danger zone).',
            secrets,
            domainNote,
        ])
        expect(calls).toEqual([])
        expect(lines.join('\n')).not.toContain(TOKEN)
    })

    it('without a stored site_id, names the site by the repository; with --domain, points to the DNS check', async () => {
        const lines = await netlify.leftBehind({ repository, config: {}, options: { domain: 'www.example.com' }, fetch })
        expect(lines).toEqual([
            'The Netlify site octo/site deployed to is still online. To remove it, delete it in its settings at https://app.netlify.com (General → Danger zone).',
            secrets,
            'www.example.com is now set on the new host; the DNS check above says whether its records still point to Netlify.',
        ])
        expect(calls).toEqual([])
    })
})
