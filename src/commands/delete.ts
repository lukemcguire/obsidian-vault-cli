/**
 * delete — Delete a file from the vault
 *
 * Usage: obsidian-vault delete <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";

export default class Delete extends Command {
    static description = "Delete a file from the vault";

    static examples = [
        '<%= config.bin %> delete "Notes/old-note.md"',
        '<%= config.bin %> delete "Agent-Test/hello.md" --yes',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path to delete",
            required: true,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        yes: Flags.boolean({
            char: "y",
            description: "Skip confirmation prompt",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Delete);

        // Confirm unless --yes
        if (!flags.yes) {
            const readline = await import("node:readline");
            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stderr,
            });

            const confirmed = await new Promise<boolean>((resolve) => {
                rl.question(`Delete "${args.path}"? [y/N] `, (answer) => {
                    rl.close();
                    resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
                });
            });

            if (!confirmed) {
                this.log("Aborted.");
                process.exit(0);
            }
        }

        const dfm = await createDFM(flags.verbose);
        try {
            // Verify file exists first
            const { files } = await listFiles(dfm);
            const match = files.find(f =>
                f.path === args.path ||
                f.path.toLowerCase() === args.path.toLowerCase()
            );

            if (!match) {
                this.error(`File not found: ${args.path}`);
            }

            const ok = await dfm.delete(match.path as any);
            if (ok) {
                this.log(`Deleted: ${args.path}`);
            } else {
                this.error(`Delete returned false for: ${args.path}`);
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
