import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  cleanupGeneratedPolicy,
  loadHostPolicyModule,
  loadHostPolicySource,
  type HostPolicyModule,
  type HostPolicyResult,
} from "./src/host-policy.js";

/**
 * The host allowlist guard.
 *
 * The pinned plugin release does not reject an empty Telegram allowlist, so
 * the host policy is the only layer that refuses an unsafe configuration. This
 * test loads that policy from wherever it is published — the host repository
 * when the job runs inside it, the published host repository otherwise — and
 * executes it, so the guarantee is checked rather than assumed.
 */

const TELEGRAM_PLUGIN_KEY = "paperclip-plugin-telegram";

/**
 * Values the plugin runtime treats as "enabled".
 *
 * The pinned runtime gates on truthiness (`if (config.enableCommands)` in
 * `dist/worker.js`), so every value below turns commands on, including the
 * strings "true" and "false" and the empty array and object. The host policy
 * has to require an allowlist for exactly these values, otherwise a truthy
 * non-boolean flag passes the host guard while the runtime honours it and the
 * plugin accepts updates from any user.
 */
const RUNTIME_ENABLED_VALUES: { label: string; value: unknown }[] = [
  { label: "true", value: true },
  { label: 'the string "true"', value: "true" },
  { label: 'the string "false"', value: "false" },
  { label: "1", value: 1 },
  { label: "an empty array", value: [] },
  { label: "an empty object", value: {} },
];

let policy: HostPolicyModule;
let origin = "";

function validate(config: Record<string, unknown>): HostPolicyResult {
  if (typeof policy.validatePluginConfigPolicy !== "function") {
    throw new Error("the host policy does not export validatePluginConfigPolicy");
  }
  return policy.validatePluginConfigPolicy(TELEGRAM_PLUGIN_KEY, config);
}

beforeAll(async () => {
  const loaded = await loadHostPolicySource();
  origin = loaded.origin;
  policy = await loadHostPolicyModule(loaded.source);
  // The resolution is printed so the job log records which host policy ran.
  console.log(`host allowlist policy loaded from: ${origin}`);
});

afterAll(() => {
  cleanupGeneratedPolicy();
});

describe("host allowlist guard", () => {
  it("loads a host policy that exports the plugin config policy", () => {
    expect(typeof policy.validatePluginConfigPolicy).toBe("function");
  });

  it("rejects an empty allowlist when commands are enabled", () => {
    const result = validate({ enableCommands: true });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.message).toMatch(/non-empty/);
  });

  it("rejects an empty allowlist when inbound is enabled", () => {
    const result = validate({ enableInbound: true });
    expect(result.valid).toBe(false);
    expect(result.errors?.[0]?.message).toMatch(/non-empty/);
  });

  it("rejects an empty allowlist for every value the plugin runtime treats as enabled", () => {
    for (const { label, value } of RUNTIME_ENABLED_VALUES) {
      const commands = validate({ enableCommands: value });
      expect(
        commands.valid,
        `the host policy accepted an empty allowlist with enableCommands set to ${label}, ` +
          `but the plugin runtime enables commands for that value`,
      ).toBe(false);
      const inbound = validate({ enableInbound: value });
      expect(
        inbound.valid,
        `the host policy accepted an empty allowlist with enableInbound set to ${label}, ` +
          `but the plugin runtime enables inbound for that value`,
      ).toBe(false);
    }
  });

  it("accepts a non-empty user allowlist", () => {
    const result = validate({ enableCommands: true, allowedTelegramUserIds: ["123"] });
    expect(result.valid).toBe(true);
  });

  it("accepts a non-empty chat allowlist", () => {
    const result = validate({ enableInbound: true, allowedTelegramChatIds: ["-1001"] });
    expect(result.valid).toBe(true);
  });

  it("allows an empty allowlist when commands and inbound are disabled", () => {
    expect(validate({ enableCommands: false, enableInbound: false }).valid).toBe(true);
    expect(validate({}).valid).toBe(true);
  });
});
