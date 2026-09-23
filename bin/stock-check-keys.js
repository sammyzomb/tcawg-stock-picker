#!/usr/bin/env node
const { runCli } = require("../lib/cli");
const { printKeyStatus } = require("../lib/find");

runCli(async (_argv, ctx) => {
  printKeyStatus(ctx);
  return 0;
});
