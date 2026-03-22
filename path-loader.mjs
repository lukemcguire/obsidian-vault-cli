/**
 * Custom Node.js ESM loader to resolve @lib/ path aliases
 * @lib/ → ./livesync-commonlib/src/
 * @lib/worker/bgWorker.ts → ./livesync-commonlib/src/worker/bgWorker.mock.ts (special case)
 */

import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMONLIB = path.join(__dirname, 'livesync-commonlib', 'src');

export function resolve(specifier, context, nextResolve) {
  // Special case: @lib/worker/bgWorker.ts → bgWorker.mock.ts
  if (specifier === '@lib/worker/bgWorker.ts' || specifier === '@lib/worker/bgWorker') {
    const resolved = path.join(COMMONLIB, 'worker/bgWorker.mock.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  
  // Special case: pouchdb-browser → pouchdb-http (no IndexedDB in Node.js)
  if (specifier === '@lib/pouchdb/pouchdb-browser.ts' || specifier === '@lib/pouchdb/pouchdb-browser') {
    const resolved = path.join(COMMONLIB, 'pouchdb/pouchdb-http.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  // Also catch relative imports of pouchdb-browser.ts from within the commonlib
  if (specifier.endsWith('pouchdb-browser.ts') || specifier.endsWith('pouchdb-browser')) {
    const resolved = path.join(COMMONLIB, 'pouchdb/pouchdb-http.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  
  // General case: @lib/something → livesync-commonlib/src/something
  if (specifier.startsWith('@lib/')) {
    const rest = specifier.slice('@lib/'.length);
    const resolved = path.join(COMMONLIB, rest);
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  
  // @/lib/src/* → livesync-commonlib/src/* (plugin's reference back to commonlib)
  if (specifier.startsWith('@/lib/src/')) {
    const rest = specifier.slice('@/lib/src/'.length);
    // Strip .svelte extension files - use stub
    if (rest.endsWith('.svelte')) {
      const resolved = path.join(__dirname, 'stubs/svelte-stub.ts');
      return nextResolve(pathToFileURL(resolved).href, context);
    }
    const resolved = path.join(COMMONLIB, rest);
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  // @/ aliases — these come from the Obsidian plugin repo, we provide stubs
  if (specifier.startsWith('@/common/')) {
    const rest = specifier.slice('@/common/'.length);
    const resolved = path.join(__dirname, 'stubs/common', rest + '.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  // @/deps → stub (Obsidian plugin dependency injections)
  if (specifier === '@/deps' || specifier === '@/deps.ts') {
    const resolved = path.join(__dirname, 'stubs/deps.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  // @/main → stub (Obsidian plugin main class)
  if (specifier === '@/main') {
    const resolved = path.join(__dirname, 'stubs/main.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }

  // svelte → stub (UI framework, not needed for headless operation)
  if (specifier === 'svelte' || specifier.startsWith('svelte/')) {
    const resolved = path.join(__dirname, 'stubs/svelte.ts');
    return nextResolve(pathToFileURL(resolved).href, context);
  }
  
  return nextResolve(specifier, context);
}
