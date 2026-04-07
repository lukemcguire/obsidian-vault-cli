/**
 * meta — Show file metadata as JSON
 *
 * Usage: obsidian-vault meta <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { isTextDocument, getDocData } from "@lib/common/utils.ts";
import { decodeBinary } from "@lib/string_and_binary/convert.ts";

export default class Meta extends Command {
    static description = "Show metadata for a vault file as JSON";

    static examples = [
        '<%= config.bin %> meta "Daily Notes/2025-01-15.md"',
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
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Meta);

        const dfm = await createDFM(flags.verbose);
        try {
            // Try to find the file in listing first
            const files = await listFiles(dfm);
            const match = files.find(f =>
                f.path === args.path ||
                f.path.toLowerCase() === args.path.toLowerCase()
            );

            if (!match) {
                this.error(`File not found: ${args.path}`);
            }

            // Fetch the document for full metadata
            const doc = await dfm.getById(match.id);
            if (!doc) {
                this.error(`Could not fetch document for: ${args.path}`);
            }

            const metadata: Record<string, any> = {
                path: match.path,
                id: match.id,
                mtime: match.mtime,
                mtime_iso: match.mtime ? new Date(match.mtime).toISOString() : null,
                ctime: match.ctime,
                ctime_iso: match.ctime ? new Date(match.ctime).toISOString() : null,
                size: match.size,
            };

            // Add doc-level fields if available
            if (doc && typeof doc === "object") {
                const d = doc as any;
                if (d.children) metadata.chunk_count = d.children.length;
                if (d.type) metadata.type = d.type;
                const isBinary = !isTextDocument(d);
                metadata.binary = isBinary;
                if ("data" in d) {
                    if (isBinary) {
                        const buf = decodeBinary(d.data);
                        metadata.content_bytes = buf.byteLength;
                    } else {
                        const content = getDocData(d.data);
                        metadata.content_length = content.length;
                        metadata.content_bytes = new TextEncoder().encode(content).byteLength;
                    }
                }
            }

            this.log(JSON.stringify(metadata, null, 2));
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }
}
