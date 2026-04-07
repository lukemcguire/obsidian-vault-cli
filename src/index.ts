/**
 * obsidian-vault CLI entry point
 *
 * Compiled: node dist/index.cjs <command> [args]
 * Dev:      node --import tsx/esm --experimental-loader ./path-loader.mjs src/index.ts <command> [args]
 */

import { run, handle, flush } from "@oclif/core";

// CJS (built): __filename is native. ESM (dev): derive from import.meta.url.
declare const __filename: string | undefined;
const entryURL =
    typeof __filename === "string"
        ? require("url").pathToFileURL(__filename).href
        : import.meta.url;

(async () => {
    await run(process.argv.slice(2), entryURL)
        .catch(handle)
        .finally(async () => {
            await flush();
        });
})();
