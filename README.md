# Telegram plugin upstream contribution and host compatibility CI

Deliverables for PUP-92 (PUP-89 M1).

## `upstream/`

`0001-fix-require-allowlist-when-commands-or-inbound-enabled.patch` is the
upstream change to `mvanhorn/paperclip-plugin-telegram`:

- `validateTelegramAllowlists` rejects an empty allowlist when
  `enableCommands` or `enableInbound` is enabled.
- The feature flags are optional on `TelegramAllowlistConfig` and are read with
  the same truthiness rule the worker runtime uses, so a config the worker
  would honour cannot pass validation. Absent flags keep the previous
  behaviour.
- Regression tests cover the validator and `plugin.onValidateConfig`.

`PR-BODY.md` is the pull request body.

The branch is pushed to
`https://github.com/sdkwala/paperclip-plugin-telegram` as
`fix/require-allowlist-when-commands-or-inbound-enabled`, based on upstream
`main` at `12be2bb2fc7693de9f2480f05cb45feaa19725c3`.

**The pull request itself is not open.** The managed GitHub identity this agent
runs with has read-only access to `mvanhorn/paperclip-plugin-telegram`, so
`create-pull-request`, `fork-repository` and `issue-write` all return
`403 Resource not accessible by integration`. Opening the pull request needs
one of:

```sh
# option A: someone with write access to the upstream repository
gh pr create --repo mvanhorn/paperclip-plugin-telegram \
  --base main \
  --head sdkwala:fix/require-allowlist-when-commands-or-inbound-enabled \
  --title "fix(security): require a non-empty allowlist when commands or inbound are enabled" \
  --body-file upstream/PR-BODY.md
```

```sh
# option B: grant the managed GitHub identity pull-request write on the
# upstream repository, then re-run the same command without the --repo flag
```

The patch applies cleanly to upstream `main` as of the commit above.

## `host/`

Files to add to the Paperclip host repository (`paperclipai/paperclip`):

- `.github/workflows/plugin-telegram-compat.yml` — the compatibility CI job.
- `tests/plugin-telegram-compat/**` — the compatibility fixture.

The job installs `paperclip-plugin-telegram@0.8.1` against
`@paperclipai/plugin-sdk@2026.1012.0` and `@paperclipai/shared@2026.1012.0`
with `npm ci` from a committed lockfile, typechecks the plugin's published
types against that SDK, and runs behavioural tests over the installed
artifact. The pin is a literal version and never resolves `latest`; the
recorded SHA-512 integrity of each tarball is asserted by the tests.

The fixture is isolated from the workspace on purpose: the workspace resolves
`@paperclipai/plugin-sdk` to the local package, which would hide a break
between a published plugin release and a published SDK release.

`tests/plugin-telegram-compat/src/pinned.ts` records what the pinned release
actually does. `PINNED_PLUGIN_ENFORCES_ALLOWLIST` is `false` for `0.8.1`,
which predates the upstream fix, so the host-side plugin config policy is the
layer that refuses an empty allowlist. The test fails if the installed
behaviour and that flag disagree, which makes moving the pin to the release
that ships the fix a deliberate, reviewed change.

