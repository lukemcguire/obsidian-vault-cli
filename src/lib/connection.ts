/**
 * connection.ts — Singleton factory for DirectFileManipulator
 *
 * Reads credentials from env vars, XDG config (~/.config/obsidian-vault/config),
 * or legacy repo-root .env. Auto-detects ALL vault settings from CouchDB at runtime.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CJS (built): __dirname is native. ESM (dev): derive from import.meta.url.
declare const __dirname: string | undefined;
const _dirname: string =
    typeof __dirname === "string"
        ? __dirname
        : path.dirname(new URL(import.meta.url).pathname);

// ── 1. Polyfill localStorage (BEFORE any imports from commonlib) ────────────
if (typeof globalThis.localStorage === "undefined") {
    const _store: Record<string, string> = {};
    (globalThis as any).localStorage = {
        getItem: (key: string) => _store[key] ?? null,
        setItem: (key: string, v: string) => { _store[key] = String(v); },
        removeItem: (key: string) => { delete _store[key]; },
        clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
        key: (i: number) => Object.keys(_store)[i] ?? null,
        get length() { return Object.keys(_store).length; },
    };
}

// ── 2. Import (after localStorage polyfill) ─────────────────────────────────
import { DirectFileManipulator } from "../../livesync-commonlib/src/API/DirectFileManipulator.ts";
import type { DirectFileManipulatorOptions } from "../../livesync-commonlib/src/API/DirectFileManipulatorV2.ts";
import { DEFAULT_SETTINGS } from "../../livesync-commonlib/src/common/types.ts";
import { isAnyNote } from "../../livesync-commonlib/src/common/utils.ts";
import { setGlobalLogFunction } from "octagonal-wheels/common/logger";

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

function loadEnvFile(filePath: string): Record<string, string> {
    const env: Record<string, string> = {};
    try {
        for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
            const t = line.trim();
            if (!t || t.startsWith("#")) continue;
            const eq = t.indexOf("=");
            if (eq === -1) continue;
            env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
        }
    } catch {
        // File may not exist, use env vars only
    }
    return env;
}

export interface VaultConfig {
    url: string;
    username: string;
    password: string;
    database: string;
    passphrase: string;
}

function getConfigPath(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    const configDir = xdgConfig
        ? path.join(xdgConfig, "obsidian-vault")
        : path.join(os.homedir(), ".config", "obsidian-vault");
    return path.join(configDir, "config");
}

export function loadConfig(): VaultConfig {
    const xdgPath = getConfigPath();
    const xdgEnv = loadEnvFile(xdgPath);

    // Legacy fallback: repo-root .env (path only valid from source)
    const legacyPath = path.join(_dirname, "..", "..", ".env");
    const legacyEnv = loadEnvFile(legacyPath);

    if (
        Object.keys(legacyEnv).length > 0 &&
        Object.keys(xdgEnv).length === 0
    ) {
        process.stderr.write(
            `[obsidian-vault] Deprecated: config loaded from ${legacyPath}\n` +
            `  Move it to ${xdgPath} to silence this warning.\n`
        );
    }

    // XDG takes precedence over legacy
    const fileEnv = { ...legacyEnv, ...xdgEnv };

    const get = (key: string, fallback?: string): string => {
        const val = process.env[key] || fileEnv[key] || fallback;
        if (!val) {
            throw new Error(
                `Missing required config: ${key}.\n` +
                `  Set it in ${xdgPath} or as an environment variable.`
            );
        }
        return val;
    };

    return {
        url:        process.env.COUCHDB_URL  || fileEnv.COUCHDB_URL  ||
                    fileEnv.HOSTNAME          || "http://127.0.0.1:5984",
        username:   get("COUCHDB_USER"),
        password:   get("COUCHDB_PASSWORD"),
        database:   process.env.DB_NAME      || fileEnv.DB_NAME      ||
                    "obsidiannotes",
        passphrase: get("E2EE_PASSPHRASE"),
    };
}

// ---------------------------------------------------------------------------
// Vault settings auto-detection
// ---------------------------------------------------------------------------

interface VaultSettings extends Partial<DirectFileManipulatorOptions> {
    usePathObfuscation: boolean;
}

async function fetchVaultSettings(
    url: string,
    database: string,
    username: string,
    password: string
): Promise<VaultSettings> {
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const res = await fetch(
        `${url}/${database}/_local/obsydian_livesync_milestone`,
        { headers: { Authorization: `Basic ${auth}` } }
    );
    if (!res.ok) {
        throw new Error(`Failed to fetch milestone doc: ${res.status} ${res.statusText}`);
    }
    const doc = await res.json() as any;
    const tweaks = doc.tweak_values ?? {};

    // Prefer PREFERRED, fall back to first accepted node
    const nodeId = "PREFERRED" in tweaks
        ? "PREFERRED"
        : (doc.accepted_nodes?.[0] ?? Object.keys(tweaks)[0]);

    if (!nodeId || !tweaks[nodeId]) {
        throw new Error("No tweak_values found in milestone doc");
    }

    const t = tweaks[nodeId];
    return {
        // Chunking
        customChunkSize:             t.customChunkSize    ?? 0,
        minimumChunkSize:            t.minimumChunkSize   ?? 20,
        hashAlg:                     t.hashAlg            ?? "xxhash64",
        chunkSplitterVersion:        t.chunkSplitterVersion ?? "v2",
        useDynamicIterationCount:    t.useDynamicIterationCount ?? false,
        // Eden (inline chunk cache)
        useEden:                     t.useEden            ?? false,
        maxChunksInEden:             t.maxChunksInEden    ?? 10,
        maxTotalLengthInEden:        t.maxTotalLengthInEden ?? 1024,
        maxAgeInEden:                t.maxAgeInEden       ?? 10,
        // Encoding
        enableCompression:           t.enableCompression  ?? false,
        E2EEAlgorithm:               t.E2EEAlgorithm      ?? "v2",
        // File handling
        handleFilenameCaseSensitive: t.handleFilenameCaseSensitive ?? false,
        doNotUseFixedRevisionForChunks: t.doNotUseFixedRevisionForChunks ?? false,
        // Path obfuscation — not in DirectFileManipulatorOptions, must be injected separately
        usePathObfuscation:          t.usePathObfuscation ?? false,
    };
}

// ---------------------------------------------------------------------------
// DFM factory
// ---------------------------------------------------------------------------

export async function createDFM(verbose = false): Promise<DirectFileManipulator> {
    const config = loadConfig();

    // Suppress ALL logging unless --verbose is set.
    // The livesync-commonlib uses multiple log paths:
    //   1. octagonal-wheels global logger (setGlobalLogFunction)
    //   2. dfm.services.API.addLog handler
    //   3. Raw console.log/warn/error calls from within the library
    // With ESM loaders, the octagonal-wheels module can be loaded as two instances
    // (one via our import, one via the commonlib), so setGlobalLogFunction alone
    // doesn't always suppress all output. We patch console.* as a safety net.
    setGlobalLogFunction((message: any, level: number, key?: string) => {
        if (verbose) {
            const msg = typeof message === "string" ? message : message instanceof Error ? `${message.name}: ${message.message}` : JSON.stringify(message);
            process.stderr.write(`[livesync] ${msg}\n`);
        }
    });

    // Patch console to redirect any stray log output to stderr (or suppress entirely)
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origError = console.error;
    if (!verbose) {
        console.log = () => {};
        console.warn = () => {};
        console.error = () => {};
    } else {
        console.log = (...args: any[]) => process.stderr.write(args.join(" ") + "\n");
        console.warn = (...args: any[]) => process.stderr.write(args.join(" ") + "\n");
        // console.error already goes to stderr
    }

    // Auto-detect vault settings from CouchDB
    const vaultSettings = await fetchVaultSettings(
        config.url, config.database, config.username, config.password
    );

    // ── 3. Construct with auto-detected settings ────────────────────────────
    const options: DirectFileManipulatorOptions = {
        url:      config.url,
        username: config.username,
        password: config.password,
        database: config.database,
        passphrase:         config.passphrase,
        obfuscatePassphrase: config.passphrase,
        ...vaultSettings,
    };

    const dfm = new DirectFileManipulator(options);

    // ── 4. Wire handler stubs (synchronous, before init() runs) ────────────
    (dfm.services as any).API.addLog.setHandler((message: any, level: number) => {
        if (verbose && level >= 32) {
            const msg = typeof message === "string" ? message : JSON.stringify(message);
            console.error(`[livesync] ${msg}`);
        }
    });
    (dfm.services as any).API.getSystemVaultName.setHandler(() => "livesync-headless");
    (dfm.services as any).appLifecycle.isReloadingScheduled.setHandler(() => false);
    (dfm.services as any).appLifecycle.askRestart.setHandler(() => {});
    (dfm.services as any).appLifecycle.scheduleRestart.setHandler(() => {});
    (dfm.services as any).appLifecycle.performRestart.setHandler(() => {});

    // ── 5. Pre-wire database service ────────────────────────────────────────
    (dfm.services as any).database._localDatabase = dfm.liveSyncLocalDB;

    // ── 6. Inject settings with usePathObfuscation (CRITICAL) ──────────────
    (dfm.services as any).setting.settings = {
        ...DEFAULT_SETTINGS,
        ...dfm.settings,
        usePathObfuscation: vaultSettings.usePathObfuscation,
    };

    // ── 7. Wait for ready ───────────────────────────────────────────────────
    await dfm.ready.promise;

    // Restore console after init (oclif needs console for its own output)
    console.log = _origLog;
    console.warn = _origWarn;
    console.error = _origError;

    return dfm;
}

// ---------------------------------------------------------------------------
// Vault file listing helper (dfm.enumerate() is broken)
// ---------------------------------------------------------------------------

export interface VaultEntry {
    path: string;
    id: string;
    mtime: number;
    ctime: number;
    size: number;
}

export interface ListFilesResult {
    files: VaultEntry[];
    last_seq: string | number;
}

export async function listFiles(
    dfm: DirectFileManipulator,
    since: string | number = "0"
): Promise<ListFilesResult> {
    const files: VaultEntry[] = [];

    const result = await dfm.liveSyncLocalDB.localDatabase.changes({
        include_docs: true,
        since,
        live: false,
    });

    for (const change of result.results) {
        const doc = change.doc as any;
        if (!doc) continue;
        // Skip chunks (type === "leaf"), internal docs, and deleted entries
        if (!isAnyNote(doc)) continue;
        if (doc._deleted || doc.deleted) continue;

        files.push({
            path:  doc.path  as string,
            id:    doc._id   as string,
            mtime: doc.mtime as number,
            ctime: doc.ctime as number,
            size:  doc.size  as number,
        });
    }

    return { files, last_seq: result.last_seq };
}
