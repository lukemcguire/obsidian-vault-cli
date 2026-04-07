# obsidian-vault-cli

A headless CLI for reading and writing to an encrypted [Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync) vault. Built for AI agents, scripts, and automation.

Your Obsidian vault stays end-to-end encrypted (AES-256-GCM). This CLI handles all encryption, chunking, and CouchDB protocol details transparently — files appear in Obsidian within seconds via LiveSync's real-time change feed.

## Why

Obsidian LiveSync encrypts everything in CouchDB. There's no way to read or write vault files without re-implementing the full encryption and chunking protocol. This project does exactly that — running headless against the same [livesync-commonlib](https://github.com/vrtmrz/livesync-commonlib) that powers the Obsidian plugin.

**Use cases:**
- AI agents (Claude Code, OpenCode, etc.) that need to read/write your notes
- Scripts that automate vault operations (backups, imports, daily note generation)
- CI/CD pipelines that publish content to your vault
- Any headless environment where you can't run Obsidian

## Quick start

### Prerequisites

- **Node.js** >= 20
- **Docker** (for CouchDB)
- An existing **Obsidian LiveSync** vault (the plugin must have synced at least once to populate CouchDB settings)

### 1. Clone

```bash
git clone --recursive https://github.com/lucafanselau/obsidian-vault-cli.git
cd obsidian-vault-cli
```

> `--recursive` pulls the `livesync-commonlib` submodule. If you forgot, run `git submodule update --init --recursive`.

### 2. Install dependencies

```bash
npm install
```

### 3. Build

```bash
npm run build
```

This compiles the CLI to `dist/` using tsup, eliminating the tsx startup overhead. The built bundle is what `obsidian-vault` runs.

### 4. Configure

Copy the example config to the XDG config directory:

```bash
mkdir -p ~/.config/obsidian-vault
cp .env.example ~/.config/obsidian-vault/config
```

Edit `~/.config/obsidian-vault/config` with your CouchDB credentials and LiveSync passphrase:

```dotenv
COUCHDB_USER=your_admin_user
COUCHDB_PASSWORD=your_secure_password
E2EE_PASSPHRASE=your_e2ee_passphrase
DB_NAME=obsidiannotes
# COUCHDB_URL=http://127.0.0.1:5984
```

> The `E2EE_PASSPHRASE` is the end-to-end encryption passphrase you set in the LiveSync plugin. It is **never** stored in CouchDB — you must always provide it externally.

**Config search order** (high → low priority):

1. **Environment variables** — always wins; Docker/CI-friendly
2. **`~/.config/obsidian-vault/config`** — XDG standard (`XDG_CONFIG_HOME` is respected)
3. **Repo-root `.env`** — deprecated fallback; prints a warning if used

### 5. Start CouchDB (if not already running)

```bash
docker compose -f couchdb/docker-compose.yml up -d
```

Or use your existing CouchDB instance — just point `COUCHDB_URL` at it.

### 6. Install the CLI

```bash
bash install.sh
```

This builds the bundle (if not already built), migrates config from a legacy `.env` if found, and symlinks `obsidian-vault` into `~/.local/bin/`. Make sure it's in your `PATH`.

### 7. Verify

```bash
obsidian-vault list
```

You should see your vault files listed.

## Commands

### `list` — List vault files

```bash
obsidian-vault list                          # all files
obsidian-vault list "Projects/"              # files under a folder
obsidian-vault list "Daily Notes/" --long    # with size + mtime
```

### `read` — Read a file

```bash
obsidian-vault read "Projects/roadmap.md"
```

Content goes to stdout, status to stderr. Pipe-friendly.

### `write` — Create or overwrite a file

```bash
obsidian-vault write "Notes/hello.md" "# Hello World"
echo "longer content" | obsidian-vault write "Notes/hello.md"
cat local-file.md | obsidian-vault write "Notes/imported.md"
```

Folders are created automatically. The file appears in Obsidian within seconds.

