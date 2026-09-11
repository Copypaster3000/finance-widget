# Safe cleanup — 0.1.5 candidate

Scope: low-risk cleanup from the 0.1.4 audit baseline. No installation, real-profile access, public release, accounting rewrite, or schema bump.

## Canonical owners

- `transactions.ts`: trade draft, displayed total, and saved total. Component tests cover fractional-cent BUY/SELL, total-input modes, zero-net proceeds, and displayed/previewed/saved equality.
- `config.ts`: production and test configuration normalization, migration, calendar validation, and appearance scale normalization. Storage retains native-vs-browser routing and persistence safeguards.
- `ledger.ts`: deterministic replay and account snapshots. Holdings use the existing snapshot; previews reuse the already validated proposed replay.
- `historyStart.ts`: shared automatic/manual start rule for App and historical reconstruction, including legacy migration coverage.
- History-range persistence failures retain the saved selection and display a retryable error. Browser previews skip native window calls; native failures receive a distinct message.

## Retired paths and test migration

Removed legacy portfolio calculation, daily portfolio reconstruction, hourly total synchronization, holdings CRUD, config serialization wrappers, partial quote usability checks, unused calendar/time/format helpers, unused live-ledger valuation, and the unused mock provider and prices. Active daily-price caching, recent samples, chart ranges, and history-change calculations remain.

Fractional valuation/allocation/sorting/missing-price tests now exercise `calculateLedgerPortfolio`. Historical reconstruction tests exercise `calculateLedgerHistory` and `syncLedgerPriceCache`; mixed stock/crypto/Cash/Debt coverage is retained. The retired hourly API's assumption that old totals survive quantity edits was obsolete: active history reconstructs edited quantities and dates. Quote/calendar tests now exercise the production policy and local-calendar path.

## Work reduction (deterministic workload, not a timing claim)

- Adjacent quote/recent caches: **2 native writes -> 1**, using the same queued multi-key save command. Native validation, file lock, stale-write checks, replacement, and backup rotation are unchanged. Independent history-price synchronization may still perform its own save.
- A 100-event synthetic preview: **300 existing-event quantity reads -> 200**, corresponding to three replay passes becoming two. The entire preview result and proposed replay match the previous calculation.
- Deriving holdings from an existing account snapshot performs **0 further event reads**, eliminating the second surrounding account replay. No long-lived replay cache was added.

## Shared validation fixtures

`tests/fixtures/validation-parity.json` is consumed directly by both test suites. Ten synthetic cases cover ordinary external buys, eight-decimal quantities, negative quantities, impossible and pre-1900 dates, unknown-basis fees, excess precision, intermediate aggregate limits, and shorthand decimals.

Aligned accidental differences: frontend dates now share the native 1900 lower bound; unknown-basis external buys require zero fees before quantities/lots change. Native rejection behavior is unchanged.

Retained input convenience: frontend parsing accepts `.5`; form construction emits canonical `0.5` for persistence, while native storage rejects the shorthand raw record. Deferred discrepancy: native checks aggregate position limits after each event, while frontend replay can accept a transient over-limit quantity reduced by a later event. Native remains the independent fail-closed boundary; changing limit enforcement stages belongs in focused accounting maintenance.

## Dependencies

Removed unused frontend/Rust store packages and the unused store capability; normal lockfile regeneration also pruned the orphan Rust tracing macro dependency. Kept the optional tray feature: this pass does not include installed runtime validation of tray removal.

GitHub alerts #2 and #4 remain open for development-only Vitest/mocker. The published fix is 4.1.11; the installed version is 3.2.7. This requires a major test-runner upgrade, so it is deferred to a separate dependency-maintenance change. No unrelated versions were upgraded.

## Deferred engineering work

- Historical synchronization cancellation/progress after aggregate timeout.
- Avoiding completed-history reconstruction on unrelated quote refreshes.
- Extracting refresh/history coordination from App after release.
- Aggregate validation-limit staging parity and a separate Vitest major upgrade.

## Verification

Verified results:

- Focused cleanup subset: **67 tests / 8 files passed**.
- Full frontend suite: **206 tests / 23 files passed**.
- Full native suite: **17 passed**, including one test looping over all ten shared parity cases; binary/doc-test targets also completed with no failures.
- Svelte checking: **0 errors, 0 warnings**.
- Frontend production and desktop-mode builds: passed.
- Windows Tauri release/NSIS build: passed for **0.1.5**.
- Public-data scan: passed across **101 tracked files**; staged diff reviewed, whitespace checks passed. New financial fixtures are synthetic.

The matching installer is staged separately from earlier candidates under `src-tauri/target/release-candidate/0.1.5/`, with `SHA256SUMS.txt`. No installer was run and no release was published.

Installed/high-DPI/ordinary-launch regression remains a tester gate. No real portfolio values or private profile files were used in this cleanup.
