/**
 * dump — Dump entire vault to a local directory
 *
 * Usage: obsidian-vault dump [dir]
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import fs from "node:fs";
import path from "node:path";

export default class Dump extends Command {
    static description = "Dump the entire vault to a local directory";

    static examples = [
        "<%= config.bin %> dump",
        "<%= config.bin %> dump ./vault-backup",
        "<%= config.bin %> dump /tmp/my-vault --verbose",
    ];

    static args = {
        dir: Args.string({
            description: "Output directory (default: ./vault-dump)",
            required: false,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        quiet: Flags.boolean({
            char: "q",
            description: "Suppress per-file output",
            default: false,
        }),
        "skip-errors": Flags.boolean({
            description: "Skip files that fail to read instead of aborting",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Dump);

        const outputDir = path.resolve(args.dir || "./vault-dump");

        const dfm = await createDFM(flags.verbose);
        try {
            const files = await listFiles(dfm);

            if (files.length === 0) {
                this.log("Vault is empty, nothing to dump.");
                return;
            }

            this.log(`Dumping ${files.length} file(s) to: ${outputDir}`);

            let succeeded = 0;
            let failed = 0;

            for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
                const outPath = path.join(outputDir, file.path);
                const outDir = path.dirname(outPath);

                try {
                    // Read content
                    const doc = await dfm.getById(file.id);
                    if (!doc || !("data" in doc)) {
                        throw new Error("No data in document");
                    }
                    const content = (doc as any).data.join("");

                    // Create directory and write file
                    fs.mkdirSync(outDir, { recursive: true });
                    fs.writeFileSync(outPath, content, "utf-8");

                    if (!flags.quiet) {
                        this.log(`  OK  ${file.path}`);
                    }
                    succeeded++;
                } catch (err) {
                    const msg = `FAIL ${file.path}: ${(err as Error).message?.slice(0, 80)}`;
                    if (flags["skip-errors"]) {
                        this.warn(msg);
                        failed++;
                    } else {
                        this.error(msg);
                    }
                }
            }

            this.log(`\nDump complete: ${succeeded} written, ${failed} failed`);
            this.log(`Output: ${outputDir}`);
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
