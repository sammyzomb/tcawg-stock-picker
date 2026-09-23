const { createContext, resolveProjectRoot } = require("./context");

function parseProjectArg(argv) {
  const rest = [...argv];
  let projectRoot = null;

  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === "--project" && rest[i + 1]) {
      projectRoot = rest[i + 1];
      rest.splice(i, 2);
      break;
    }
  }

  return {
    projectRoot: projectRoot || resolveProjectRoot(process.cwd()),
    argv: rest,
  };
}

function runCli(runner) {
  const { projectRoot, argv } = parseProjectArg(process.argv.slice(2));
  const ctx = createContext(projectRoot);
  return runner(argv, ctx)
    .then((code) => {
      if (typeof code === "number" && code !== 0) {
        process.exit(code);
      }
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = {
  parseProjectArg,
  runCli,
};
