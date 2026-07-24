import { scaffoldProject } from '../scaffold.js'

export async function runNew(args = []) {
    const projectName = args.find((a) => !a.startsWith('-'))
    const install = !args.includes('--no-install')
    await scaffoldProject(projectName, { install })
}
