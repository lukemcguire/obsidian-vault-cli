/**
 * meta — Show file metadata as JSON
 *
 * Usage: obsidian-vault meta <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";

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
            // Fetch metadata directly by path (dfm.get handles path→ID conversion)
            const meta = await dfm.get(args.path as any, true);
            if (!meta) {
                this.error(`File not found: ${args.path}`, { exit: false });
                process.exitCode = 1;
                return;
            }

            // Build metadata from the meta result
            const metadata: Record<string, any> = {
                path: (meta as any).path ?? args.path,
                id: (meta as any)._id,
                mtime: (meta as any).mtime,
                mtime_iso: (meta as any).mtime ? new Date((meta as any).mtime).toISOString() : null,
                ctime: (meta as any).ctime,
                ctime_iso: (meta as any).ctime ? new Date((meta as any).ctime).toISOString() : null,
                size: (meta as any).size,
                type: (meta as any).type,
            };

            if ((meta as any).children) {
                metadata.chunk_count = (meta as any).children.length;
            }

            this.log(JSON.stringify(metadata, null, 2));
        } finally {
            try { await dfm.close(); } catch {}
            process.exit();
        }
    }
}
