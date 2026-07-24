import { execFileSync } from 'child_process'
import fs from 'fs/promises'
import fssync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Directory-safe and npm-safe: no separators, no traversal, no leading dot or
// dash, nothing the shell could reinterpret. Deliberately stricter than npm's
// own package-name rules, because this value is also a directory name.
const VALID_PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function validateProjectName(projectName) {
    if (typeof projectName !== 'string' || projectName.trim() === '') {
        throw new Error(
            'Project name is required. Usage: nera new <project-name>'
        )
    }

    if (!VALID_PROJECT_NAME.test(projectName)) {
        throw new Error(
            `Invalid project name "${projectName}". Use letters, digits, dots, ` +
                'dashes and underscores only, starting with a letter or digit.'
        )
    }

    return projectName
}

// The scaffold template ships inside this package (package.json `files`).
export const templateDir = () =>
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'template')

async function copyDir(src, dest) {
    await fs.mkdir(dest, { recursive: true })
    for (const entry of await fs.readdir(src, { withFileTypes: true })) {
        const from = path.join(src, entry.name)
        // `_gitignore` → `.gitignore`: npm strips a literal .gitignore from the
        // published tarball, so the template ships it under an underscore name.
        const name = entry.name === '_gitignore' ? '.gitignore' : entry.name
        const to = path.join(dest, name)
        if (entry.isDirectory()) {
            await copyDir(from, to)
        } else {
            await fs.copyFile(from, to)
        }
    }
}

async function personalize(targetDir, projectName) {
    const pkgPath = path.join(targetDir, 'package.json')
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'))
    pkg.name = projectName
    await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    console.log(`  ✓ Configured project as "${projectName}"`)
}

// Scaffold a thin Nera site: copy the template, name it, and (by default)
// install its single dependency, @nera-static/nera. No git clone, no vendored
// engine — the opposite of the old installer's clone-and-strip flow.
export async function scaffoldProject(projectName, options = {}) {
    const { install = true, cwd = process.cwd() } = options

    validateProjectName(projectName)

    const targetDir = path.resolve(cwd, projectName)
    if (fssync.existsSync(targetDir)) {
        throw new Error(`Target directory "${projectName}" already exists.`)
    }

    console.log(`📦 Creating a new Nera site in ${targetDir}...`)
    await copyDir(templateDir(), targetDir)
    await personalize(targetDir, projectName)

    if (install) {
        console.log('📦 Installing dependencies...')
        execFileSync('npm', ['install'], { cwd: targetDir, stdio: 'inherit' })
    }

    console.log('✅ Done!')
    console.log(`👉 Next steps:\n  cd ${projectName}\n  nera dev\n`)
    return targetDir
}
