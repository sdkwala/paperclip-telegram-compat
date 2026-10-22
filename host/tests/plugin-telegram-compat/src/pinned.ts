/**
 * Single source of truth for the pinned Telegram plugin release this host is
 * tested against.
 *
 * Every value here is a literal, not a range. The compatibility job installs
 * exactly these versions and fails when the installed artifact does not match,
 * so an upstream release can never silently change what the host ships.
 */

export const PINNED_PLUGIN_PACKAGE = "paperclip-plugin-telegram";
export const PINNED_PLUGIN_VERSION = "0.8.1";

export const PINNED_PLUGIN_SDK_PACKAGE = "@paperclipai/plugin-sdk";
export const PINNED_PLUGIN_SDK_VERSION = "2026.1012.0";

export const PINNED_SHARED_PACKAGE = "@paperclipai/shared";
export const PINNED_SHARED_VERSION = "2026.1012.0";

/**
 * SHA-512 integrity of the pinned tarballs, as recorded in the lockfile.
 * The job compares the installed package against these values, so a registry
 * that serves a different artifact fails the job instead of reaching a host.
 */
export const PINNED_INTEGRITY = {
  "paperclip-plugin-telegram": "sha512-4IvVI5m3Gaslrc4AA94+Xi2dmRr8E8j02fGMWzLXIxJJ497Chcu3vRQ+SDAoPjrGDalJzb+9bzM+BQxgHFZ3pg==",
  "@paperclipai/plugin-sdk": "sha512-9T5loVkWyNARibDwye31P4YbrFpq0MiREF1lX8jrKlyvv0MQQZOiQnLUExyoBQ14F9jz8fQB1MhWIdBdj42zpQ==",
  "@paperclipai/shared": "sha512-NjLv0R+/4zgt1po9Phj6t/KqGwlDgofKKXu8fVzHCd9wvzl1QePdMADyR1HTWfujA7dre6NrDGCCCnbQViLUUg==",
} as const;

/**
 * Whether the pinned release rejects an empty Telegram allowlist while
 * `enableCommands` or `enableInbound` is enabled.
 *
 * 0.8.1 predates the upstream fix, so the host-side policy
 * (`server/src/services/plugin-config-policy.ts`) is the only layer that
 * refuses the unsafe configuration. When the pin moves to the release that
 * ships the upstream fix, flip this to `true` in the same commit: the job
 * fails whenever the installed behaviour and this table disagree, which makes
 * a version bump a deliberate, reviewable change instead of a silent one.
 */
export const PINNED_PLUGIN_ENFORCES_ALLOWLIST = false;

/**
 * The error the upstream fix introduces. Kept here so the host can show the
 * same message the plugin shows once the pin moves past 0.8.1.
 */
export const ALLOWLIST_REQUIRED_ERROR =
  "enableCommands/enableInbound requires a non-empty allowedTelegramUserIds or allowedTelegramChatIds.";
