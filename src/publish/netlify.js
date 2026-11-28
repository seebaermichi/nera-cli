import { randomBytes } from 'node:crypto'
import { slugify } from '@nera-static/plugin-utils'
import { checkDns, movedDomainNote, reportDns } from './dns.js'
import { createNetlifyClient, NetlifyError, NETLIFY_API } from './netlify-api.js'
import { ensureNetlifyToken } from './netlify-auth.js'
import { APP_CONFIG, writeBasePath } from './pages.js'
import { setRepositorySecrets } from './secrets.js'
import { PUBLISH_CONFIG, writePublishConfig } from './site-config.js'
import { BUILD_ARTIFACT, BUILD_OUTPUT } from './workflow.js'

// The Netlify target of `nera publish`. GitHub Actions builds the site as for
// every target; the deploy job uploads `public/` to Netlify's zip deploy API
// with the repository secrets below, so Netlify's own build never runs. The
// site is created through the API with no repository link. Every Netlify call
// goes through netlify-api.js and every GitHub call through the host
// context's client, so tests stub `fetch` and use no network.

// The repository secrets the deploy job reads.
export const TOKEN_SECRET = 'NETLIFY_AUTH_TOKEN'
export const SITE_SECRET = 'NETLIFY_SITE_ID'

// Netlify's free-plan budget (verified 2026-11-17): credits a month, what
// one successful production deploy costs, and the share of the budget at
// which nera publish warns that this month's credits may run out.
export const FREE_CREDITS = 300
export const DEPLOY_CREDITS = 15
export const WARN_SHARE = 0.8

// A site name is a DNS label of `<name>.netlify.app`: lower-case letters,
// digits and `-`, at most 63 characters. A taken name gets a random suffix;
// after NAME_TRIES refusals the set-up gives up.
const NAME_MAX = 63
const SUFFIX_LENGTH = 6
const NAME_TRIES = 3
const FALLBACK_NAME = 'nera-site'
// What Netlify answers a site name that is taken.
const NAME_TAKEN = 422

// Netlify's load balancer, the A record of a custom apex domain (Netlify's
// docs, "Configure external DNS for a custom domain"); it has no AAAA one.
export const NETLIFY_A = ['75.2.60.5']
// What Netlify answers a custom domain it refuses, e.g. one another site uses.
const DOMAIN_REFUSED = 422

// The deploy job's poll of the uploaded deploy: seconds between polls and
// the number of polls, so a deploy that never finishes fails after ~5 minutes.
const DEPLOY_POLL_SECONDS = 5
const DEPLOY_POLL_TRIES = 60
// curl's limit for the upload and for one poll, in seconds.
const UPLOAD_TIMEOUT = 600
const POLL_TIMEOUT = 30

// What this run's setUp resolved for a host context: the Netlify client and
// the site, for liveUrl. Keyed by the context, so nothing outlives the run.
const sessions = new WeakMap()

// Six random lower-case letters and digits.
function randomSuffix() {
    return [...randomBytes(SUFFIX_LENGTH)].map((byte) => (byte % 36).toString(36)).join('')
}

// `name` (the repository's name) as a Netlify site name: the shared slug
// (accents dropped, `ß` → `ss`, every run of other characters one `-`, no `-`
// at either end), at most `max` characters; FALLBACK_NAME when nothing is left.
export function siteNameOf(name, max = NAME_MAX) {
    return slugify(name).slice(0, max).replace(/-+$/, '') || FALLBACK_NAME
}

// The site Netlify describes, checked to have the id the deploy needs.
function checkedSite(site, what) {
    if (typeof site?.id !== 'string' || site.id === '') {
        throw new NetlifyError(`Netlify sent no site id ${what}.`)
    }
    return site
}