### `patch` — Targeted edits

The agent-native way to edit files. Reads the file, applies the change, writes back — all in one command.

```bash
# Replace text (like Claude Code's Edit tool)
obsidian-vault patch "Notes/todo.md" --old "## Tasks" --new "## Tasks\n- New item"

# Replace all occurrences
obsidian-vault patch "Notes/doc.md" --old "typo" --new "fixed" --all

# Append to end of file
obsidian-vault patch "Notes/log.md" --append "## 2026-03-22\nEntry added."
echo "piped content" | obsidian-vault patch "Notes/doc.md" --append
```

**Error handling** mirrors Claude Code's Edit tool:
- Errors if `--old` text is not found (exit code 1)
- Errors if multiple matches found (unless `--all` is passed)
- Creates the file if it doesn't exist (append mode only)

### `grep` — Search file contents

Decrypts and searches files on the fly. `--path` is required to scope the search for performance.

```bash
obsidian-vault grep "sprint" --path "Projects/"
obsidian-vault grep "TODO|FIXME" --path "Projects/" -i        # case-insensitive
obsidian-vault grep "meeting" --path "Daily Notes/" --long     # show matching lines
obsidian-vault grep "pattern" --path "Notes/" -n 10            # limit results
```

### `search` — Search file paths

```bash
obsidian-vault search "Projects/"
obsidian-vault search "\.md$"
```

### `meta` — File metadata

```bash
obsidian-vault meta "Projects/roadmap.md"
# → JSON: mtime, ctime, size, chunk count
```

### `delete` — Delete a file

```bash
obsidian-vault delete "Notes/old.md" --yes    # --yes skips confirmation
```

### `dump` — Export entire vault

```bash
obsidian-vault dump ./vault-export
```

### `mirror` — Incremental local sync

Sync vault files to a local directory. First run pulls everything; subsequent runs only download changed files. Designed for cron jobs and automated backups.

```bash
# Full sync (first run)
obsidian-vault mirror ./vault-mirror

# Subsequent runs — only changed files
obsidian-vault mirror ./vault-mirror

# Delete local files that were removed from the vault
obsidian-vault mirror ./vault-mirror --delete

# Preview without writing
obsidian-vault mirror ./vault-mirror --dry-run

# Quiet mode (cron-friendly, errors still shown)
obsidian-vault mirror ./vault-mirror --quiet
```

Mirror state (CouchDB changes cursor) is persisted in `<output-dir>/.mirror-state.json`. Local files newer than their vault counterpart are treated as conflicts and skipped.

## Agent integration

This CLI is designed to be used by AI coding agents. Drop the skill file into your agent's configuration:

### Claude Code / OpenCode

Copy `skills/obsidian-livesync.md` into your agent's skill directory:

```bash
# Claude Code
cp skills/obsidian-livesync.md ~/.claude/skills/obsidian-livesync/SKILL.md

# OpenCode
cp skills/obsidian-livesync.md ~/.config/opencode/skill/obsidian-livesync/SKILL.md
```

The skill teaches the agent:
- Which commands to use and when
- To prefer `patch` over `write` for edits
- To always scope `grep` with `--path`
- To use `list` with folder prefixes for exploration

### Example agent workflows

```bash
# Explore a project folder
obsidian-vault list "Projects/MyApp/"

# Search for relevant notes
obsidian-vault grep "architecture" --path "Projects/MyApp/" --long

# Read a specific note
obsidian-vault read "Projects/MyApp/decisions.md"

# Make a targeted edit
obsidian-vault patch "Projects/MyApp/decisions.md" \
  --old "## Status: Draft" \
  --new "## Status: Approved"

# Append to a running log
obsidian-vault patch "Projects/MyApp/changelog.md" \
  --append "## $(date +%Y-%m-%d)\n- Updated architecture decision"

# Create a new note
obsidian-vault write "Projects/MyApp/meeting-notes.md" "$(cat <<'EOF'
# Meeting Notes — 2026-03-22

## Attendees
- ...

## Decisions
- ...
EOF
)"
```

