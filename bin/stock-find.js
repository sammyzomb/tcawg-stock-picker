#!/usr/bin/env node
const { runCli } = require("../lib/cli");
const { runFind } = require("../lib/find");

runCli(runFind);
