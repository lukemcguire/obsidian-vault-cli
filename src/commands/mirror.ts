/**
 * mirror — Sync vault files with a local directory (two-way, incremental)
 *
 * Usage: obsidian-vault mirror [dir] [--delete] [--dry-run] [--quiet]
 *
 * First run is a full sync. Subsequent runs only process changed
 * documents using the CouchDB changes feed cursor.
 *
 * Two-way sync behavior:
 *   • Vault file newer → download to local
 *   • Local file newer → upload to vault
 *   • File only in vault → download
 *   • File only in local → upload (unless previously known in vault and now deleted)
 *   • Both sides same mtime/size → skip
 *   • Mtimes tied or indeterminate → CONFLICT (skipped, exit code 2)
 *   • --delete removes local files explicitly deleted from CouchDB (not local-only files)
 */

import { Command, Args, Flags } from "@oclif/core";
import { createDFM, listFiles } from "../lib/connection.ts";
import { isTextDocument, getDocData, createBinaryBlob } from "@lib/common/utils.ts";
import { isPlainText } from "@lib/string_and_binary/path.ts";
import { decodeBinary } from "@lib/string_and_binary/convert.ts";
import fs from "node:fs";
import path from "node:path";

interface MirrorState {
    last_seq: string | number;
    last_run: string;
    known_files: string[];
}

function loadState(statePath: string): MirrorState | null {
    try {
        const raw = fs.readFileSync(statePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.last_seq !== "undefined") {
            return {
                last_seq: parsed.last_seq,
                last_run: parsed.last_run || new Date().toISOString(),
                known_files: parsed.known_files || [],
            };
        }
    } catch {
        // missing or corrupt — fall back to full run
    }
    return null;
}