## How it works

The CLI uses Obsidian LiveSync's own [livesync-commonlib](https://github.com/vrtmrz/livesync-commonlib) library (included as a git submodule) to speak the exact same protocol as the Obsidian plugin. It connects directly to CouchDB as a headless client.

### Architecture

```
obsidian-vault CLI
  └── DirectFileManipulator (livesync-commonlib)
        ├── PouchDB → CouchDB (direct HTTP, no local replica)
        ├── AES-256-GCM encryption (HKDF v2, transparent via transform-pouch)
        └── Rabin-Karp content chunking (content-addressed, deduplicated)
```

### Settings auto-detection

All vault settings (chunk size, hash algorithm, encryption algorithm, etc.) are **automatically fetched** from CouchDB at startup. The CLI reads `_local/obsydian_livesync_milestone` and matches the exact configuration your vault uses. No manual tuning needed.

### What gets stored in CouchDB

Each file becomes two types of documents:

| Document | ID format | Contains |
|----------|-----------|----------|
| **Metadata** | `f:<sha256>` | Encrypted path, timestamps, ordered chunk list |
| **Chunks** | `h:+<xxhash64>` | Encrypted content pieces (AES-256-GCM) |

Everything is encrypted. The `path`, `mtime`, `ctime`, and `size` fields in metadata docs are zeroed — the real values live inside the encrypted envelope. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full protocol documentation.

## Output conventions

| Stream | Contains |
|--------|----------|
| stdout | File content, paths, JSON — pipe-friendly |
| stderr | Status messages, progress, errors |

All commands support `--verbose` (`-v`) for detailed internal logging.

## Project structure

```
obsidian-vault-cli/
├── livesync-commonlib/     # git submodule — Obsidian LiveSync's core library
├── src/
│   ├── commands/           # CLI commands (list, read, write, patch, grep, mirror, ...)
│   ├── lib/
│   │   └── connection.ts   # DFM factory, vault settings auto-detection
│   └── index.ts            # oclif entry point
├── dist/                   # Compiled bundle (tsup output, gitignored)
├── stubs/                  # Node.js stubs for Obsidian/Svelte APIs
├── bin/
│   └── obsidian-vault      # Shell wrapper (runs dist/index.cjs)
├── couchdb/
│   ├── docker-compose.yml  # CouchDB container
│   └── docker.ini          # CouchDB config (CORS, auth, limits)
├── docs/
│   └── ARCHITECTURE.md     # Deep-dive: encryption, chunking, protocol
├── skills/
│   └── obsidian-livesync.md  # Agent skill file for Claude Code / OpenCode
├── .env.example
├── install.sh
├── tsup.config.ts          # Build config with path alias plugin
└── package.json
```

## Troubleshooting

### CouchDB not responding

```bash
curl -s http://127.0.0.1:5984/
docker compose -f couchdb/docker-compose.yml ps
```

### "No tweak_values found in milestone doc"

The vault hasn't been synced yet. Open Obsidian with the LiveSync plugin, sync at least once, then try again.

### Process hangs after completion

This is a known PouchDB behavior — some internal timer keeps the event loop alive. The CLI handles this with `process.exit()` in all commands.

### "File X seems to be corrupted"

If you see this in Obsidian after a write, it usually means the `size` field didn't match the actual UTF-8 byte length. The CLI handles this correctly, but if you're using the library directly, always use `new TextEncoder().encode(content).byteLength`.

## Credits

- [Obsidian LiveSync](https://github.com/vrtmrz/obsidian-livesync) by [@vrtmrz](https://github.com/vrtmrz) — the Obsidian plugin and protocol
- [livesync-commonlib](https://github.com/vrtmrz/livesync-commonlib) — the shared library this CLI builds on

## License

MIT — see [LICENSE](LICENSE).