// The Netlify site to deploy to: the one `siteId` names while Netlify
// still has it, otherwise a new site named after `name` with no repository
// link. A taken name (422) is retried with a random suffix from `random()`.
// Resolves `{ site, created }`.
export async function ensureSite({ client, siteId, name, log, random = randomSuffix }) {
    if (siteId) {
        try {
            const site = checkedSite(await client.get(`/sites/${encodeURIComponent(siteId)}`), `for ${siteId}`)
            log(`Using the Netlify site ${site.name ?? site.id}.`)
            return { site, created: false }
        } catch (err) {
            if (!(err instanceof NetlifyError && err.status === 404)) throw err
            log(`Netlify has no site ${siteId} (named in ${PUBLISH_CONFIG}) for this account; creating a new one.`)
        }
    }

    const base = siteNameOf(name)
    for (let attempt = 0; attempt < NAME_TRIES; attempt++) {
        const candidate = attempt === 0 ? base : `${siteNameOf(base, NAME_MAX - SUFFIX_LENGTH - 1)}-${random()}`
        try {
            const site = checkedSite(await client.post('/sites', { name: candidate }), 'for the new site')
            log(`Created the Netlify site ${site.name ?? candidate}.`)
            return { site, created: true }
        } catch (err) {
            if (!(err instanceof NetlifyError && err.status === NAME_TAKEN)) throw err
            log(`The Netlify site name ${candidate} is taken; trying another.`)
        }
    }
    throw new NetlifyError(
        `Netlify refused ${NAME_TRIES} names for the site, starting with ${base}. ` +
            'Run nera publish again, or rename the repository with --repo <name>.',
    )
}

