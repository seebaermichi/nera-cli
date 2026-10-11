import fs from 'fs/promises'
import path from 'path'

// Start of the ownership line in AGENTS.md. Everything above the first line
// that starts with it is Nera's and is refreshed by `nera update`; that line
// and everything below it belong to the site owner and are kept byte for byte.
export const SITE_NOTES_MARKER = '<!-- nera:site-notes'

// Offset of the first line that starts with SITE_NOTES_MARKER, or -1.
// Only a match at a line start counts, so the marker quoted inside a line
// never moves the split.
function markerOffset(text) {
    if (text.startsWith(SITE_NOTES_MARKER)) return 0
    const at = text.indexOf(`\n${SITE_NOTES_MARKER}`)
    return at === -1 ? -1 : at + 1
}

async function readIfExists(file) {
    try {
        return await fs.readFile(file, 'utf-8')
    } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
    }
}

// The site's AGENTS.md with its Nera part replaced by the template's. The
// template's line endings follow the site's, so a CRLF checkout stays CRLF.
// null when the site file has no marker: then none of it is Nera's to touch.
function spliceAgents(siteText, templateHead) {
    const at = markerOffset(siteText)
    if (at === -1) return null
    const eol = siteText.slice(0, at).includes('\r\n') ? '\r\n' : '\n'
    return templateHead.replace(/\r?\n/g, eol) + siteText.slice(at)
}

// Bring a site's AGENTS.md and CLAUDE.md in line with the scaffold template
// in templateDir: create what is missing, refresh the Nera part of an
// AGENTS.md that has the marker, leave a marker-less AGENTS.md and any
// existing CLAUDE.md alone. Writes only on change, so a repeated run is a
// no-op. Returns one { file, action } per file, action being `created`,
// `updated`, `unchanged` or `skipped`; printing is the caller's job.
export async function syncAgentFiles({ cwd = process.cwd(), templateDir }) {
    const template = await fs.readFile(path.join(templateDir, 'AGENTS.md'), 'utf-8')
    const templateAt = markerOffset(template)
    if (templateAt === -1) {
        throw new Error(
            `The template's AGENTS.md (${templateDir}) has no ` +
                `\`${SITE_NOTES_MARKER}\` line. This is a packaging bug in ` +
                '@nera-static/nera, not a problem with your site.'
        )
    }

    const agentsPath = path.join(cwd, 'AGENTS.md')
    const agents = await readIfExists(agentsPath)
    let agentsAction
    if (agents === null) {
        await fs.writeFile(agentsPath, template)
        agentsAction = 'created'
    } else {
        const next = spliceAgents(agents, template.slice(0, templateAt))
        if (next === null) {
            agentsAction = 'skipped'
        } else if (next === agents) {
            agentsAction = 'unchanged'
        } else {
            await fs.writeFile(agentsPath, next)
            agentsAction = 'updated'
        }
    }

    const claudePath = path.join(cwd, 'CLAUDE.md')
    let claudeAction = 'unchanged'
    if ((await readIfExists(claudePath)) === null) {
        await fs.copyFile(path.join(templateDir, 'CLAUDE.md'), claudePath)
        claudeAction = 'created'
    }

    return [
        { file: 'AGENTS.md', action: agentsAction },
        { file: 'CLAUDE.md', action: claudeAction },
    ]
}
