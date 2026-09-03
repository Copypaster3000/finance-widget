# Finance Widget — Per-Trade Account Impact and History Boundary Spec

## Goal

Replace the user-facing Opening Position concept with ordinary Buy and Sell transactions whose Cash/Debt impact is selected independently for each transaction. Correct portfolio history so cached prices can never create chart values before the first ledger event.

## Transaction model

- Every Buy stores an `affectsCashDebt` boolean.
  - `true`: consume Cash first and create Debt for the remainder.
  - `false`: add quantity and cost basis without changing Cash or Debt.
- Every Sell stores an `affectsCashDebt` boolean.
  - `true`: pay Debt first and add remaining proceeds to Cash.
  - `false`: remove quantity and calculate FIFO realized gain without changing Cash or Debt.
- The choice is local to that transaction. Creating or editing one trade never changes another trade's setting.
- New Buy and Sell forms default the setting to enabled.
- Editing a trade restores its saved setting.
- Account activity contains funding/proceeds entries only when the transaction has account impact enabled.
- The existing ledger replay remains the single implementation used by previews, validation, current balances, and historical reconstruction.

## Opening Position removal and migration

- Remove Opening Position actions, forms, conversion controls, and labels from the UI.
- Bump the portfolio ledger schema to version 2.
- Migrate schema-1 Buy and Sell events with `affectsCashDebt: true` to preserve their existing accounting behavior.
- Migrate schema-1 Opening Position events into Buy events with `affectsCashDebt: false`.
- Preserve IDs, asset IDs, dates, sequences, quantities, creation/update timestamps, and known total cost basis.
- A known Opening Position cost basis becomes a zero-fee Buy with an effective unit price derived from quantity and total basis.
- A legacy unknown-basis Opening Position becomes an external Buy with unknown price and cost basis. It remains editable and does not affect Cash or Debt.
- Legacy manual holdings now migrate directly to external, unknown-basis Buy events.
- Persist the migrated schema after load so migration is one-time and deterministic.

## User experience

- Asset details expose only `+ BUY` and `+ SELL`.
- Buy form checkbox: `USE TRACKED CASH / DEBT`.
- Sell form checkbox: `APPLY PROCEEDS TO CASH / DEBT`.
- Supporting text explains the enabled and disabled behavior in plain language.
- The transaction preview must show zero Cash and Debt deltas when the setting is disabled.
- Unknown-basis migrated Buys display `UNKNOWN BASIS`; entering a price or total replaces the unknown basis normally.
- Delete confirmation and dependency-review behavior remain unchanged.

## Portfolio history boundary

- History start has a persisted `auto` or `manual` mode.
- In Auto mode, history begins on the earliest existing Buy date and moves whenever that Buy is edited or deleted.
- Editing the date manually switches the setting to Manual mode.
- In Manual mode, the chosen date is authoritative even when it precedes every Buy; the chart may show a zero or account-only value before holdings begin.
- Settings provide an explicit `AUTO / EARLIEST BUY` action to leave Manual mode.
- Do not emit chart points before the start selected by the active mode.
- A transaction date represents the selected local calendar day; holdings are effective for that day because transaction time is not collected.
- Raw hourly price cache may retain earlier prices for later edits. Cached prices never create portfolio points without an effective ledger state.
- On every successful ledger mutation, clear high-frequency recent portfolio samples and reconstruct completed history reactively from the updated ledger.
- Moving the earliest Buy later in Auto mode must remove all earlier chart points immediately and update available chart ranges.
- Moving a Buy never changes a manually pinned start date.

## Validation and compatibility

- Enabling or disabling account impact on an existing trade replays the complete ledger. If a later transaction becomes invalid, saving is rejected with the existing blocker navigation.
- A funded Buy still requires a known positive total amount.
- A new external Buy still requires a price or total; only migrated legacy events may retain unknown basis.
- Sell proceeds and fees remain required for realized-gain calculation regardless of account impact.
- No quantities or portfolio totals are sent to the quote provider.

## Acceptance tests

- Funded and external Buys produce identical holdings/cost basis but different Cash/Debt activity.
- Funded and external Sells produce identical quantity/FIFO gain changes but different Cash/Debt activity.
- Preview deltas match saved replay for both settings.
- Schema-1 Buy/Sell migration preserves funded behavior.
- Known and unknown schema-1 Opening Positions migrate to external Buys without balance changes.
- Editing a trade preserves its per-event selection.
- An external Buy moved from an earlier date to a later date produces no chart points before the later date in Auto mode.
- A manually selected date remains the chart boundary before any Buy.
- Existing malformed-data, FIFO, account, history, and storage tests continue to pass.
