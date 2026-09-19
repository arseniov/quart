# @quart/mobile

Expo SDK 54 (React Native 0.81) app for Quart — civic engagement (polls, ideas, issues) for Italian municipalities.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm --filter @quart/mobile start` | Launch Metro bundler with the Expo dev client |
| `pnpm --filter @quart/mobile typecheck` | `tsc --noEmit` |
| `pnpm --filter @quart/mobile test` | Jest unit tests (inline mocks per test, no shared setup file) |
| `pnpm --filter @quart/mobile test:e2e` | Maestro E2E flows under `.maestro/flows/` |
| `pnpm --filter @quart/mobile lint` | ESLint v9 flat config |
| `pnpm --filter @quart/mobile scripts/dev-smoke.sh` | Local dev-loop smoke test (spawns Metro, waits for bundle) |

## i18n

Default locale is `it`. Add new keys to BOTH `src/i18n/locales/it.json` and `src/i18n/locales/en.json` — never hardcode English in source. Maestro flows target the default (Italian) locale until Maestro supports per-flow language switching.

## Accessibility

- `src/a11y/hit-slop.ts` — `minHitSlop(size)` returns symmetric hit-slop padding for a Pressable so the touch area meets the WCAG 2.5.5 44pt target.
- `src/a11y/motion.ts` — `useReduceMotion()` and `useScreenReaderEnabled()` wrap `AccessibilityInfo`.

## Verification checklist

Before shipping a Phase completion:

- `pnpm --filter @quart/mobile typecheck`
- `pnpm --filter @quart/mobile test`
- `pnpm --filter @quart/mobile lint`

Manual (not CI-implementable):

- EAS preview build: `pnpm --filter @quart/mobile eas:build:preview` — requires Expo account + project id. Out of scope for CI; verify locally before tagging.
- App Store / Play Store submission: see root `CONTRIBUTING.md`.