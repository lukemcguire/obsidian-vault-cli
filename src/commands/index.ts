/**
 * Command registry for oclif explicit strategy.
 * Exported as `default` (oclif looks for module[identifier] where identifier defaults to 'default').
 */

import List from "./list.ts";
import Read from "./read.ts";
import Search from "./search.ts";
import Meta from "./meta.ts";
import Write from "./write.ts";
import Delete from "./delete.ts";
import Dump from "./dump.ts";
import Patch from "./patch.ts";
import Grep from "./grep.ts";

const commands = {
    list: List,
    read: Read,
    search: Search,
    meta: Meta,
    write: Write,
    delete: Delete,
    dump: Dump,
    patch: Patch,
    grep: Grep,
};

export default commands;
