const fs = require("fs");
const path = require("path");

// Track only values loaded by us; externally supplied environment variables win.
const loadedValues = new Map();

function loadDotEnv(envFile) {
  const values = new Map();
  const contents = envFile && fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  for (const line of contents.split(/\r?\n/)) {
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
    values.set(key, value);
  }

  // Read the next file completely before changing the current environment.
  for (const [key, value] of loadedValues) {
    if (process.env[key] === value) delete process.env[key];
  }
  loadedValues.clear();
  for (const [key, value] of values) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loadedValues.set(key, value);
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
