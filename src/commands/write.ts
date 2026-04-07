/**
 * write — Write/update a file in the vault
 *
 * Usage: obsidian-vault write <path> [content]
 *        echo "content" | obsidian-vault write <path>
 *        cat image.png | obsidian-vault write <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";
import { isPlainText } from "@lib/string_and_binary/path.ts";
import { createBinaryBlob } from "@lib/common/utils.ts";

async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        process.stdin.on("error", reject);
    });
}

async function readStdinBinary(): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        );
        process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
        process.stdin.on("error", reject);
    });
}

export default class Write extends Command {
    static description = "Write or update a file in the vault (content from arg or stdin)";

    static examples = [
        '<%= config.bin %> write "Notes/hello.md" "# Hello\\n\\nContent here."',
        'echo "# My Note" | <%= config.bin %> write "Notes/hello.md"',
        'cat local-file.md | <%= config.bin %> write "Notes/imported.md"',
        'cat image.png | <%= config.bin %> write "Assets/image.png"',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path to write",
            required: true,
        }),
        content: Args.string({
            description: "File content (text files only; if omitted, reads from stdin)",
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

        const dfm = await createDFM(flags.verbose);
        try {
            const now = Date.now();
            const isBinary = !isPlainText(args.path);

            if (isBinary) {
                // Binary files must come via stdin — raw bytes cannot be
                // represented as a CLI string argument.
                if (args.content !== undefined) {
                    this.error(
                        `Binary files must be supplied via stdin, not as a CLI argument.\n` +
                        `  cat file | obsidian-vault write "${args.path}"`
                    );
                }
                if (process.stdin.isTTY) {
                    this.error("No content provided. Pipe binary content via stdin.");
                }
                const raw = await readStdinBinary();
                const blob = createBinaryBlob(raw.buffer as ArrayBuffer);
                const ok = await dfm.put(
                    args.path,
                    blob,
                    { ctime: now, mtime: now, size: raw.byteLength },
                    "newnote"
                );
                if (ok) {
                    this.log(`Written: ${args.path} (${raw.byteLength} bytes, binary)`);
                } else {
                    this.error(`Write returned false for: ${args.path}`);
                }
            } else {
                // Text path: content from arg or stdin
                let content: string;
                if (args.content !== undefined) {
                    content = args.content;
                } else {
                    if (process.stdin.isTTY) {
                        this.error("No content provided. Pass content as argument or pipe it via stdin.");
                    }
                    content = await readStdin();
                }

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
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
