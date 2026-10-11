import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import fssync from 'fs'
import os from 'os'
import { syncAgentFiles, SITE_NOTES_MARKER } from '../src/agent-files.js'
import { templateDir } from '../src/scaffold.js'

let cwd
let tplDir

const MARKER_LINE = `${SITE_NOTES_MARKER} — the owner's part -->`
const TEMPLATE_HEAD = '# Nera site\n\nNew Nera instructions.\n\n'
const TEMPLATE_AGENTS = `${TEMPLATE_HEAD}${MARKER_LINE}\n## Notes for this site\n\nTemplate notes.\n`
const TEMPLATE_CLAUDE = '@AGENTS.md\n'

beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-agents-'))
    tplDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nera-agents-tpl-'))
    await fs.writeFile(path.join(tplDir, 'AGENTS.md'), TEMPLATE_AGENTS)
    await fs.writeFile(path.join(tplDir, 'CLAUDE.md'), TEMPLATE_CLAUDE)
})

afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(tplDir, { recursive: true, force: true })
})

const site = (name) => path.join(cwd, name)
const read = (name) => fs.readFile(site(name), 'utf-8')
const sync = () => syncAgentFiles({ cwd, templateDir: tplDir })

describe('syncAgentFiles', () => {
    it('creates both files from the template when they are missing', async () => {
        expect(await sync()).toEqual([
            { file: 'AGENTS.md', action: 'created' },
            { file: 'CLAUDE.md', action: 'created' },
        ])
        expect(await read('AGENTS.md')).toBe(TEMPLATE_AGENTS)
        expect(await read('CLAUDE.md')).toBe(TEMPLATE_CLAUDE)
    })

    it('replaces only the part above the marker and keeps the notes byte for byte', async () => {
        const notes =
            `${SITE_NOTES_MARKER} my own wording -->\n` +
            '## Notes for my bakery\n\nGerman only. Never touch pages/legal.md.\n'
        await fs.writeFile(site('AGENTS.md'), `# Old Nera text\n\nStale.\n\n${notes}`)

        const [agents] = await sync()

        expect(agents).toEqual({ file: 'AGENTS.md', action: 'updated' })
        expect(await read('AGENTS.md')).toBe(TEMPLATE_HEAD + notes)
    })

    it('keeps a CRLF site file CRLF, notes without a trailing newline intact', async () => {
        const notes = `${SITE_NOTES_MARKER} -->\r\n## Notes\r\n\r\nNo newline at the end`
        await fs.writeFile(site('AGENTS.md'), `# Old\r\n\r\n${notes}`)

        await sync()

        expect(await read('AGENTS.md')).toBe(
            TEMPLATE_HEAD.replace(/\n/g, '\r\n') + notes
        )
    })

    it('splits on the first marker line; later markers and inline mentions stay in the notes', async () => {
        const notes =
            `${MARKER_LINE}\n## Notes\n\n` +
            `Quoted inline: ${SITE_NOTES_MARKER} is the marker.\n\n` +
            '```\n' +
            `${SITE_NOTES_MARKER} pasted again -->\n` +
            '```\n'
        await fs.writeFile(
            site('AGENTS.md'),
            `# Old\n\nSee the ${SITE_NOTES_MARKER} line below.\n\n${notes}`
        )

        await sync()

        expect(await read('AGENTS.md')).toBe(TEMPLATE_HEAD + notes)
    })

    it('leaves a marker-less AGENTS.md untouched', async () => {
        const own = '# My own agent notes\n\nNo marker here.\n'
        await fs.writeFile(site('AGENTS.md'), own)
        const before = fssync.statSync(site('AGENTS.md')).mtimeMs

        const [agents] = await sync()

        expect(agents).toEqual({ file: 'AGENTS.md', action: 'skipped' })
        expect(await read('AGENTS.md')).toBe(own)
        expect(fssync.statSync(site('AGENTS.md')).mtimeMs).toBe(before)
    })

    it('never touches an existing CLAUDE.md', async () => {
        await fs.writeFile(site('CLAUDE.md'), 'My own Claude notes.\n')

        const [, claude] = await sync()

        expect(claude).toEqual({ file: 'CLAUDE.md', action: 'unchanged' })
        expect(await read('CLAUDE.md')).toBe('My own Claude notes.\n')
    })

    it('is a no-op on a second run and leaves timestamps alone', async () => {
        await fs.writeFile(site('AGENTS.md'), `# Old\n\n${MARKER_LINE}\nmine\n`)
        await sync()
        const before = fssync.statSync(site('AGENTS.md')).mtimeMs

        expect(await sync()).toEqual([
            { file: 'AGENTS.md', action: 'unchanged' },
            { file: 'CLAUDE.md', action: 'unchanged' },
        ])
        expect(fssync.statSync(site('AGENTS.md')).mtimeMs).toBe(before)
    })

    it('throws on a template without a marker, before writing anything', async () => {
        await fs.writeFile(path.join(tplDir, 'AGENTS.md'), '# No marker\n')

        await expect(sync()).rejects.toThrow(/packaging bug/)
        expect(fssync.existsSync(site('AGENTS.md'))).toBe(false)
        expect(fssync.existsSync(site('CLAUDE.md'))).toBe(false)
    })

    it('refreshes a site from the shipped template and keeps its notes', async () => {
        const notes = `${SITE_NOTES_MARKER} -->\n## Notes for this site\n\nMine.\n`
        await fs.writeFile(site('AGENTS.md'), `# Old\n\n${notes}`)

        await syncAgentFiles({ cwd, templateDir: templateDir() })

        const shipped = await fs.readFile(
            path.join(templateDir(), 'AGENTS.md'),
            'utf-8'
        )
        const head = shipped.slice(0, shipped.indexOf(`\n${SITE_NOTES_MARKER}`) + 1)
        expect(await read('AGENTS.md')).toBe(head + notes)
    })
})
