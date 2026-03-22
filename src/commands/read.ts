/**
 * read — Print decrypted file content to stdout
 *
 * Usage: obsidian-vault read <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";

export default class Read extends Command {
    static description = "Print decrypted content of a vault file to stdout";

    static examples = [
        '<%= config.bin %> read "Daily Notes/2025-01-15.md"',
        '<%= config.bin %> read "Projects/MyProject.md"',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path",
            required: true,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        "by-id": Flags.boolean({
            description: "Treat <path> as a CouchDB document ID rather than file path",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Read);

        const dfm = await createDFM(flags.verbose);
        try {
            if (flags["by-id"]) {
                // Read by document ID
                const doc = await dfm.getById(args.path as any);
                if (!doc || !("data" in doc)) {
                    this.error(`Document not found: ${args.path}`);
                }
                const content = (doc as any).data.join("");
                process.stdout.write(content);
            } else {
                // Read by path
                const doc = await dfm.get(args.path as any);
                if (!doc || !("data" in doc)) {
                    // Try listing files to find a match (path might need exact case)
                    const files = await listFiles(dfm);
                    const match = files.find(f =>
                        f.path === args.path ||
                        f.path.toLowerCase() === args.path.toLowerCase()
                    );
                    if (!match) {
                        this.error(`File not found: ${args.path}`);
                    }
                    const docById = await dfm.getById(match.id);
                    if (!docById || !("data" in docById)) {
                        this.error(`Could not read file: ${args.path}`);
                    }
                    const content = (docById as any).data.join("");
                    process.stdout.write(content);
                    return;
                }
                const content = (doc as any).data.join("");
                process.stdout.write(content);
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
