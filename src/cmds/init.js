import init from '../lib/init'

exports.command = 'init <dir>'
exports.desc = 'Create a new nera project'

exports.handler = function (argv) {
  init(argv.dir)
}
