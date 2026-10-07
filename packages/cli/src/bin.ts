#!/usr/bin/env node
import { existsSync } from "node:fs";
import { main } from "./main.js";

// API keys for --fix may live in a .env file next to where the command is run.
if (existsSync(".env")) process.loadEnvFile(".env");

process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd(),
  env: process.env,
});
