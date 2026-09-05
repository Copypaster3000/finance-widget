# Release candidate verification

Current candidate: **0.1.3**. Publication is a separate, final action after manual verification. Do not upload an older installer just because it remains in the build directory.

## Current verification status

The candidate's automated checks passed: 170 frontend tests across 19 files, 16 native persistence tests, Svelte checking with zero errors/warnings, frontend production build, and Windows Tauri/NSIS build. Public-data scanning and staged-diff checks also passed.

**Pending:** disposable installed-profile regression, high-DPI visual verification, ordinary Start Menu/Search/Explorer launch parity, restart testing, and the subsequent real-profile smoke test. Automated tests are not evidence that these installed scenarios passed. No public release is authorized by this record.

## Automated gates

Run `npm run check`, `npm test`, `npm run build`, native `cargo test --manifest-path src-tauri/Cargo.toml --lib`, `npm run tauri build`, and `npm run privacy:check`. Stage the exact version with `npm run release:stage`; use only the matching installer and checksum under `src-tauri/target/release-candidate/0.1.3/`.

## Disposable installed-profile gates (not implied by unit tests)

Use a disposable Windows account or Windows Sandbox with no real portfolio. Never overwrite a real profile to simulate corruption. Close the app before changing test files. Saved data is under `%APPDATA%\com.copypaster3000.finance-widget`.

- Create a distinctive fictional asset and transactions. Confirm exact cents, eight-decimal quantities, backdated Cash/Debt targets, and zero-net sales.
- Test an empty-object primary with a valid populated backup: show recovery, preserve the backup, and never show ordinary first-run emptiness.
- Test a newer-schema primary: show compatibility feedback and leave both files unchanged.
- Test malformed financial records without a valid backup: show an integrity error, never a partial authoritative total.
- Test malformed caches with valid financial records: retain holdings and refetch/discard caches.
- Verify stale-price confirmation and actual price dates, failed refresh retry, session change during refresh, and readable editing at high DPI.

## Ordinary launch parity (human verification required)

Close between launches. Open the same disposable profile through **Start Menu**, **Windows Search**, and **Explorer/direct installed executable**. All must show the same fictional records and version. Check that each shortcut points to the same installed executable and that the app-data identifier remains `com.copypaster3000.finance-widget`. Repeat after a computer restart.

Launches inherited from a packaged development tool do not substitute for these checks. If automation cannot independently reach the normal Windows context, request human verification and leave this gate pending.

## Real-profile smoke gate

Only after disposable tests succeed: back up the real profile privately, install using `/S /NS` (no desktop shortcut), verify holdings/Cash/Debt/chart/settings/refresh, then close and reopen normally. Compare ledger and configuration before/after; market caches may change. Never commit private stores, recovery snapshots, screenshots, or diagnostic paths.

## Candidate behavior and limitations

- Authoritative records are validated before recovery or backup rotation. Existing incomplete files are not first runs. Future schemas never automatically downgrade.
- Cache validation is separate from financial-record validation. Recovery metadata is runtime-only, with a visible recovery notice.
- New dated Set Balance entries follow same-day transactions; edits retain their sequence. Records remain fixed adjustments when earlier history is edited later.
- History uses one chronological accounting cursor. Per-point position valuation still scales with the number of assets.
- Price requests have a bounded frontend deadline; native session HTTP also has connect/total deadlines. Configuration changes invalidate old results and queue one latest-config follow-up.
- Closed-market freshness is conservative, using the existing US session calendar and a four-day maximum close age. It is not an exchange holiday-calendar service; stale prices require confirmation.
- No automatic app updater, currency conversion, or new public release is introduced by this pass.
