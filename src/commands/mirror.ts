/**
 * mirror — Sync vault files to a local directory (incremental)
 *
 * Usage: obsidian-vault mirror [dir] [--delete] [--dry-run] [--quiet]
 *
 * First run is a full sync. Subsequent runs only process changed
 * documents using the CouchDB changes feed cursor.
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { isTextDocument, getDocData } from "@lib/common/utils.ts";
import { decodeBinary } from "@lib/string_and_binary/convert.ts";
import fs from "node:fs";
import path from "node:path";

interface MirrorState {
    last_seq: string | number;
    last_run: string;
}

function loadState(statePath: string): MirrorState | null {
    try {
        const raw = fs.readFileSync(statePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.last_seq !== "undefined") return parsed;
    } catch {
        // missing or corrupt — fall back to full run
    }
    return null;
}

function saveState(statePath: string, lastSeq: string | number): void {
    const state: MirrorState = {
        last_seq: lastSeq,
        last_run: new Date().toISOString(),
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function formatTimestamp(ms: number): string {
    return new Date(ms).toISOString();
}

export default class Mirror extends Command {
    static description = "Sync vault files to a local directory (incremental, cron-friendly)";

    static examples = [
        "<%= config.bin %> mirror",
        "<%= config.bin %> mirror ./vault-mirror",
        "<%= config.bin %> mirror ./vault-mirror --delete",
        "<%= config.bin %> mirror ./vault-mirror --dry-run",
        "<%= config.bin %> mirror ./vault-mirror --quiet",
    ];

    static args = {
        dir: Args.string({
            description: "Output directory (default: ./vault-mirror)",
            required: false,
        }),
    };

    static flags = {
        delete: Flags.boolean({
            char: "d",
            description: "Delete local files whose vault entries were deleted",
            default: false,
        }),
        "dry-run": Flags.boolean({
            char: "n",
            description: "Print what would change without touching disk",
            default: false,
        }),
        quiet: Flags.boolean({
            char: "q",
            description: "Suppress per-file OK/SKIP lines (errors and conflicts always shown)",
            default: false,
        }),
        verbose: Flags.boolean({
            char: "v",
            description: "Show verbose LiveSync log output",
            default: false,
        }),
    };

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Mirror);
        const outputDir = path.resolve(args.dir || "./vault-mirror");
        const statePath = path.join(outputDir, ".mirror-state.json");
        const dryRun = flags["dry-run"];

        // Load state
        const state = loadState(statePath);
        const since = state ? state.last_seq : "0";
        const isFullRun = since === "0";

        this.logToStderr(`Mirroring to: ${outputDir}`);
        if (!isFullRun) {
            this.logToStderr(`Incremental run (since: ${since})`);
        } else {
            this.logToStderr("Full run");
        }

        const dfm = await createDFM(flags.verbose);
        try {
            const { files, last_seq } = await listFiles(dfm, since);

            // Ensure output dir exists
            if (!dryRun) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            let newCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            let conflictCount = 0;

            for (const file of files) {
                const localPath = path.join(outputDir, file.path);

                // Check local file state
                let localStat: fs.Stats | null = null;
                try {
                    localStat = fs.statSync(localPath);
                } catch {
                    // ENOENT — file doesn't exist locally
                }

                if (localStat) {
                    // Unchanged — same mtime and size
                    if (
                        localStat.mtimeMs === file.mtime &&
                        localStat.size === file.size
                    ) {
                        if (!flags.quiet) {
                            this.logToStderr(`  SKIP  ${file.path}  (mtime match)`);
                        }
                        skippedCount++;
                        continue;
                    }

                    // Conflict — local file is newer than vault version
                    if (localStat.mtimeMs > file.mtime) {
                        this.logToStderr(`  CONFLICT  ${file.path}`);
                        this.logToStderr(`             local:  ${formatTimestamp(localStat.mtimeMs)}`);
                        this.logToStderr(`             vault:  ${formatTimestamp(file.mtime)}`);
                        conflictCount++;
                        continue;
                    }
                }

                // Download the file
                const isNew = !localStat;
                const label = isNew ? "NEW" : "  OK";

                if (dryRun) {
                    this.logToStderr(`  ${label}  ${file.path}  (dry run)`);
                    if (isNew) newCount++; else updatedCount++;
                    continue;
                }

                try {
                    const doc = await dfm.getById(file.id);
                    if (!doc || !("data" in doc)) {
                        throw new Error("No data in document");
                    }

                    const outDir = path.dirname(localPath);
                    fs.mkdirSync(outDir, { recursive: true });

                    if (isTextDocument(doc as any)) {
                        fs.writeFileSync(localPath, getDocData((doc as any).data), "utf-8");
                    } else {
                        fs.writeFileSync(localPath, Buffer.from(decodeBinary((doc as any).data)));
                    }

                    // Preserve vault mtime so next run skips unchanged files
                    fs.utimesSync(localPath, file.mtime / 1000, file.mtime / 1000);

                    if (!flags.quiet || isNew) {
                        this.logToStderr(`  ${label}  ${file.path}`);
                    }
                    if (isNew) newCount++; else updatedCount++;
                } catch (err) {
                    this.logToStderr(`  FAIL  ${file.path}: ${(err as Error).message?.slice(0, 80)}`);
                }
            }

            // Handle --delete
            let deletedCount = 0;
            if (flags.delete) {
                // Need full vault listing to know what's deleted
                // For incremental runs, do a full listFiles("0") to get authoritative set
                let allVaultFiles: Set<string>;
                if (isFullRun) {
                    allVaultFiles = new Set(files.map(f => f.path));
                } else {
                    const { files: fullFiles } = await listFiles(dfm, "0");
                    allVaultFiles = new Set(fullFiles.map(f => f.path));
                }

                // Walk output directory and delete files not in vault
                const localFiles = walkDir(outputDir);
                for (const relPath of localFiles) {
                    if (relPath === ".mirror-state.json") continue;
                    if (!allVaultFiles.has(relPath)) {
                        const delPath = path.join(outputDir, relPath);
                        this.logToStderr(`  DEL   ${relPath}`);
                        if (!dryRun) {
                            fs.unlinkSync(delPath);
                        }
                        deletedCount++;
                    }
                }
            }

            // Save state
            if (!dryRun) {
                saveState(statePath, last_seq);
            }

            // Summary
            this.logToStderr(
                `\nMirror complete: ${newCount} new, ${updatedCount} updated, ` +
                `${skippedCount} skipped, ${conflictCount} conflict${conflictCount !== 1 ? "s" : ""}` +
                (deletedCount > 0 ? `, ${deletedCount} deleted` : "")
            );
            if (!dryRun) {
                this.logToStderr(`State saved: last_seq=${last_seq}`);
            }
        } finally {
            await dfm.close();
            process.exit(0);
        }
    }

    private logToStderr(msg: string): void {
        process.stderr.write(msg + "\n");
    }
}

/** Recursively walk a directory, returning vault-relative paths */
function walkDir(dir: string, prefix = ""): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return results;
    }
    for (const entry of entries) {
        const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            results.push(...walkDir(path.join(dir, entry.name), relPath));
        } else {
            results.push(relPath);
        }
    }
    return results;
}
