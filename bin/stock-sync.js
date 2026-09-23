#!/usr/bin/env node
const { runCli } = require("../lib/cli");
const { runSync } = require("../lib/sync");

runCli(runSync);