// The first instant of `now`'s calendar month in UTC, as milliseconds.
export function monthStart(now) {
    const date = new Date(now)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

// What a first set-up says once about the free-plan budget.
export const BUDGET_NOTE =
    `Netlify's free plan has ${FREE_CREDITS} credits a month. Each production deploy costs ${DEPLOY_CREDITS}, ` +
    `so about ${FREE_CREDITS / DEPLOY_CREDITS} deploys use it all, and bandwidth comes on top. ` +
    'When the credits run out, Netlify pauses your sites until the next month. ' +
    'Every nera publish and every push to main is one deploy, so publish when a batch of changes is ready. ' +
    `nera publish warns at ${WARN_SHARE * 100} % of the budget.`

// Estimate this month's credits from the site's successful production
// deploys since the start of the UTC month: deploy previews, branch
// deploys and failed deploys cost nothing. At WARN_SHARE of FREE_CREDITS or
// more, log a warning. Bandwidth and the team's other sites are not counted,
// and the warning says so. Never throws for Netlify: a failed call logs a
// short note and resolves null. Resolves `{ deploys, credits }` otherwise.
export async function checkCredits({ client, siteId, now = Date.now, log }) {
    let deploys
    try {
        deploys = await client.get(`/sites/${encodeURIComponent(siteId)}/deploys?production=true&per_page=100`)
    } catch (err) {
        if (!(err instanceof NetlifyError)) throw err
        log(
            `Could not count this month's Netlify deploys (${err.message}); ` +
                'the credit estimate is skipped and the publish goes on.',
        )
        return null
    }
    if (!Array.isArray(deploys)) {
        log('Netlify sent no list of deploys; the credit estimate is skipped and the publish goes on.')
        return null
    }
    const since = monthStart(now())
    const count = deploys.filter((deploy) =>
        deploy?.context === 'production'
        && deploy.state === 'ready'
        && Date.parse(deploy.created_at) >= since).length
    const credits = count * DEPLOY_CREDITS
    if (credits >= FREE_CREDITS * WARN_SHARE) {
        log(
            `Netlify credits: this site had ${count} production deploys this month (UTC), ` +
                `about ${credits} of the free plan's ${FREE_CREDITS} credits, ` +
                `and this publish adds ${DEPLOY_CREDITS}. ` +
                'Bandwidth and your other Netlify sites are not counted and come on top. ' +
                'When the credits run out, Netlify pauses your sites until the next month. ' +
                'On a paid plan, ignore this.',
        )
    }
    return { deploys: count, credits }
}

// Netlify as the DNS check (dns.js) expects it for `site`: a
// subdomain's CNAME names `<site>.netlify.app`, an apex domain has the A
// record of Netlify's load balancer. Netlify issues the certificate itself.
export function netlifyDns(site) {
    if (typeof site?.name !== 'string' || site.name === '') {
        throw new NetlifyError(`Netlify sent no name for the site ${site?.id}, so its DNS records cannot be named.`)
    }
    return { name: 'Netlify', cname: `${site.name}.netlify.app`, a: NETLIFY_A, aaaa: [] }
}

// `--domain` for Netlify: make `domain` the custom domain of `site`
// through the API unless it already is, then, when the site has a custom
// domain, check its DNS and report the records to set. Netlify's refusal
// (422, e.g. a domain another site uses) becomes a NetlifyError that says
// what to do. Resolves the site as Netlify describes it after the change.
export async function applyDomain({ client, site, domain, resolver, log }) {
    let next = site
    if (domain && domain !== site.custom_domain?.toLowerCase()) {
        log(`Setting the custom domain ${domain} for the Netlify site ${site.name ?? site.id}…`)
        try {
            next = checkedSite(await client.patch(`/sites/${encodeURIComponent(site.id)}`, { custom_domain: domain }), 'for the custom domain')
        } catch (err) {
            if (!(err instanceof NetlifyError && err.status === DOMAIN_REFUSED)) throw err
            throw new NetlifyError(
                `Netlify refused the custom domain ${domain} (${err.message}). ` +
                    'It may be set on another Netlify site: remove it there under Domain management, ' +
                    'or pass another --domain.',
                { status: err.status },
            )
        }
    }
    if (next.custom_domain) {
        const dns = await checkDns({ domain: next.custom_domain.toLowerCase(), service: netlifyDns(next), resolver })
        reportDns(dns, log)
        if (!dns.ok) {
            log(`Netlify issues the HTTPS certificate for ${dns.domain} by itself once the DNS records point to it.`)
        }
    }
    return next
}

// Prepare Netlify before the first push: sign in (netlify-auth.js), create
// or reuse the site and record its id in config/publish.yaml, remove
// `base_path` (Netlify serves from the root), set `--domain` (`options.domain`)
// and check the custom domain's DNS, store the token and the site id as
// encrypted repository secrets (written every run, since the token may have
// changed), then print the budget note on a first set-up or the credit
// warning on a later one. Resolves the site as Netlify describes it.
// The host context is publishSite's; Netlify-specific collaborators on it:
// `resolver` (dns.js), `fetch`, `sleep`/`now`, `open`,
// `readNetlifyToken`/`saveNetlifyToken` (credentials.js, account netlify)
// and `emit`, the sign-in's events (netlify-auth.js).
async function setUp(host) {
    const {
        client: github,
        repository,
        config = {},
        interactive = false,
        options = {},
        cwd = process.cwd(),
        log = (line) => console.log(line),
        emit,
        resolver,
        fetch = globalThis.fetch,
        sleep,
        now = Date.now,
        open,
        readNetlifyToken,
        saveNetlifyToken,
    } = host
    const tokens = await ensureNetlifyToken({
        readToken: readNetlifyToken,
        saveToken: saveNetlifyToken,
        fetch,
        sleep,
        now,
        open,
        tty: interactive,
        log,
        emit,
    })
    const client = createNetlifyClient({ token: tokens.accessToken, fetch })

    const siteId = config.netlify?.site_id
    const ensured = await ensureSite({ client, siteId, name: repository.name, log })
    if (ensured.site.id !== siteId) await writePublishConfig({ netlify: { site_id: ensured.site.id } }, cwd)
    if (await writeBasePath(cwd, '')) {
        log(`Removed base_path from ${APP_CONFIG}: Netlify serves the site from the root.`)
    }
    const site = await applyDomain({ client, site: ensured.site, domain: options.domain, resolver, log })

    await setRepositorySecrets(github, repository, { [TOKEN_SECRET]: tokens.accessToken, [SITE_SECRET]: site.id })
    log(`Stored ${TOKEN_SECRET} and ${SITE_SECRET} as encrypted secrets of ${repository.repository}.`)

    if (ensured.created) log(BUDGET_NOTE)
    else await checkCredits({ client, siteId: site.id, now, log })

    sessions.set(host, { client, site })
    return site
}

// The site's address as Netlify reports it now: `https://<custom domain>/`
// once the site has one (Netlify issues its certificate itself), else
// `ssl_url`, else `url`.
async function liveUrl(host) {
    const session = sessions.get(host)
    if (!session) throw new Error('The Netlify target has not been set up in this run.')
    const site = await session.client.get(`/sites/${encodeURIComponent(session.site.id)}`)
    const url = site?.custom_domain ? `https://${site.custom_domain.toLowerCase()}/` : site?.ssl_url || site?.url
    if (!url) throw new NetlifyError(`Netlify reports no address for the site ${session.site.name ?? session.site.id}.`)
    return url
}

// The jq calls of the deploy script's error lines: Netlify's message of the
// last answer, and the reason a deploy ended in `error`.
const JQ_ERROR = "jq -r '.message // .error // empty' deploy.json 2>/dev/null || true"
const JQ_DEPLOY_ERROR = 'jq -r \'.error_message // "no reason given"\' deploy.json'

// The deploy step's shell: zip `public/`, upload it to Netlify's zip
// deploy API, poll the deploy until it is `ready`, fail on `error`, on any
// answer outside 2xx and after DEPLOY_POLL_TRIES polls. The token and the
// site id come in through the step's `env:`, never as `${{ }}` in the script.
const DEPLOY_SCRIPT = `set -euo pipefail
api='${NETLIFY_API}'
auth="Authorization: Bearer $${TOKEN_SECRET}"

# Fail with Netlify's message when the last answer (in deploy.json) is not 2xx.
check() {
    if [ "$1" -lt 200 ] || [ "$1" -ge 300 ]; then
        echo "::error::Netlify answered $1 to $2: $(${JQ_ERROR})"
        exit 1
    fi
}

(cd ${BUILD_OUTPUT} && zip -qr ../site.zip .)
code=$(curl -sS --max-time ${UPLOAD_TIMEOUT} -o deploy.json -w '%{http_code}' -X POST \\
    -H "$auth" -H 'Content-Type: application/zip' --data-binary @site.zip \\
    "$api/sites/$${SITE_SECRET}/deploys")
check "$code" 'the upload'
id=$(jq -r '.id // empty' deploy.json)
if [ -z "$id" ]; then
    echo '::error::Netlify sent no deploy id for the upload.'
    exit 1
fi

for _ in $(seq 1 ${DEPLOY_POLL_TRIES}); do
    code=$(curl -sS --max-time ${POLL_TIMEOUT} -o deploy.json -w '%{http_code}' -H "$auth" "$api/deploys/$id")
    check "$code" 'the deploy poll'
    case "$(jq -r '.state' deploy.json)" in
        ready)
            echo "Deployed to $(jq -r '.ssl_url // .url' deploy.json)"
            exit 0
            ;;
        error)
            echo "::error::Netlify could not deploy the site: $(${JQ_DEPLOY_ERROR})"
            exit 1
            ;;
    esac
    sleep ${DEPLOY_POLL_SECONDS}
done
echo '::error::The Netlify deploy did not finish within ${(DEPLOY_POLL_SECONDS * DEPLOY_POLL_TRIES) / 60} minutes.'
exit 1
`

// The deploy job of the generated workflow: fetch the `public/` folder
// the build job uploaded and deploy it with curl and jq (both on
// ubuntu-latest); no third-party action and no netlify-cli. It needs no
// scope beyond the workflow's `contents: read`.
function deployJob() {
    return {
        permissions: {},
        job: {
            'runs-on': 'ubuntu-latest',
            steps: [
                {
                    name: 'Download the built site',
                    uses: 'actions/download-artifact@v8',
                    with: { name: BUILD_ARTIFACT, path: BUILD_OUTPUT },
                },
                {
                    name: 'Deploy to Netlify',
                    env: {
                        [TOKEN_SECRET]: `\${{ secrets.${TOKEN_SECRET} }}`,
                        [SITE_SECRET]: `\${{ secrets.${SITE_SECRET} }}`,
                    },
                    run: DEPLOY_SCRIPT,
                },
            ],
        },
    }
}

// What a move away from Netlify leaves behind, from
// the host context alone, with no sign-in to Netlify: the site (named by the
// `netlify.site_id` the run read from config/publish.yaml, when there is one)
// stays online until it is deleted in Netlify's app, the deploy job's two
// repository secrets are unused, and a custom domain follows only its DNS
// records. Names the secrets, never their values.
function leftBehind({ repository, config = {}, options = {} }) {
    const siteId = config.netlify?.site_id
    const site = siteId ? `The Netlify site ${siteId}` : `The Netlify site ${repository.repository} deployed to`
    return [
        `${site} is still online. To remove it, delete it in its settings at https://app.netlify.com (General → Danger zone).`,
        `The repository secrets ${TOKEN_SECRET} and ${SITE_SECRET} are no longer used; delete them at https://github.com/${repository.owner}/${repository.name}/settings/secrets/actions`,
        movedDomainNote('Netlify', options.domain),
    ]
}

export const netlify = {
    id: 'netlify',
    label: 'Netlify',
    summary: 'free plan allows business sites; needs a Netlify account, about 20 deploys a month',
    setUp,
    deployJob,
    liveUrl,
    leftBehind,
}
