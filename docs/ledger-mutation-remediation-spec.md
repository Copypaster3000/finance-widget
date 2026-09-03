# Ledger Mutation and Historical Conversion Remediation Spec

## Problem statement

Two confusing behaviors share one root cause: ledger mutations can be rejected by later dependent events, but the UI presents the replay error as a generic form error.

In the reproduced case, an earlier Buy created Margin Debt and a later Debt adjustment cleared it. Deleting the Buy or converting it to an Opening Position removes the original Debt creation, so replay correctly rejects the later negative adjustment. The mutation does not occur, but the UI makes it look as though deletion needs a Save or conversion succeeded and the graph applied it recently. The graph is actually showing the later Debt adjustment.

## Goals

- Make success, rejection, and dependency blockers unambiguous for Delete and Convert operations.
- Keep the current deterministic ledger validation; never allow a negative account balance or silently rewrite unrelated history.
- Let a user explicitly resolve a redundant Debt adjustment as part of converting a Buy to an Opening Position.
- Guarantee that a successful conversion preserves the source event ID, date, sequence, quantity, and cost basis, and recomputes portfolio history from that date.

## Mutation feedback contract

UI mutation callbacks return either success or a structured failure containing:

- a human-readable message;
- IDs of later events that blocked replay;
- no persisted changes on failure.

Validation issues tied to the proposed event itself are ordinary input errors. Issues tied to other events are dependency blockers.

## Delete behavior

- `DELETE TRANSACTION` opens an inline confirmation.
- The confirmation's `DELETE` button is the final action; Save is never involved.
- On success, close the confirmation and return to the position/account detail screen.
- On failure, keep the confirmation open and render `DELETE BLOCKED` inside it.
- List every blocking event with its date and readable type.
- Each blocker has a `REVIEW` action that opens the canonical source event.
- Do not surface deletion failures beside the Save button.

## Buy-to-Opening conversion behavior

- A normal conversion replaces the Buy in place and returns to the position screen on success.
- A rejected conversion displays `CONVERSION NOT APPLIED` adjacent to the conversion action.
- List and link all blocking events.
- If every blocker is a later negative `debt_adjustment`, offer an explicit second confirmation: `CONVERT + REMOVE REDUNDANT DEBT ADJUSTMENT(S)`.
- The combined operation is atomic. It replaces the Buy and removes only the displayed Debt adjustments, then replays the complete ledger. If replay fails, nothing is saved.
- Never automatically remove a payment, Cash event, trade, opening event, positive Debt adjustment, or an unlisted event.

## Historical correctness

- Conversion must use the original event `date`; `updatedAt` is audit metadata only.
- A successful mutation clears high-frequency derived portfolio samples and recalculates completed history from the ledger and historical price cache.
- The converted Opening Position is included in every complete historical valuation on and after its original local calendar date.
- The removed redundant adjustment must not create a later artificial step.
- If historical prices are unavailable, retain the existing partial-history warning; never move the effective transaction date forward.

## Acceptance criteria

- A blocked deletion identifies the later Debt adjustment in the confirmation and provides a working Review action.
- A successful deletion exits the editor without requiring Save.
- A blocked conversion cannot be mistaken for success.
- Explicit combined conversion removes only validated redundant Debt adjustments and persists atomically.
- The resulting graph reflects the Opening Position from its original date and contains no step on the removed adjustment date.
- Automated tests cover mutation dependency IDs, safe combined conversion, unsafe-removal rejection, modal behavior, source navigation, and dated historical replay.
