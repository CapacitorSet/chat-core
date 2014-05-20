#!/usr/bin/env node
var ircd = require(__dirname + '/../lib/ircd');
ircd.hash(process.argv[2], function(hash) {
  console.log(hash);
});
