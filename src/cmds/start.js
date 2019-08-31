exports.command = 'start <dir>'
exports.desc = 'Start nera project'

exports.handler = function (argv) {
  console.log('start called for dir', argv.dir)
}
