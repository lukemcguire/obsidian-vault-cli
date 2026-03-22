/**
 * write — Write/update a file in the vault
 *
 * Usage: obsidian-vault write <path> [content]
 *        echo "content" | obsidian-vault write <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";

async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        process.stdin.on("error", reject);
    });
}

export default class Write extends Command {
    static description = "Write or update a file in the vault (content from arg or stdin)";

    static examples = [
        '<%= config.bin %> write "Notes/hello.md" "# Hello\\n\\nContent here."',
        'echo "# My Note" | <%= config.bin %> write "Notes/hello.md"',
        'cat local-file.md | <%= config.bin %> write "Notes/imported.md"',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path to write",
            required: true,
        }),
        content: Args.string({
            description: "File content (if omitted, reads from stdin)",
            required: false,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Write);

        // Get content from arg or stdin
        let content: string;
        if (args.content !== undefined) {
            content = args.content;
        } else {
            // Check if stdin is a TTY (interactive) — if so, nothing to read
            if (process.stdin.isTTY) {
                this.error("No content provided. Pass content as argument or pipe it via stdin.");
            }
            content = await readStdin();
        }

        const dfm = await createDFM(flags.verbose);
        try {
            const now = Date.now();
            const blob = new Blob([content], { type: "text/plain" });

            // CRITICAL: Use UTF-8 byte length, NOT string.length
            // string.length counts UTF-16 code units, not bytes.
            // Mismatch causes: "File X seems to be corrupted! (817 != 819)"
            const byteSize = new TextEncoder().encode(content).byteLength;

            const ok = await dfm.put(
                args.path,
                blob,
                { ctime: now, mtime: now, size: byteSize },
                "plain"
            );

            if (ok) {
                this.log(`Written: ${args.path} (${byteSize} bytes)`);
            } else {
                this.error(`Write returned false for: ${args.path}`);
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