The job also carries a second job, `host-allowlist-guard`, which loads the
host policy and executes it. See [Host allowlist guard](#host-allowlist-guard).

Verified locally in the host workspace:

```
npm --prefix tests/plugin-telegram-compat ci --include=dev --no-audit --no-fund
npm --prefix tests/plugin-telegram-compat run typecheck   # tsc --noEmit, clean
npm --prefix tests/plugin-telegram-compat run test         # 11 passed
```

## Host allowlist guard

The pinned plugin release does not reject an empty Telegram allowlist, so the
host policy in `server/src/services/plugin-config-policy.ts` is the only layer
that refuses an unsafe Telegram configuration. The compatibility job therefore
does not only test the plugin: a second job, `host-allowlist-guard`, loads
that policy and executes it.

The job resolves the policy from the context it runs in:

- inside the host repository it loads `server/src/services/plugin-config-policy.ts`
  from the working tree, so the build fails if the host stops shipping the
  guard;
- outside the host repository it loads the file from the published host
  repository (`paperclipai/paperclip@master`), so the build fails if the guard
  was never landed.

The guard asserts the property the plugin runtime actually has. The pinned
runtime gates on truthiness (`if (config.enableCommands)` in `dist/worker.js`),
so `true`, `"true"`, `"false"`, `1`, `[]` and `{}` all turn commands on, and
`isTelegramUpdateAllowed` returns `true` when the allowlist is empty. The host
policy has to require an allowlist for exactly those values.

## Finding: the host policy is looser than the plugin runtime

The host policy decides whether a feature flag is enabled with
`value === true` (`server/src/services/plugin-config-policy.ts`), while the
plugin runtime decides with truthiness. A configuration such as

```json
{ "enableCommands": "true" }
```

therefore passes the host guard — the flag is not `true` — while the runtime
enables commands, and `paperclip-plugin-telegram@0.8.1` accepts updates from
any user when the allowlist is empty. The plugin's own `instanceConfigSchema`
does not close the gap: it declares only the secret-ref fields and allows
additional properties, so the host's schema validation accepts the string.

`host-policy.test.ts` fails on that configuration, and the guard job fails with
it. The fix is one line in the host policy: read the flags with the runtime's
rule (`Boolean(value)`), which is also the rule the upstream fix uses.

Verified against the host workspace copy of the policy on 2026-10-22:

```
$ npm --prefix tests/plugin-telegram-compat run test:host-policy
x rejects an empty allowlist for every value the plugin runtime treats as enabled
AssertionError: the host policy accepted an empty allowlist with enableCommands
set to the string "true", but the plugin runtime enables commands for that value
```

The same test passes when the policy reads the flags with `Boolean(value)`.

## Host delivery state

The host policy is the layer the M1 guarantee rests on while the pin is
`0.8.1`, and it is not in the published host repository: `master` of
`paperclipai/paperclip` has no `server/src/services/plugin-config-policy.ts`,
no `server/src/__tests__/plugin-config-policy.test.ts` and no
`docs/plugin-telegram.md` (checked 2026-10-22). The policy exists in the host
workspace only, as an uncommitted edit, and the built server in that workspace
does not contain it either. A host built from the published repository
therefore has no allowlist guard at all, which is what the guard job reports.

## Compatibility CI (running)

The same job runs in CI in this repository, at
`.github/workflows/plugin-telegram-compat.yml`. It is identical to the host
copy in `host/.github/workflows/plugin-telegram-compat.yml` except for one
line: `FIXTURE_DIR` points at `host/tests/plugin-telegram-compat` here and at
`tests/plugin-telegram-compat` in the host repository.

| Run | Result |
| --- | --- |
| [Plugin compatibility (Telegram) #1](https://github.com/sdkwala/paperclip-telegram-compat/actions/runs/39759996849) | green — `npm ci` installed 56 packages, `tsc --noEmit` clean, 11 tests passed |

The job also reports, in the run summary:

- the upstream `main` head and whether upstream already rejects an empty
  allowlist (`upstream enforces: no`, head `12be2bb`, 2026-09-07);
- whether the delivered patch still applies to upstream `main`
  (`delivered patch still applies: yes`, 2026-10-22);
- the pinned release against the latest published release
  (`pinned: 0.8.1`, `latest published: 0.8.1`).

### Installing the job in the host repository

Copy two paths into the host repository (`paperclipai/paperclip`):

```
.github/workflows/plugin-telegram-compat.yml   <- from host/.github/workflows/plugin-telegram-compat.yml
tests/plugin-telegram-compat/                  <- from host/tests/plugin-telegram-compat/
```

The managed GitHub identity used for this delivery has pull-only access to
`paperclipai/paperclip` (verified: `permissions.push` is `false`), so the copy
needs someone with push access, or the grant to push those two paths directly.

`host/install-compat-ci.sh` does the copy for whoever has that access. It
creates a branch, commits both paths through the contents API and opens a
pull request; it never pushes to the base branch and never writes a credential
into a URL.

```sh
gh auth login            # or export GH_TOKEN=<token with write access>
./host/install-compat-ci.sh <owner/repo>
```

The script was verified end to end against a scratch repository: it created the
branch, wrote all eight files, opened the pull request, and the installed
workflow ran green from that pull request (run `39761042002` — `npm ci` 56
packages, `tsc --noEmit` clean, 11 tests passed). The scratch repository was
closed and deleted afterwards.

The guard job is part of the installed workflow, so the copy also fails while
the host repository has no allowlist policy, and while the policy is looser
than the plugin runtime. Both failures are the point: the compatibility job
refuses to be green on a host that would accept an unsafe Telegram
configuration.

## Pinned release availability

| Version                | Published | Provenance | Notes                                                        |
| ---------------------- | --------- | ---------- | ------------------------------------------------------------ |
| `paperclip-plugin-telegram@0.8.1` | yes | SLSA v1, GitHub Actions | built from `12be2bb2fc7693de9f2480f05cb45feaa19725c3` |
| `paperclip-plugin-telegram@0.8.2` | no  | n/a        | built and verified from the patched tree; the upstream maintainer publishes it |

`0.8.2` is not on the registry. As of 2026-10-22 the upstream `main` branch is
still at `12be2bb` (2026-09-07) and does not yet reject an empty allowlist, and
the delivered patch still applies to it cleanly. The patched tree builds (`tsc` clean), packs
(`npm pack`), installs against `@paperclipai/plugin-sdk@2026.1012.0`, typechecks
against that SDK, and enforces the allowlist with the expected error. The
upstream release workflow (`.github/workflows/publish.yml`) publishes the next
version on a push to `main`, so `0.8.2` becomes available once the fix is
merged and the maintainer cuts the release.
