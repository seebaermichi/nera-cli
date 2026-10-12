import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// The folders of a site the Nera skill is copied into: `.agents/skills/` is
// read by Codex, Cursor, Copilot and Gemini CLI, `.claude/skills/` by Claude
// Code. Each `nera/` folder is wholly Nera's; nothing beside it is touched.
export const SKILL_TARGETS = [
    path.join('.agents', 'skills', 'nera'),
    path.join('.claude', 'skills', 'nera'),
]

// The skill's source ships inside this package (package.json `files`).
export const skillSourceDir = () =>
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'nera')

// The skill a site is synced to: the one in the site's installed
// @nera-static/nera (read after npm has updated it), so it matches the Nera
// version the site runs. Falls back to fallbackDir when nothing is installed
// there or the installed version predates the skill.
export function installedSkillDir(cwd, fallbackDir) {
    const installed = path.join(cwd, 'node_modules', '@nera-static', 'nera', 'skills', 'nera')
    return fssync.existsSync(path.join(installed, 'SKILL.md')) ? installed : fallbackDir
}

async function readIfExists(file) {
    try {
        return await fs.readFile(file)
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'EISDIR') return null
        throw err
    }
}

async function entries(dir) {
    try {
        return await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return []
        throw err
    }
}

// Make `target` an exact copy of `source`: copy what is missing, rewrite what
// differs, remove what the source no longer has. Writes only on change.
// Returns true when anything was written or removed.
async function mirror(source, target) {
    let changed = false
    const stat = await fs.lstat(target).catch(() => null)
    if (stat && !stat.isDirectory()) {
        await fs.rm(target, { recursive: true, force: true })
    }
    if (!stat || !stat.isDirectory()) {
        await fs.mkdir(target, { recursive: true })
        changed = true
    }

    const wanted = new Set()
    for (const entry of await entries(source)) {
        wanted.add(entry.name)
        const from = path.join(source, entry.name)
        const to = path.join(target, entry.name)
        if (entry.isDirectory()) {
            if (await mirror(from, to)) changed = true
            continue
        }
        const content = await fs.readFile(from)
        const current = await readIfExists(to)
        if (current !== null && current.equals(content)) continue
        await fs.rm(to, { recursive: true, force: true })
        await fs.writeFile(to, content)
        changed = true
    }

    for (const entry of await entries(target)) {
        if (wanted.has(entry.name)) continue
        await fs.rm(path.join(target, entry.name), { recursive: true, force: true })
        changed = true
    }
    return changed
}

// Bring a site's copies of the Nera skill in line with sourceDir: each of
// SKILL_TARGETS becomes an exact mirror of it. Nothing outside those two
// `nera/` folders is read or written. Returns one { path, action } per
// folder (path relative to cwd, with `/`), action being `created`,
// `updated` or `unchanged`; printing is the caller's job.
export async function syncSkill({ cwd = process.cwd(), sourceDir }) {
    if (!fssync.existsSync(path.join(sourceDir, 'SKILL.md'))) {
        throw new Error(
            `The Nera skill (${sourceDir}) has no SKILL.md. This is a packaging ` +
                'bug in @nera-static/nera, not a problem with your site.'
        )
    }

    const results = []
    for (const target of SKILL_TARGETS) {
        const dir = path.join(cwd, target)
        const existed = fssync.existsSync(dir)
        const changed = await mirror(sourceDir, dir)
        results.push({
            path: target.split(path.sep).join('/'),
            action: !existed ? 'created' : changed ? 'updated' : 'unchanged',
        })
    }
    return results
}
