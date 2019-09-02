const execShell = require('exec-sh').promise

export default async function start (dir) {
  const cwd = `${process.cwd()}/${dir}`

  try {
    await execShell(`echo "cd into ${dir}" && cd ${cwd}`, { cwd })
    await execShell('echo "Render page:\n--------------------" && npm run render', { cwd })
    await execShell('echo "Start project:\n--------------------" && npm run serve | npm start', { cwd })
  } catch (error) {
    console.log(error)
  }
}
