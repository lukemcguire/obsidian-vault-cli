/**
 * read — Print decrypted file content to stdout
 *
 * Usage: obsidian-vault read <path>
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM } from "../lib/connection.ts";
import { isTextDocument, getDocData } from "@lib/common/utils.ts";
import { decodeBinary } from "@lib/string_and_binary/convert.ts";

function outputDoc(doc: any): void {
    if (isTextDocument(doc)) {
        process.stdout.write(getDocData(doc.data));
    } else {
        process.stdout.write(Buffer.from(decodeBinary(doc.data)));
    }
}

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
                    this.error(`Document not found: ${args.path}`, { exit: false });
                    process.exitCode = 1;
                    return;
                }
                outputDoc(doc);
            } else {
                // Read by path — dfm.get() handles path→ID conversion
                const doc = await dfm.get(args.path as any);
                if (!doc || !("data" in doc)) {
                    this.error(`File not found: ${args.path}`, { exit: false });
                    process.exitCode = 1;
                    return;
                }
                outputDoc(doc);
            }
        } finally {
            try { await dfm.close(); } catch {}
            process.exit();
        }
    }
}
