#!/usr/bin/env node
const { runCli } = require("../lib/cli");
const { runFill } = require("../lib/fill");

runCli(runFill);
