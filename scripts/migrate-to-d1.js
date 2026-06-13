#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { buildMigrationSql, normalizeMigrationData } = require("./migrate-to-d1-lib.js");

function parseArgs(argv) {
  const args = {
    input: null,
    env: "local",
    execute: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--input") args.input = argv[++i];
    else if (token === "--env") args.env = argv[++i];
    else if (token === "--execute") args.execute = true;
    else if (token === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function printHelp() {
  console.log("Usage: node scripts/migrate-to-d1.js --input scripts/migration-data.json --env <local|production> [--execute]");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  if (!["local", "production"].includes(args.env)) {
    throw new Error(`Unsupported env: ${args.env}`);
  }

  const projectRoot = path.resolve(__dirname, "..");
  const cloudflareWorkerApiDir = path.join(projectRoot, "cloudflare-worker-api");
  const inputPath = path.resolve(process.cwd(), args.input);
  const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const normalized = normalizeMigrationData(raw);
  const sql = buildMigrationSql(normalized);

  const outputDir = path.join(__dirname, "generated");
  fs.mkdirSync(outputDir, { recursive: true });
  const sqlPath = path.join(outputDir, `migration-${args.env}.sql`);
  fs.writeFileSync(sqlPath, sql);

  const wranglerArgs = ["d1", "execute", "family-tickets-db", args.env === "local" ? "--local" : "--remote", `--file=${sqlPath}`];

  console.log(`SQL generated: ${sqlPath}`);
  console.log(`Rows: admins=${normalized.admins.length} players=${normalized.players.length} games=${normalized.games.length} applications=${normalized.applications.length}`);
  console.log(`Command: (cd cloudflare-worker-api && wrangler ${wranglerArgs.join(" ")})`);

  if (!args.execute) {
    if (args.env === "production") {
      console.log("Dry run only. 本番は wrangler login 後に上記コマンドを手動実行してください。");
    }
    return;
  }

  const result = spawnSync("wrangler", wranglerArgs, {
    cwd: cloudflareWorkerApiDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

main();
