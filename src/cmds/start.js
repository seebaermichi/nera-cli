import start from '../lib/start'

exports.command = 'start <dir>'
exports.desc = 'Start nera project'

exports.handler = function (argv) {
  start(argv.dir)
}
