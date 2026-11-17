// Необязательный .env рядом с пакетом: читается до того, как модули возьмут переменные окружения.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.env.RODMUR_ENV_FILE || ".env");

if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}
