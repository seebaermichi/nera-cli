import { NETLIFY_API } from '../../src/publish/netlify-api.js'
import { jsonResponse } from './fake-github.js'

// A stub Netlify API for the netlify target of `nera publish`: the account
// (GET /user), sites (create, read) and a site's deploys. No network. Every
// request needs the bearer `token`; any other token gets a 401.
// - `sites`: the sites Netlify already has, by id
// - `taken`: site names POST /sites refuses with a 422
// - `deploys`: what GET /sites/:id/deploys answers, or a number for an
//   HTTP error status
// `events` records what changed on Netlify, `requests` every call.
export function fakeNetlify({ token, sites = {}, taken = [], deploys = [] } = {}) {
    const events = []
    const requests = []
    const known = new Map(Object.entries(sites))
    let nextSite = 1

    const fetch = async (url, init = {}) => {
        requests.push({ url, init })
        if (init.headers?.Authorization !== `Bearer ${token}`) {
            return jsonResponse(401, { code: 401, message: 'Access Denied' })
        }
        const { pathname, searchParams } = new URL(url)
        const route = `${init.method} ${pathname.slice(new URL(NETLIFY_API).pathname.length)}`
        if (route === 'GET /user') return jsonResponse(200, { email: 'me@example.com' })
        if (route === 'POST /sites') {
            const { name } = JSON.parse(init.body)
            if (taken.includes(name) || [...known.values()].some((site) => site.name === name)) {
                return jsonResponse(422, { errors: { subdomain: ['must be unique'] } })
            }
            const site = {
                id: `site-${nextSite++}`,
                name,
                url: `http://${name}.netlify.app`,
                ssl_url: `https://${name}.netlify.app`,
            }
            known.set(site.id, site)
            events.push(`create site ${name}`)
            return jsonResponse(201, site)
        }
        const deployList = route.match(/^GET \/sites\/([^/]+)\/deploys$/)
        if (deployList) {
            events.push(`list deploys ${searchParams.toString()}`)
            if (typeof deploys === 'number') return jsonResponse(deploys, { message: 'Internal Server Error' })
            return jsonResponse(200, deploys)
        }
        const siteRead = route.match(/^GET \/sites\/([^/]+)$/)
        if (siteRead) {
            const site = known.get(decodeURIComponent(siteRead[1]))
            return site ? jsonResponse(200, site) : jsonResponse(404, { code: 404, message: 'Not Found' })
        }
        return jsonResponse(404, { code: 404, message: 'Not Found' })
    }
    return { fetch, events, requests, sites: known }
}
