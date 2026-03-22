/**
 * obsidian-vault CLI entry point
 *
 * Run with:
 *   node --import tsx/esm --experimental-loader ./path-loader.mjs src/index.ts <command> [args]
 */

import { run, handle, flush } from "@oclif/core";

await run(process.argv.slice(2), import.meta.url)
    .catch(handle)
    .finally(async () => {
        await flush();
    });
