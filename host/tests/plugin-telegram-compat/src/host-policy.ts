/**
 * Locates and loads the host-side Telegram allowlist enforcement layer.
 *
 * The pinned plugin release (`0.8.1`) does not reject an empty allowlist, so
 * the only layer that refuses an unsafe Telegram configuration is the host
 * policy in `server/src/services/plugin-config-policy.ts`. This module finds
 * that policy and loads it, so the compatibility job can execute it instead of
 * trusting that it exists.
 *
 * Two contexts are supported, and they are the same code path:
 *
 * - Inside the host repository, the policy is read from the working tree, so
 *   the job fails if the host repository stops shipping the guard.
 * - Outside the host repository, the policy is read from the published host
 *   repository, so the job fails if the guard was never landed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HOST_POLICY_REPO = process.env.HOST_POLICY_REPO ?? "paperclipai/paperclip";
export const HOST_POLICY_REF = process.env.HOST_POLICY_REF ?? "master";
export const HOST_POLICY_RELATIVE_PATH = "server/src/services/plugin-config-policy.ts";

const fixtureRoot = fileURLToPath(new URL(".", import.meta.url));

export type HostPolicyResult = {
  valid: boolean;
  errors?: { field: string; message: string }[];
};

export type HostPolicyModule = {
  validatePluginConfigPolicy?: (
    pluginKey: string,
    configJson: Record<string, unknown>,
  ) => HostPolicyResult;
  validateTelegramPluginConfig?: (configJson: Record<string, unknown>) => HostPolicyResult;
};

export type HostPolicySource = {
  /** Human readable description of where the source came from. */
  origin: string;
  /** The TypeScript source of the host policy. */
  source: string;
};

const generatedDir = join(fixtureRoot, ".tmp");
const generatedFile = join(generatedDir, "host-policy.generated.ts");

/**
 * Walks up from the fixture to the root of the host repository.
 *
 * The host repository is identified by its `server` package rather than by
 * `.git`, because the fixture is also delivered as a standalone repository
 * that has a `.git` but is not a host.
 */
export function findHostRepositoryRoot(): string | null {
  let current = resolve(fixtureRoot);
  for (;;) {
    if (existsSync(join(current, "server"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function readLocalPolicy(root: string): HostPolicySource | null {
  const file = join(root, HOST_POLICY_RELATIVE_PATH);
  if (!existsSync(file)) {
    return null;
  }
  return {
    origin: `${HOST_POLICY_RELATIVE_PATH} (this repository)`,
    source: readFileSync(file, "utf8"),
  };
}

async function readPublishedPolicy(): Promise<HostPolicySource> {
  const url = `https://raw.githubusercontent.com/${HOST_POLICY_REPO}/${HOST_POLICY_REF}/${HOST_POLICY_RELATIVE_PATH}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `The published host repository ${HOST_POLICY_REPO}@${HOST_POLICY_REF} does not contain ` +
        `${HOST_POLICY_RELATIVE_PATH} (HTTP ${response.status}). The pinned plugin release ` +
        `paperclip-plugin-telegram@0.8.1 does not reject an empty Telegram allowlist, so with the ` +
        `host policy missing there is no layer that refuses an unsafe Telegram configuration. ` +
        `Land the host policy in the host repository, then re-run this job.`,
    );
  }
  return {
    origin: `${HOST_POLICY_RELATIVE_PATH} (${HOST_POLICY_REPO}@${HOST_POLICY_REF})`,
    source: await response.text(),
  };
}

/**
 * Resolves the host policy source for the current context.
 *
 * A host repository is checked first so the job fails against the code it is
 * meant to protect. Outside a host repository the published host repository is
 * used, which is what makes the standalone compatibility repository a drift
 * detector for the published host.
 */
export async function loadHostPolicySource(): Promise<HostPolicySource> {
  const override = process.env.HOST_POLICY_FILE;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`HOST_POLICY_FILE points at ${override}, which does not exist.`);
    }
    return {
      origin: `${HOST_POLICY_RELATIVE_PATH} (HOST_POLICY_FILE=${override})`,
      source: readFileSync(override, "utf8"),
    };
  }

  const root = findHostRepositoryRoot();
  if (root) {
    const local = readLocalPolicy(root);
    if (!local) {
      throw new Error(
        `This host repository does not contain ${HOST_POLICY_RELATIVE_PATH}. The pinned plugin ` +
          `release paperclip-plugin-telegram@0.8.1 does not reject an empty Telegram allowlist, so ` +
          `the host policy is the only layer that refuses an unsafe Telegram configuration.`,
      );
    }
    return local;
  }

  return readPublishedPolicy();
}

/**
 * Removes type-only imports so the policy can be executed on its own.
 *
 * The policy imports its only dependency as a type, which is erased at
 * compile time. Keeping the import would make the module depend on a
 * workspace package that the fixture deliberately does not resolve.
 */
export function stripTypeOnlyImports(source: string): string {
  return source.replace(/^[ \t]*import[ \t]+type[ \t]+[^;]+;[ \t]*$/gm, "");
}

/**
 * Loads the host policy module so its behaviour can be executed.
 *
 * The generated file is written inside the fixture so the test runner
 * transforms it the same way it transforms the rest of the fixture.
 */
export async function loadHostPolicyModule(source: string): Promise<HostPolicyModule> {
  mkdirSync(generatedDir, { recursive: true });
  writeFileSync(generatedFile, stripTypeOnlyImports(source), "utf8");
  return (await import(pathToFileURL(generatedFile).href)) as HostPolicyModule;
}

/**
 * Removes the generated copy of the host policy.
 *
 * The generated file is disposable: it exists only so the test runner can
 * transform the host source. It is deleted when the test file finishes so a
 * later typecheck never sees it.
 */
export function cleanupGeneratedPolicy(): void {
  rmSync(generatedDir, { recursive: true, force: true });
}
