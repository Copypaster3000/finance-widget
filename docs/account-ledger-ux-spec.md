# Account Ledger UX and Visibility Spec

## Goal

Make Cash and Margin Debt understandable, optional in the compact portfolio view, and fully auditable without changing the ledger's existing accounting rules or duplicating transactions.

## Portfolio visibility

- Cash and Margin Debt each have an independent `SHOW ... ROW` setting.
- New installations default both account rows to hidden.
- Existing installations migrating from schema 8 or earlier keep both rows visible so an update does not unexpectedly change the layout.
- Visibility affects presentation only. Hidden balances remain part of net portfolio value, history, previews, and validation.
- When a hidden account has a non-zero balance, the portfolio headline shows one compact, clickable `NET ADJUSTMENTS` disclosure with the hidden Cash and/or Debt amount.
- Empty-state account actions only appear when their corresponding row is enabled.

## Account overview actions

### Cash

- `ADD FUNDS`: records a positive deposit. Existing Debt is paid before any remainder becomes Cash.
- `REMOVE FUNDS`: records a positive withdrawal. Cash is consumed before any shortfall creates Debt.
- `SET BALANCE`: records a balancing adjustment to a positive target balance without silently deleting history.
- `CLEAR CASH`: records a balancing adjustment to zero.
- `OPENING`: remains available when the account has no direct opening event, for establishing a starting balance.

### Margin Debt

- `PAY DOWN`: accepts a positive amount and requires an explicit source:
  - `EXTERNAL`: reduces Debt without changing Cash.
  - `FROM CASH`: reduces Cash and Debt by the same amount and is allowed only when Cash is sufficient.
- `SET BALANCE`: records a balancing adjustment to a positive target without changing Cash.
- `CLEAR DEBT`: records a balancing adjustment to zero.
- `OPENING`: remains available when the account has no direct opening event, for establishing a starting balance.

Every action previews Current, New, and Delta values before saving. User-entered action amounts are positive; signed ledger adjustments are calculated internally.

## Activity journal

The stored event ledger remains the only source of truth. Cash and Debt activity rows are derived deterministically while replaying it.

For each accepted event, emit account effects with:

- source event ID and type;
- affected account;
- signed balance delta;
- balance before and after;
- date and sequence;
- source account or asset when applicable;
- effect reason such as buy funding, sale proceeds, deposit allocation, withdrawal funding, payment, opening, or manual adjustment.

Derived examples include:

- Cash used and Debt created by a Buy;
- Debt paid and Cash received by a Sell;
- Debt paid and Cash received by Add Funds;
- Cash used and Debt created by Remove Funds;
- Cash used and Debt reduced by a payment from Cash.

Zero-value effects are omitted.

## Editing and provenance

- Activity rows are not editable copies.
- Clicking a Buy or Sell effect opens that source transaction in the asset ledger.
- Clicking an Add Funds or Remove Funds effect opens that source entry in the Cash ledger, even when viewed from Debt.
- Clicking a direct Cash or Debt event opens its account editor.
- Editing or deleting a source event replays the ledger and regenerates all affected activity.
- Clearing an account creates a balancing event; it never erases prior activity.

## Validation and compatibility

- Preserve the current FIFO lot accounting and Cash/Debt funding order.
- Persist money as decimal strings, quantities at eight places, and unit prices at six places.
- Reject payments beyond current Debt and `FROM CASH` payments beyond available Cash.
- Historical portfolio values continue to replay all events and value assets plus Cash minus Debt.
- Existing debt adjustments remain readable and editable after migration.

## Acceptance criteria

- Toggling either account row never changes the calculated net value.
- A hidden non-zero account is disclosed near the headline and remains reachable.
- Every non-zero account effect from a saved ledger event appears exactly once in that account's activity list.
- Every activity row opens the canonical source event.
- Setting or clearing a balance preserves earlier events and produces the requested resulting balance.
- External and Cash-funded debt payments produce distinct, correct Cash/Debt effects.
- Configuration migration, ledger replay, previews, history, component behavior, and production builds pass automated checks.
