/**
 * grep — Search file contents in the vault
 *
 * Decrypts and searches files under a given path prefix.
 * --path is required to encourage scoped searches (full vault scan is slow).
 *
 * Usage:
 *   obsidian-vault grep "pattern" --path "BenefitU/"
 *   obsidian-vault grep "TODO|FIXME" --path "Projects/" -i
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { isPlainText } from "@lib/string_and_binary/path.ts";
import { getDocData } from "@lib/common/utils.ts";

export default class Grep extends Command {
    static description = "Search file contents by regex within a vault folder (decrypts on the fly)";

    static examples = [
        '<%= config.bin %> grep "sprint" --path "BenefitU/"',
        '<%= config.bin %> grep "TODO|FIXME" --path "Projects/" -i',
        '<%= config.bin %> grep "meeting.*2026" --path "Daily Notes/" --long',
    ];

    static args = {
        pattern: Args.string({
            description: "Regex pattern to search for in file contents",
            required: true,
        }),
    };

    static flags = {
        path: Flags.string({
            description: "Folder prefix to search within (required — scopes the search for performance)",
            required: true,
        }),
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        "case-insensitive": Flags.boolean({
            char: "i",
            description: "Case-insensitive matching",
            default: false,
        }),
        long: Flags.boolean({
            char: "l",
            description: "Show matching lines (not just file paths)",
            default: false,
        }),
        "max-results": Flags.integer({
            char: "n",
            description: "Maximum number of files to return",
            default: 50,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Grep);

        const regexFlags = flags["case-insensitive"] ? "gi" : "g";
        let regex: RegExp;
        try {
            regex = new RegExp(args.pattern, regexFlags);
        } catch (e: any) {
            this.error(`Invalid regex: ${e.message}`);
        }

        const dfm = await createDFM(flags.verbose);
        try {
            // 1. List files under the path prefix
            const { files: allFiles } = await listFiles(dfm);
            const scopedFiles = allFiles.filter(f => f.path.startsWith(flags.path));

            if (scopedFiles.length === 0) {
                this.log(`(no files under "${flags.path}")`);
                return;
            }

            process.stderr.write(`Searching ${scopedFiles.length} file(s) under "${flags.path}"...\n`);

            // 2. Read + search each file
            let matchCount = 0;
            for (const file of scopedFiles) {
                if (matchCount >= flags["max-results"]!) break;

                try {
                    // Skip binary files — regex search on encoded chunks is meaningless
                    if (!isPlainText(file.path)) {
                        if (flags.verbose) {
                            process.stderr.write(`  (skipped binary: ${file.path})\n`);
                        }
                        continue;
                    }

                    const doc = await dfm.getById(file.id);
                    if (!doc || !("data" in doc)) continue;

                    const content = getDocData((doc as any).data);
                    regex.lastIndex = 0;

                    if (regex.test(content)) {
                        matchCount++;

                        if (flags.long) {
                            // Show matching lines with line numbers
                            const lines = content.split("\n");
                            this.log(`\n${file.path}:`);
                            for (let i = 0; i < lines.length; i++) {
                                // Reset regex for each line test
                                regex.lastIndex = 0;
                                if (regex.test(lines[i])) {
                                    this.log(`  ${i + 1}: ${lines[i]}`);
                                }
                            }
                        } else {
                            this.log(file.path);
                        }
                    }
                } catch {
                    // Skip files that fail to decrypt (corrupted, binary, etc.)
                    if (flags.verbose) {
                        process.stderr.write(`  (skipped: ${file.path})\n`);
                    }
                }
            }

            process.stderr.write(`${matchCount} file(s) matched.\n`);
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
