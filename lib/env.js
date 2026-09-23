const fs = require("fs");
const path = require("path");

function loadDotEnv(envFile) {
  if (!envFile || !fs.existsSync(envFile)) return;
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function findEnvFile(root, preferred) {
  if (preferred) {
    const file = path.isAbsolute(preferred) ? preferred : path.join(root, preferred);
    if (fs.existsSync(file)) return file;
  }
  const candidates = [".env", ".preview/stock-api.env", ".preview/free-stock.env", ".preview/shutterstock.env"];
  for (const rel of candidates) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) return file;
  }
  return path.join(root, ".env");
}

module.exports = {
  loadDotEnv,
  findEnvFile,
};
