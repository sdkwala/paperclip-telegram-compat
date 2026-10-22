## Problem

`validateTelegramAllowlists` only checked that the allowlist config values were arrays. An empty allowlist passed validation, and `isTelegramUpdateAllowed` then returns `true` for every sender when both allowlists are empty.

The result is that a config with `enableCommands` or `enableInbound` enabled and no allowlist is accepted, and the bot's commands, inbound replies, media intake, and inline buttons are then open to anyone who can reach it. The README already says to configure an allowlist before enabling either feature, but nothing enforced it.

## Change

`validateTelegramAllowlists` now rejects an empty allowlist whenever `enableCommands` or `enableInbound` is enabled:

- `TelegramAllowlistConfig` gains optional `enableCommands` / `enableInbound` fields.
- The flags are read with the same truthiness rule the worker runtime uses (`if (config.enableCommands)` in `src/worker.ts`), so a config the worker would honour cannot pass validation. A string `"true"` or a numeric `1` is treated as enabled, matching the runtime.
- An allowlist that contains only blank entries (`""`, `"  "`) counts as empty, matching how `normalizeAllowlist` treats those values at runtime.
- The new error is `enableCommands/enableInbound requires a non-empty allowedTelegramUserIds or allowedTelegramChatIds.`

## Backward compatibility

The new fields are optional and absent flags keep the previous behaviour, so `validateTelegramAllowlists({})` still returns `[]` and callers that only pass allowlists are unaffected. The change only rejects configs that enable a feature without any allowlist entry — the combination the README already documents as unsafe.

The type error message for a non-array allowlist was updated because "Leave it empty to allow any user/chat" is no longer accurate when commands or inbound are enabled.

## Tests

`tests/worker-allowlist.test.ts` gains regression coverage:

- an empty allowlist is rejected when `enableCommands` is enabled
- an empty allowlist is rejected when `enableInbound` is enabled
- an allowlist of blank entries is rejected
- an empty allowlist is accepted when both features are disabled
- a non-empty allowlist is accepted when either feature is enabled
- configs that do not set the flags behave as before
- the flags are read with the runtime's truthiness rule
- `plugin.onValidateConfig` rejects the unsafe config and accepts the safe ones

`npm run typecheck`, `npm test` (416 tests) and `npm run build` pass locally.

## Release note

This is expected to ship in the next release (0.8.2). The `0.8.1` tarball on npm still ships the old behaviour, so hosts that pin `paperclip-plugin-telegram@0.8.1` need to keep enforcing the allowlist rule host-side until the pinned version is bumped.
