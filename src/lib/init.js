const del = require('del')
const gitClone = require('gitclone')
const execShell = require('exec-sh').promise

async function cloneNera (dir) {
  return new Promise(resolve => {
    gitClone('https://github.com/seebaermichi/nera.git', { dest: dir }, () => {
      resolve()
    })
  })
}

export default async function init (dir) {
  const cwd = `./${dir}`
  await cloneNera(dir)
  await del([`${cwd}/.git`])
  await execShell('echo "Install node modules:\n--------------------" && npm i', { cwd })
  await execShell('echo "Render page:\n--------------------" && npm run render', { cwd })

  console.log('\x1b[32m', `Nera project "${dir} initialized!`)
}
