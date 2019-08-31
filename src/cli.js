#!/usr/bin/env node

// eslint-disable-next-line
require('yargs')
  .commandDir('cmds')
  .demandCommand()
  .help()
  .argv

export function cli () {}
