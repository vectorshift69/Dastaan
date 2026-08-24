/* ------------------------------------------------------------------ */
/* Loads .env into process.env before anything else runs.              */
/*                                                                     */
/* Must be the FIRST import in every entrypoint: security.ts validates */
/* JWT_SECRET/CODE_PEPPER at module-load time, and ES modules evaluate */
/* imports in order, so this has to come first.                        */
/*                                                                     */
/* Real environment variables always win, so on Render (no .env file,  */
/* values injected by the platform) this is a no-op.                   */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), process.env.ENV_FILE ?? ".env");

if (existsSync(file)) {
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // strip matching surrounding quotes, if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // never override something the platform already set
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
