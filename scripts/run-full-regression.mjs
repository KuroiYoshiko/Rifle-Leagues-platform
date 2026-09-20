import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(scriptsDirectory))
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .sort()
  .map((name) => join(scriptsDirectory, name));

if (files.length === 0) throw new Error("No scripts/test-*.mjs files were found.");

const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  { cwd: new URL("../", import.meta.url), stdio: "inherit", shell: false },
);

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Full regression runner stopped by ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
