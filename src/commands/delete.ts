/**
 * delete — Delete a file from the vault
 *
 * Usage: obsidian-vault delete <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";

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
        let exitCode = 0;
        try {
            // Verify file exists with a lightweight metadata lookup
            // (dfm.delete does its own path→ID lookup, but we check first
            // to give a clear "not found" error instead of a silent false)
            const meta = await dfm.get(args.path as any, true);
            if (!meta) {
                exitCode = 1;
                this.error(`File not found: ${args.path}`, { exit: false });
                return;
            }

            const ok = await dfm.delete(args.path as any);
            if (ok) {
                this.log(`Deleted: ${args.path}`);
            } else {
                exitCode = 1;
                this.error(`Delete returned false for: ${args.path}`, { exit: false });
            }
        } catch (err: any) {
            exitCode = 1;
            this.error(err.message || String(err), { exit: false });
        } finally {
            try { await dfm.close(); } catch {}
            process.exit(exitCode);
        }
    }
}
