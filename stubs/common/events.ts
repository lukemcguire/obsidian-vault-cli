/**
 * Stub for @/common/events — provides no-op event constants used from the Obsidian plugin.
 */
import { eventHub } from "../../livesync-commonlib/src/hub/hub.ts";

export { eventHub };
export const EVENT_ON_UNRESOLVED_ERROR = "on-unresolved-error";
export const EVENT_REQUEST_RELOAD_SETTING_TAB = "reload-setting-tab";

declare global {
    interface LSEvents {
        [EVENT_ON_UNRESOLVED_ERROR]: undefined;
        [EVENT_REQUEST_RELOAD_SETTING_TAB]: undefined;
    }
}
