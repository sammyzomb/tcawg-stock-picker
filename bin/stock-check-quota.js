#!/usr/bin/env node
const { runCli } = require("../lib/cli");
const { runQuota } = require("../lib/quota");

runCli(runQuota);
