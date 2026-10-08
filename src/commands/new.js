import { scaffoldProject } from '../scaffold.js'

// `nera new <name> [--theme <spec> | --theme=<spec>] [--no-install]`
export function parseNewArgs(args = []) {
    let projectName
    let theme
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === '--theme') {
            theme = args[++i] ?? ''
        } else if (arg.startsWith('--theme=')) {
            theme = arg.slice('--theme='.length)
        } else if (!arg.startsWith('-') && projectName === undefined) {
            projectName = arg
        }
    }
    return { projectName, theme, install: !args.includes('--no-install') }
}

export async function runNew(args = []) {
    const { projectName, theme, install } = parseNewArgs(args)
    await scaffoldProject(projectName, { install, theme })
}
