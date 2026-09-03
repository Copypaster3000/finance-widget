# Finance Widget

A native Windows 11 finance widget built with Tauri 2, Svelte 5, TypeScript, and Rust. It keeps the original translucent olive-charcoal Linux-rice design while adding a local dated transaction ledger for accurate positions, Cash, Debt, cost basis, and portfolio history.

## Features

- Stocks and crypto derive their current quantities from dated BUY and SELL events.
- BUY accepts Price / Unit plus fees or an all-in Total Paid. Total Paid always includes fees and becomes the lot's cost basis.
- SELL accepts Price / Unit plus fees or net Total Proceeds and consumes acquisition lots FIFO.
- Every BUY and SELL independently chooses whether it affects tracked Cash and Debt. External holdings and proceeds can therefore be recorded without fabricating account movements.
- Missing transaction prices can use historical closes; stock weekends and holidays require confirmation before using the previous trading close. User-entered dates and chart labels follow the computer's local calendar.
- Cash and Margin Debt are first-class portfolio rows. The headline is net value: market assets + Cash − Debt.
- Buys spend Cash first and finance any shortfall as Debt. Sales and deposits pay Debt first. Withdrawals use Cash first and increase Debt for any shortfall.
- Transaction forms preview those Cash and Debt consequences before anything is saved.
- Position detail panels show transaction history, remaining/average cost basis, realized gain, and unrealized gain without leaving the widget.
- The existing area chart reconstructs dated quantities, Cash, and Debt instead of projecting today's holdings backward.
- Privacy mode masks prices, gains, and quantities.
- Manual, hourly, 15-minute, and 15-second refresh modes retain the previous one-hour high-resolution chart behavior.
- A new profile starts empty with explicit actions to add an asset, opening Cash, or opening Debt; sample values are never mistaken for a real portfolio.

## Ledger and precision

The persisted ledger contains normalized assets and discriminated event records. Derived quantities, Cash, Debt, FIFO lots, and gains are reconstructed by deterministic replay in `src/lib/ledger.ts`.

- Money and cost basis are calculated as integer cents.
- Quantities support eight fixed decimal places.
- Unit prices support six fixed decimal places.
- Same-day records use an explicit sequence for stable ordering.
- BUY cost basis includes fees; SELL proceeds are net of fees.
- Debt is a non-negative liability and never doubles as negative Cash.

Legacy holdings and Opening Position records migrate to BUY events with Cash/Debt impact disabled. These records preserve current quantities and known basis without fabricating account activity. Older normal BUY and SELL records retain their funded behavior.

## Historical reconstruction

All events before and during the configured history window are replayed before each valuation point. Auto history begins at the earliest existing BUY and follows it when that transaction changes; a manually selected start remains pinned even before any BUY. Stocks carry their latest available trading price across closures. Provider timestamps remain actual instants, while user-entered event dates and chart day boundaries use the local calendar. Transactions dated on a day are included in that day's reconstructed state. The current chart endpoint uses the same quotes as the headline.

The chart is actual net account value, not contribution-adjusted investment performance. Deposits and withdrawals can therefore create legitimate jumps.

## Develop and build

Requirements: Windows 11 x86-64, Node.js 20+, Rust stable with MSVC, Visual Studio C++ Build Tools, and WebView2.

```powershell
npm install
npm run check
npm test
npm run build
npm run tauri dev
npm run tauri build
```

If Cargo is not on the current PowerShell path:

```powershell
$env:Path = "C:\Users\$env:USERNAME\.cargo\bin;$env:Path"
```

The NSIS installer is created under `src-tauri/target/release/bundle/nsis`. Local silent updates use `/S /NS`, preserving the Start Menu entry without creating a desktop shortcut.

## Storage and privacy

Configuration, the ledger, quote caches, historical prices, and window state are stored in Tauri's application-data location under the `com.copypaster3000.finance-widget` identifier.

Only requested symbols and historical time bounds are sent to the market-data provider. Quantities, transactions, Cash, Debt, totals, and gains remain local. No API credentials are collected.

Yahoo Finance currently supplies normalized stock, OTC, crypto, regular, extended, and available overnight data. It is an unofficial best-effort adapter with no stability guarantee. Its terms restrict automated collection and redistribution, so replace it with a licensed provider before distributing a public build.

The widget distinguishes a completed check from a newly received quote. Cached real quotes remain visible through partial outages and are labeled accordingly; production mode never silently promotes mock data to a real valuation. Closed stock sessions are reported as market state, not as an error, and the footer identifies Yahoo data as delayed/best effort.

## Architecture

- `src/lib/ledger.ts` — fixed-precision chronological replay, FIFO, Cash, Debt, and validation
- `src/lib/transactions.ts` — BUY/SELL input normalization and Total Paid/Proceeds semantics
- `src/lib/ledgerHistory.ts` — raw price caching and ledger-aware historical valuation
- `src/lib/portfolio.ts` — current net valuation and gross-asset allocations
- `src/lib/providers.ts` — provider boundary and Yahoo normalization
- `src/lib/feed.ts` — quote provenance, cache preference, feed state, and source-transition explanations
- `src/lib/calendar.ts` — local calendar boundaries and explicit provider-timezone conversion
- `src/lib/storage.ts` — schema migration and app-data persistence
- `src/components` — compact portfolio, detail, transaction, Cash, Debt, and settings views
- `src-tauri` — frameless Windows shell, autostart, app state, and installer

The frameless widget keeps native window-state persistence and adds a visible bottom-right resize grip. Double-clicking the grip restores the default size.

## License

Finance Widget is available under the [MIT License](LICENSE).

## Deliberately out of scope

Stock splits and other corporate actions, dividends, options, short positions, interest accrual, brokerage imports, tax reporting, manual tax-lot selection, wash sales, multi-currency accounting, and contribution-adjusted returns are not implemented in this milestone.