function saveState(statePath: string, lastSeq: string | number, knownFiles: string[]): void {
    const state: MirrorState = {
        last_seq: lastSeq,
        last_run: new Date().toISOString(),
        known_files: knownFiles,
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

function formatTimestamp(ms: number): string {
    return new Date(ms).toISOString();
}

export default class Mirror extends Command {
    static description = "Sync vault files with a local directory (two-way, incremental, cron-friendly)";

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
        const previousKnownFiles = state ? state.known_files : [];

        this.logToStderr(`Mirroring to: ${outputDir}`);
        if (!isFullRun) {
            this.logToStderr(`Incremental run (since: ${since})`);
        } else {
            this.logToStderr("Full run");
        }

        const dfm = await createDFM(flags.verbose);
        try {
            const { files: vaultFiles, last_seq } = await listFiles(dfm, since);
            const vaultMap = new Map(vaultFiles.map(f => [f.path, f]));

            // Ensure output dir exists
            if (!dryRun) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            // Walk local directory
            const localFiles = walkDir(outputDir).filter(p => {
                // Skip mirror state and metadata
                return p !== ".mirror-state.json" && !p.startsWith(".git/");
            });

            let newCount = 0;
            let updatedCount = 0;
            let pushedCount = 0;
            let skippedCount = 0;
            let conflictCount = 0;
            let deletedCount = 0;

            // Process union of vault and local files
            const allPaths = new Set([...vaultMap.keys(), ...localFiles]);

            for (const filePath of allPaths) {
                const vaultEntry = vaultMap.get(filePath);
                const localPath = path.join(outputDir, filePath);

                let localStat: fs.Stats | null = null;
                try {
                    localStat = fs.statSync(localPath);
                    if (localStat.isDirectory()) continue;
                } catch {
                    // ENOENT
                }

                if (vaultEntry && localStat) {
                    // File exists in both places
                    if (
                        localStat.size === vaultEntry.size &&
                        Math.abs(localStat.mtimeMs - vaultEntry.mtime) < 1000
                    ) {
                        // Unchanged
                        if (!flags.quiet) {
                            this.logToStderr(`  SKIP  ${filePath}  (mtime match)`);
                        }
                        skippedCount++;
                        continue;
                    }

                    if (localStat.mtimeMs > vaultEntry.mtime + 1000) {
                        // Local is newer → push to vault
                        if (dryRun) {
                            this.logToStderr(`  PUSH  ${filePath}  (dry run)`);
                            pushedCount++;
                            continue;
                        }
                        try {
                            await this.pushLocalFile(dfm, localPath, filePath, localStat);
                            this.logToStderr(`  PUSH  ${filePath}`);
                            pushedCount++;
                        } catch (err) {
                            this.logToStderr(`  FAIL  ${filePath}: ${(err as Error).message?.slice(0, 80)}`);
                        }
                        continue;
                    }

                    if (vaultEntry.mtime > localStat.mtimeMs + 1000) {
                        // Vault is newer → download
                        if (dryRun) {
                            this.logToStderr(`  OK    ${filePath}  (dry run)`);
                            updatedCount++;
                            continue;
                        }
                        try {
                            await this.downloadFile(dfm, vaultEntry, localPath);
                            this.logToStderr(`  OK    ${filePath}`);
                            updatedCount++;
                        } catch (err) {
                            this.logToStderr(`  FAIL  ${filePath}: ${(err as Error).message?.slice(0, 80)}`);
                        }
                        continue;
                    }

                    // Mtimes are close but differ in some other way → conflict
                    this.logToStderr(`  CONFLICT  ${filePath}`);
                    this.logToStderr(`             local:  ${formatTimestamp(localStat.mtimeMs)}`);
                    this.logToStderr(`             vault:  ${formatTimestamp(vaultEntry.mtime)}`);
                    conflictCount++;
                    continue;
                }

                if (vaultEntry && !localStat) {
                    // Vault-only → download
                    if (dryRun) {
                        this.logToStderr(`  NEW   ${filePath}  (dry run)`);
                        newCount++;
                        continue;
                    }
                    try {
                        await this.downloadFile(dfm, vaultEntry, localPath);
                        this.logToStderr(`  NEW   ${filePath}`);
                        newCount++;
                    } catch (err) {
                        this.logToStderr(`  FAIL  ${filePath}: ${(err as Error).message?.slice(0, 80)}`);
                    }
                    continue;
                }

                if (!vaultEntry && localStat) {
                    // Local-only
                    if (previousKnownFiles.includes(filePath)) {
                        // Was previously in vault but now absent → deleted from CouchDB
                        if (flags.delete) {
                            this.logToStderr(`  DEL   ${filePath}  (deleted in vault)`);
                            if (!dryRun) {
                                fs.unlinkSync(localPath);
                            }
                            deletedCount++;
                        } else if (!flags.quiet) {
                            this.logToStderr(`  SKIP  ${filePath}  (deleted in vault, not pushing back)`);
                        }
                        skippedCount++;
                        continue;
                    }

                    // New local file → push to vault
                    if (dryRun) {
                        this.logToStderr(`  PUSH  ${filePath}  (new local, dry run)`);
                        pushedCount++;
                        continue;
                    }
                    try {
                        await this.pushLocalFile(dfm, localPath, filePath, localStat);
                        this.logToStderr(`  PUSH  ${filePath}  (new local)`);
                        pushedCount++;
                    } catch (err) {
                        this.logToStderr(`  FAIL  ${filePath}: ${(err as Error).message?.slice(0, 80)}`);
                    }
                    continue;
                }
            }

            // Handle --delete: delete local files explicitly deleted from CouchDB (fallback)
            if (flags.delete) {
                if (!isFullRun && state) {
                    const changes = await (dfm.liveSyncLocalDB as any).localDatabase.changes({
                        since: state.last_seq,
                        include_docs: true,
                        deleted: "ok",
                    });

                    for (const change of changes.results) {
                        if (!change.deleted) continue;
                        const doc = change.doc as any;
                        if (!doc || !("path" in doc)) continue;

                        const delPath = path.join(outputDir, doc.path);
                        let delStat: fs.Stats | null = null;
                        try {
                            delStat = fs.statSync(delPath);
                        } catch {
                            // ENOENT
                        }

                        if (delStat) {
                            this.logToStderr(`  DEL   ${doc.path}  (deleted in vault)`);
                            if (!dryRun) {
                                fs.unlinkSync(delPath);
                            }
                            deletedCount++;
                        }
                    }
                }
            }

            // Save state
            if (!dryRun) {
                const currentKnownFiles = vaultFiles.map(f => f.path);
                saveState(statePath, last_seq, currentKnownFiles);
            }

            // Summary
            this.logToStderr(
                `\nMirror complete: ${newCount} new, ${updatedCount} updated, ` +
                `${pushedCount} pushed, ${skippedCount} skipped, ${conflictCount} conflict${conflictCount !== 1 ? "s" : ""}` +
                (deletedCount > 0 ? `, ${deletedCount} deleted` : "")
            );
            if (!dryRun) {
                this.logToStderr(`State saved: last_seq=${last_seq}`);
            }

            // Exit with non-zero if conflicts detected (for cron alerting)
            if (conflictCount > 0) {
                process.exitCode = 2;
            }
        } finally {
            await dfm.close();
            if (!process.exitCode) {
                process.exit(0);
            } else {
                process.exit(process.exitCode);
            }
        }
    }

    private logToStderr(msg: string): void {
        process.stderr.write(msg + "\n");
    }

    private async downloadFile(dfm: any, entry: import("../lib/connection.ts").VaultEntry, localPath: string): Promise<void> {
        const doc = await dfm.getById(entry.id);
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
        fs.utimesSync(localPath, entry.mtime / 1000, entry.mtime / 1000);
    }

    private async pushLocalFile(dfm: any, localPath: string, filePath: string, stat: fs.Stats): Promise<void> {
        const now = Date.now();
        const isBinary = !isPlainText(filePath);

        if (isBinary) {
            const buffer = fs.readFileSync(localPath);
            const blob = createBinaryBlob(buffer.buffer as ArrayBuffer);
            const ok = await dfm.put(
                filePath,
                blob,
                { ctime: now, mtime: stat.mtimeMs, size: buffer.byteLength },
                "newnote"
            );
            if (!ok) {
                throw new Error(`Push returned false for: ${filePath}`);
            }
        } else {
            const content = fs.readFileSync(localPath, "utf-8");
            const blob = new Blob([content], { type: "text/plain" });
            const byteSize = new TextEncoder().encode(content).byteLength;
            const ok = await dfm.put(
                filePath,
                blob,
                { ctime: now, mtime: stat.mtimeMs, size: byteSize },
                "plain"
            );
            if (!ok) {
                throw new Error(`Push returned false for: ${filePath}`);
            }
        }
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
