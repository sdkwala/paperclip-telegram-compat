import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import manifest from "paperclip-plugin-telegram/dist/manifest.js";
import {
  isTelegramUpdateAllowed,
  validateTelegramAllowlists,
} from "paperclip-plugin-telegram/dist/allowlist.js";

import {
  ALLOWLIST_REQUIRED_ERROR,
  PINNED_INTEGRITY,
  PINNED_PLUGIN_ENFORCES_ALLOWLIST,
  PINNED_PLUGIN_PACKAGE,
  PINNED_PLUGIN_SDK_PACKAGE,
  PINNED_PLUGIN_SDK_VERSION,
  PINNED_PLUGIN_VERSION,
  PINNED_SHARED_PACKAGE,
  PINNED_SHARED_VERSION,
} from "./src/pinned.js";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * Host-shaped view of the plugin configuration.
 *
 * The pinned 0.8.1 types do not model the feature flags — `enableCommands` and
 * `enableInbound` are not part of `TelegramAllowlistConfig` in that release —
 * even though the plugin reads them at runtime. The cast below is therefore
 * limited to the published parameter type, and the assertion table in
 * `src/pinned.ts` records what the pinned release actually does with them.
 */
type HostShapedConfig = {
  enableCommands?: boolean;
  enableInbound?: boolean;
  allowedTelegramUserIds?: unknown;
  allowedTelegramChatIds?: unknown;
};

function pluginAllowlistErrors(config: HostShapedConfig): string[] {
  return validateTelegramAllowlists(
    config as Parameters<typeof validateTelegramAllowlists>[0],
  );
}

function installedPackageJson(packageName: string): { name?: string; version?: string } {
  // Read from disk instead of `require`, because a package with an `exports`
  // map does not expose ./package.json as a subpath.
  return JSON.parse(
    readFileSync(`${fixtureRoot}/node_modules/${packageName}/package.json`, "utf8"),
  ) as { name?: string; version?: string };
}

function installedVersion(packageName: string): string {
  return installedPackageJson(packageName).version ?? "";
}

function lockfileEntry(packageName: string): { version?: string; integrity?: string } {
  const lock = JSON.parse(
    readFileSync(`${fixtureRoot}/package-lock.json`, "utf8"),
  ) as {
    packages: Record<string, { version?: string; integrity?: string }>;
  };
  return lock.packages[`node_modules/${packageName}`] ?? {};
}

describe("pinned Telegram plugin artifact", () => {
  it("installs exactly the pinned plugin version", () => {
    expect(installedPackageJson(PINNED_PLUGIN_PACKAGE).name).toBe(
      PINNED_PLUGIN_PACKAGE,
    );
    expect(installedVersion(PINNED_PLUGIN_PACKAGE)).toBe(PINNED_PLUGIN_VERSION);
  });

  it("installs the pinned Paperclip SDK and shared packages", () => {
    expect(installedVersion(PINNED_PLUGIN_SDK_PACKAGE)).toBe(
      PINNED_PLUGIN_SDK_VERSION,
    );
    expect(installedVersion(PINNED_SHARED_PACKAGE)).toBe(PINNED_SHARED_VERSION);
  });

  it("resolves every pinned package to the recorded tarball integrity", () => {
    for (const [packageName, integrity] of Object.entries(PINNED_INTEGRITY)) {
      expect(lockfileEntry(packageName).integrity, packageName).toBe(integrity);
      expect(lockfileEntry(packageName).version, packageName).toBe(
        installedVersion(packageName),
      );
    }
  });

  it("ships the worker entrypoint the manifest declares", () => {
    const workerEntrypoint = manifest.entrypoints?.worker;
    expect(typeof workerEntrypoint).toBe("string");
    const resolved = `${fixtureRoot}/node_modules/${PINNED_PLUGIN_PACKAGE}/${String(workerEntrypoint).replace(/^\.\//, "")}`;
    expect(() => readFileSync(resolved)).not.toThrow();
  });
});

describe("Telegram plugin types against the pinned host SDK", () => {
  it("types the plugin manifest as a host plugin manifest", () => {
    // Compile-time assertion: the pinned plugin manifest must satisfy the
    // manifest type of the pinned Paperclip SDK.
    const manifestAsHostType: PaperclipPluginManifestV1 = manifest;
    expect(manifestAsHostType.id).toBe(PINNED_PLUGIN_PACKAGE);
    expect(manifestAsHostType.apiVersion).toBe(1);
  });

  it("declares the capabilities the host grants for a notification channel", () => {
    const capabilities = new Set(manifest.capabilities ?? []);
    expect(capabilities.has("events.subscribe")).toBe(true);
    expect(capabilities.has("http.outbound")).toBe(true);
    expect(capabilities.has("issues.read")).toBe(true);
    expect(capabilities.has("secrets.read-ref")).toBe(true);
  });
});

describe("Telegram allowlist enforcement in the pinned plugin", () => {
  const unsafeConfig = {
    enableCommands: true,
    enableInbound: true,
    allowedTelegramUserIds: [],
    allowedTelegramChatIds: [],
  };

  it("matches the recorded enforcement behaviour of the pinned release", () => {
    const pluginErrors = pluginAllowlistErrors(unsafeConfig);
    if (PINNED_PLUGIN_ENFORCES_ALLOWLIST) {
      expect(pluginErrors).toEqual([ALLOWLIST_REQUIRED_ERROR]);
    } else {
      // 0.8.1 predates the upstream fix. The host-side policy in
      // server/src/services/plugin-config-policy.ts is the layer that refuses
      // this configuration, and it is covered by the host's own unit tests.
      expect(pluginErrors).toEqual([]);
    }
  });

  it("never reports an error for a configured allowlist", () => {
    expect(
      pluginAllowlistErrors({ ...unsafeConfig, allowedTelegramUserIds: ["123"] }),
    ).toEqual([]);
    expect(
      pluginAllowlistErrors({
        ...unsafeConfig,
        allowedTelegramChatIds: ["-1001"],
      }),
    ).toEqual([]);
  });

  it("never reports an error for a notify-only configuration", () => {
    expect(
      pluginAllowlistErrors({
        enableCommands: false,
        enableInbound: false,
        allowedTelegramUserIds: [],
        allowedTelegramChatIds: [],
      }),
    ).toEqual([]);
  });
});

describe("Telegram allowlist runtime behaviour of the pinned plugin", () => {
  it("accepts any sender while both allowlists are empty", () => {
    expect(
      isTelegramUpdateAllowed(
        { allowedTelegramUserIds: [], allowedTelegramChatIds: [] },
        {
          update_id: 1,
          message: {
            from: { id: 123 },
            chat: { id: 456 },
          },
        },
      ),
    ).toBe(true);
  });

  it("blocks senders outside a configured user allowlist", () => {
    expect(
      isTelegramUpdateAllowed(
        { allowedTelegramUserIds: ["123"], allowedTelegramChatIds: [] },
        {
          update_id: 1,
          message: {
            from: { id: 999 },
            chat: { id: 456 },
          },
        },
      ),
    ).toBe(false);
  });
});
