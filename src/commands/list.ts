/**
 * list — List vault files, optionally scoped to a folder
 *
 * Usage: obsidian-vault list [path] [--verbose] [--long]
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";

export default class List extends Command {
    static description = "List files in the vault (optionally scoped to a folder)";

    static examples = [
        "<%= config.bin %> list",
        '<%= config.bin %> list "BenefitU/"',
        '<%= config.bin %> list "Daily Notes/" --long',
        "<%= config.bin %> list --verbose",
    ];

    static args = {
        path: Args.string({
            description: "Folder prefix to filter by (e.g. \"BenefitU/\" or \"Daily Notes/\")",
            required: false,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        long: Flags.boolean({
            char: "l",
            description: "Show file metadata (size, mtime)",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(List);

        const dfm = await createDFM(flags.verbose);
        try {
            let { files } = await listFiles(dfm);

            // Filter by folder prefix if provided
            if (args.path) {
                const prefix = args.path;
                files = files.filter(f => f.path.startsWith(prefix));
            }

            if (files.length === 0) {
                this.log(args.path ? `(no files under "${args.path}")` : "(vault is empty)");
                return;
            }

            for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
                if (flags.long) {
                    const mtime = file.mtime ? new Date(file.mtime).toISOString() : "unknown";
                    const size = file.size !== undefined ? `${file.size}B` : "?";
                    this.log(`${mtime}  ${size.padStart(10)}  ${file.path}`);
                } else {
                    this.log(file.path);
                }
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
