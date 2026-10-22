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

Verified locally in the host workspace:

```
npm --prefix tests/plugin-telegram-compat ci --include=dev --no-audit --no-fund
npm --prefix tests/plugin-telegram-compat run typecheck   # tsc --noEmit, clean
npm --prefix tests/plugin-telegram-compat run test         # 11 passed
```

## Pinned release availability

| Version                | Published | Provenance | Notes                                                        |
| ---------------------- | --------- | ---------- | ------------------------------------------------------------ |
| `paperclip-plugin-telegram@0.8.1` | yes | SLSA v1, GitHub Actions | built from `12be2bb2fc7693de9f2480f05cb45feaa19725c3` |
| `paperclip-plugin-telegram@0.8.2` | no  | n/a        | built and verified from the patched tree; the upstream maintainer publishes it |

`0.8.2` is not on the registry. The patched tree builds (`tsc` clean), packs
(`npm pack`), installs against `@paperclipai/plugin-sdk@2026.1012.0`, typechecks
against that SDK, and enforces the allowlist with the expected error. The
upstream release workflow (`.github/workflows/publish.yml`) publishes the next
version on a push to `main`, so `0.8.2` becomes available once the fix is
merged and the maintainer cuts the release.
