import { defineConfig } from "tsup";
import path from "path";
import fs from "node:fs";

const STUBS = path.resolve("stubs");
const COMMONLIB = path.resolve("livesync-commonlib/src");

/** Try to resolve a path with .ts extension if the bare path doesn't exist */
function resolveWithExt(filePath: string): string {
    if (fs.existsSync(filePath)) return filePath;
    const withTs = filePath + ".ts";
    if (fs.existsSync(withTs)) return withTs;
    // Try index.ts for directory imports
    const indexTs = path.join(filePath, "index.ts");
    if (fs.existsSync(indexTs)) return indexTs;
    return filePath; // let esbuild report the error
}

const pathAliasPlugin = {
    name: "path-aliases",
    setup(build: any) {
        // bgWorker → mock (must be before the general @lib/* rule)
        build.onResolve(
            { filter: /^@lib\/worker\/bgWorker/ },
            () => ({ path: path.resolve(COMMONLIB, "worker/bgWorker.mock.ts") })
        );

        // pouchdb-browser → pouchdb-http (must be before general @lib/* rule)
        build.onResolve(
            { filter: /^@lib\/pouchdb\/pouchdb-browser/ },
            () => ({ path: path.resolve(COMMONLIB, "pouchdb/pouchdb-http.ts") })
        );

        // pouchdb-browser via relative imports from within commonlib
        build.onResolve(
            { filter: /pouchdb-browser/ },
            () => ({ path: path.resolve(COMMONLIB, "pouchdb/pouchdb-http.ts") })
        );

        // @lib/* → livesync-commonlib/src/*
        build.onResolve(
            { filter: /^@lib\// },
            (args: any) => ({
                path: resolveWithExt(
                    path.resolve(COMMONLIB, args.path.slice("@lib/".length))
                ),
            })
        );

        // @/lib/src/*.svelte → svelte-stub
        build.onResolve(
            { filter: /^@\/lib\/src\/.*\.svelte$/ },
            () => ({ path: path.resolve(STUBS, "svelte-stub.ts") })
        );

        // @/lib/src/* → livesync-commonlib/src/*
        build.onResolve(
            { filter: /^@\/lib\/src\// },
            (args: any) => ({
                path: resolveWithExt(
                    path.resolve(
                        COMMONLIB,
                        args.path.slice("@/lib/src/".length)
                    )
                ),
            })
        );

        // @/common/* → stubs/common/*.ts
        build.onResolve(
            { filter: /^@\/common\// },
            (args: any) => ({
                path: path.resolve(
                    STUBS,
                    "common",
                    args.path.slice("@/common/".length) + ".ts"
                ),
            })
        );

        // @/deps → stubs/deps.ts
        build.onResolve(
            { filter: /^@\/deps$/ },
            () => ({ path: path.resolve(STUBS, "deps.ts") })
        );

        // @/main → stubs/main.ts
        build.onResolve(
            { filter: /^@\/main$/ },
            () => ({ path: path.resolve(STUBS, "main.ts") })
        );

        // svelte / svelte/* → stubs/svelte.ts
        build.onResolve(
            { filter: /^svelte/ },
            () => ({ path: path.resolve(STUBS, "svelte.ts") })
        );
    },
};

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "commands/index": "src/commands/index.ts",
    },
    format: ["cjs"],
    outDir: "dist",
    platform: "node",
    target: "node20",
    bundle: true,
    splitting: false,
    minify: false,
    clean: true,
    noExternal: ["octagonal-wheels"],
    esbuildPlugins: [pathAliasPlugin],
});
