/**
 * search — List files matching a regex pattern
 *
 * Usage: obsidian-vault search <pattern>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";

export default class Search extends Command {
    static description = "List vault files whose paths match a regex pattern";

    static examples = [
        '<%= config.bin %> search "Daily Notes"',
        '<%= config.bin %> search "\\.md$"',
        '<%= config.bin %> search "^Projects/"',
        '<%= config.bin %> search "2025" --ignore-case',
    ];

    static args = {
        pattern: Args.string({
            description: "Regex pattern to match against file paths",
            required: true,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        "ignore-case": Flags.boolean({
            char: "i",
            description: "Case-insensitive matching",
            default: false,
        }),
        long: Flags.boolean({
            char: "l",
            description: "Show file metadata (size, mtime)",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Search);

        let regex: RegExp;
        try {
            regex = new RegExp(args.pattern, flags["ignore-case"] ? "i" : "");
        } catch (err) {
            this.error(`Invalid regex pattern: ${args.pattern}\n${(err as Error).message}`);
        }

        const dfm = await createDFM(flags.verbose);
        try {
            const { files } = await listFiles(dfm);
            const matched = files
                .filter(f => regex.test(f.path))
                .sort((a, b) => a.path.localeCompare(b.path));

            if (matched.length === 0) {
                this.log("(no matches)");
                return;
            }

            for (const file of matched) {
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
