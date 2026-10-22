# Telegram plugin host compatibility

Host-side compatibility checks for the pinned `paperclip-plugin-telegram`
release. The job installs the plugin at an exact version against an exact
Paperclip SDK version, typechecks the plugin's published types against that
SDK, and runs behavioural tests over the installed artifact.

## What is pinned, and why it matters

| Package                    | Pinned version |
| -------------------------- | -------------- |
| `paperclip-plugin-telegram` | `0.8.1`        |
| `@paperclipai/plugin-sdk`  | `2026.1012.0`  |
| `@paperclipai/shared`      | `2026.1012.0`  |

The pin is a literal version, never a range, and the job never resolves
`latest`. `src/pinned.ts` is the single source of truth for the pinned
versions and for the SHA-512 integrity of each tarball; `compat.test.ts`
compares the installed packages against both, so a registry that serves a
different artifact fails the job instead of reaching a host.

The compatibility job is isolated from the workspace on purpose. The
workspace resolves `@paperclipai/plugin-sdk` and `@paperclipai/shared` to the
local packages, which would hide a break between a published plugin release
and a published SDK release. This directory has its own `package.json` and
`package-lock.json` and is installed with `npm ci`, so the published artifacts
are the ones under test.

## Running it

```sh
npm --prefix tests/plugin-telegram-compat ci --include=dev
npm --prefix tests/plugin-telegram-compat run typecheck
npm --prefix tests/plugin-telegram-compat run test
```

Or from the repository root:

```sh
pnpm run test:plugin-telegram-compat
```

## CI job

`ci/plugin-telegram-compat.yml` is the workflow. Install it at
`.github/workflows/plugin-telegram-compat.yml` in the host repository. It runs
on pull requests and pushes that touch this directory, on a weekly schedule
that re-verifies the pin, and on manual dispatch. The scheduled run also
reports the latest published upstream release in the job summary; it does not
fail, because the pin is intentionally not tracking `latest`.

The workflow has a second job, `host-allowlist-guard`, which runs
`test:host-policy`. That job fails when the host policy is missing or is
looser than the plugin runtime, because the pinned plugin release does not
reject an empty allowlist and the host policy is the only layer that does.

## Moving the pin

1. Update the versions in `package.json` and `src/pinned.ts`.
2. Run `npm install` in this directory to refresh `package-lock.json`, and
   update the recorded SHA-512 integrity values in `src/pinned.ts`.
3. If the new release ships the upstream allowlist enforcement fix, set
   `PINNED_PLUGIN_ENFORCES_ALLOWLIST` to `true`.

Step 3 is not optional bookkeeping: the compatibility test asserts that the
installed plugin's behaviour matches that flag, so a pin bump that changes the
plugin's allowlist behaviour fails the job until the flag is updated in the
same commit.

## Allowlist enforcement and the 0.8.1 pin

`paperclip-plugin-telegram@0.8.1` predates the upstream fix that makes
`validateTelegramAllowlists` reject an empty allowlist while `enableCommands`
or `enableInbound` is enabled. Until the pin moves to a release that ships
that fix, the layer that refuses the unsafe configuration is the host-side
plugin config policy in `server/src/services/plugin-config-policy.ts`, which
has its own unit tests.

The upstream fix is tracked in
`mvanhorn/paperclip-plugin-telegram` branch
`fix/require-allowlist-when-commands-or-inbound-enabled`.

## The host allowlist guard

`host-policy.test.ts` loads that host policy and executes it, so the guarantee
the host relies on is checked by this job instead of being assumed. Run it
with:

```sh
npm --prefix tests/plugin-telegram-compat run test:host-policy
```

The policy is resolved from the context the job runs in:

- inside the host repository, from `server/src/services/plugin-config-policy.ts`
  in the working tree;
- outside the host repository, from the published host repository
  (`paperclipai/paperclip@master`), so the standalone compatibility repository
  is a drift detector for the published host.

`HOST_POLICY_FILE` overrides both, for a policy file at a known path.

The assertions match the plugin runtime rather than a guess about it. The
pinned runtime enables commands for any truthy `enableCommands` value —
`true`, `"true"`, `"false"`, `1`, `[]`, `{}` — and `isTelegramUpdateAllowed`
returns `true` when the allowlist is empty, so the host policy has to require
an allowlist for exactly those values. A policy that only treats `true` as
enabled lets `{"enableCommands": "true"}` through, which the plugin's
`instanceConfigSchema` does not catch because it allows additional
properties.
