/**
 * patch — Apply a targeted edit to a vault file
 *
 * Supports two modes:
 *   1. Replace: find oldString, replace with newString (like Claude Code's Edit tool)
 *   2. Append: add content to the end of the file
 *
 * Usage:
 *   obsidian-vault patch <path> --old "old text" --new "new text"
 *   obsidian-vault patch <path> --append "text to add"
 *   echo "text to add" | obsidian-vault patch <path> --append
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { isPlainText } from "@lib/string_and_binary/path.ts";

async function readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        process.stdin.on("error", reject);
    });
}

async function readFile(dfm: any, filePath: string): Promise<string | null> {
    // Try direct path first
    const doc = await dfm.get(filePath);
    if (doc && "data" in doc) {
        return (doc as any).data.join("");
    }

    // Fall back to case-insensitive listing match
    const { files } = await listFiles(dfm);
    const match = files.find((f: any) =>
        f.path === filePath ||
        f.path.toLowerCase() === filePath.toLowerCase()
    );
    if (!match) return null;

    const docById = await dfm.getById(match.id);
    if (!docById || !("data" in docById)) return null;
    return (docById as any).data.join("");
}

async function writeFile(dfm: any, filePath: string, content: string): Promise<boolean> {
    const now = Date.now();
    const blob = new Blob([content], { type: "text/plain" });
    const byteSize = new TextEncoder().encode(content).byteLength;
    return dfm.put(filePath, blob, { ctime: now, mtime: now, size: byteSize }, "plain");
}

export default class Patch extends Command {
    static description = "Apply a targeted edit to a vault file (replace or append)";

    static examples = [
        '<%= config.bin %> patch "Notes/todo.md" --old "## Tasks" --new "## Tasks\\n- New item"',
        '<%= config.bin %> patch "Notes/log.md" --append "## 2026-03-22\\nDid the thing."',
        'echo "New section content" | <%= config.bin %> patch "Notes/doc.md" --append',
        '<%= config.bin %> patch "Notes/doc.md" --old "typo" --new "fixed" --all',
    ];

    static args = {
        path: Args.string({
            description: "Vault-relative file path to patch",
            required: true,
        }),
    };

    static flags = {
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
        old: Flags.string({
            description: "Text to find (exact match)",
            exclusive: ["append"],
        }),
        new: Flags.string({
            description: "Replacement text",
            dependsOn: ["old"],
        }),
        append: Flags.string({
            description: "Text to append to end of file (use without value to read from stdin)",
            exclusive: ["old"],
        }),
        all: Flags.boolean({
            description: "Replace all occurrences (default: error if multiple matches)",
            default: false,
        }),
    };

    // Allow --append without a value (reads from stdin)
    static strict = false;

    async run(): Promise<void> {
        const { args, flags, argv } = await this.parse(Patch);
        const isAppendMode = "append" in flags || (argv as string[]).includes("--append");

        // Validate: must use either --old/--new or --append
        if (!isAppendMode && !flags.old) {
            this.error("Must specify either --old/--new for replacement or --append for appending.");
        }

        // Reject binary files — text patch operations on binary data cause corruption
        if (!isPlainText(args.path)) {
            this.error(
                `patch does not support binary files: ${args.path}\n` +
                "Use 'write' with piped binary content to replace a binary file."
            );
        }

        const dfm = await createDFM(flags.verbose);
        let success = false;
        try {
            if (isAppendMode) {
                await this.handleAppend(dfm, args.path, flags);
            } else {
                await this.handleReplace(dfm, args.path, flags);
            }
            success = true;
        } finally {
            await dfm.close();
            process.exit(success ? 0 : 1);
        }
    }

    private async handleAppend(dfm: any, filePath: string, flags: any): Promise<void> {
        // Get append content from flag value or stdin
        let appendContent: string;
        if (flags.append && flags.append !== true) {
            appendContent = flags.append;
        } else if (!process.stdin.isTTY) {
            appendContent = await readStdin();
        } else {
            this.logToStderr("Error: No content to append. Pass content with --append \"text\" or pipe via stdin.");
            throw new Error("no content");
        }

        // Read existing file (may not exist yet — that's fine, start empty)
        const existing = await readFile(dfm, filePath);
        const newContent = existing !== null
            ? existing + "\n" + appendContent
            : appendContent;

        const ok = await writeFile(dfm, filePath, newContent);
        const byteSize = new TextEncoder().encode(newContent).byteLength;
        if (ok) {
            this.log(`Appended to: ${filePath} (${byteSize} bytes total)`);
        } else {
            this.logToStderr(`Error: Write returned false for: ${filePath}`);
            throw new Error("write failed");
        }
    }

    private async handleReplace(dfm: any, filePath: string, flags: any): Promise<void> {
        const oldStr: string = flags.old;
        const newStr: string = flags.new ?? "";

        // Read existing file
        const existing = await readFile(dfm, filePath);
        if (existing === null) {
            this.logToStderr(`Error: File not found: ${filePath}`);
            throw new Error("not found");
        }

        // Find matches
        const matchCount = existing.split(oldStr).length - 1;

        if (matchCount === 0) {
            this.logToStderr(`Error: oldString not found in ${filePath}`);
            throw new Error("oldString not found");
        }

        if (matchCount > 1 && !flags.all) {
            this.logToStderr(
                `Error: Found ${matchCount} matches for oldString in ${filePath}. ` +
                `Use --all to replace all, or provide more context in --old to match uniquely.`
            );
            throw new Error("multiple matches");
        }

        // Apply replacement
        const newContent = flags.all
            ? existing.split(oldStr).join(newStr)
            : existing.replace(oldStr, newStr);

        const ok = await writeFile(dfm, filePath, newContent);
        const byteSize = new TextEncoder().encode(newContent).byteLength;
        if (ok) {
            const replaced = flags.all ? `${matchCount} occurrence(s)` : "1 occurrence";
            this.log(`Patched: ${filePath} — replaced ${replaced} (${byteSize} bytes total)`);
        } else {
            this.logToStderr(`Error: Write returned false for: ${filePath}`);
            throw new Error("write failed");
        }
    }
}
