# Finance Widget — Agent Guide

## Purpose and stack

This is a native Windows 11 desktop finance widget: Tauri 2 + Rust shell, Svelte 5 + TypeScript frontend, custom CSS, and no backend server or database.

## Visual constraints

- Preserve the Linux-rice / terminal-instrumentation direction; do not introduce generic SaaS or Fluent styling.
- The supplied Rainmeter screenshot is authoritative for two anchors only: flat translucent warm charcoal/olive panel material and muted amber/ochre accent.
- Default accent is `#D0A22C`; default panel is `rgba(53, 54, 46, 0.86)`.
- Never add backdrop blur, acrylic, glassmorphism, bright neon, thick progress bars, or broad glow.
- Allocation traces stay 2–3 px and animate subtly.

## Architecture

- `src/lib/types.ts` owns shared models.
- UI consumes normalized `Quote` objects only.
- Keep provider-specific payloads inside `src/lib/providers.ts` or future provider modules.
- Portfolio calculations in `src/lib/portfolio.ts` must remain pure and local.
- Persistence uses the Tauri app-data store with schema versioning; never write mutable configuration beside the executable.
- Rust/Tauri code in `src-tauri` owns native window and OS integration.
- `src/lib/ledger.ts` is the deterministic source of truth for positions, FIFO lots, Cash, Debt, and realized cost basis.
- Ledger money is persisted as decimal strings and replayed as integer cents; quantities use eight fixed decimal places and unit prices use six.
- Buys consume Cash before creating Debt. Sales and deposits pay Debt before creating Cash. Withdrawals consume Cash before increasing Debt.
- Legacy manual quantities migrate to unknown-basis `opening_position` events without changing Cash or Debt.
- Historical portfolio value replays every event through each date and values reconstructed quantities alongside Cash minus Debt.
- `src/lib/calendar.ts` owns local calendar boundaries; never derive user-facing dates by slicing UTC ISO timestamps.
- `src/lib/feed.ts` owns quote provenance, cached/live preference, and feed status terminology.
- Funding and proceeds previews must call the same ledger replay path used to validate saved events.

## Commands (native PowerShell, never WSL)

```powershell
npm install
npm run check
npm test
npm run build
npm run tauri dev
npm run tauri build
```

If Cargo is missing from the process path, prepend `C:\Users\<user>\.cargo\bin` for that shell.

## Market data and secrets

- Keep `PriceProvider` decoupled from Svelte components.
- Deduplicate symbols and retain old quotes on all failures.
- Never send quantities or totals to a quote provider.
- Never hard-code, log, or commit API keys. `.env*`, keys, user config, build output, and logs stay ignored.
- Mock prices must always display an explicit demo status.
- Treat live mode as sensible fallback polling unless `supportsStreaming()` is truly implemented and entitled.

## Windows concerns

- Preserve frameless, transparent production window behavior and interactive non-drag controls.
- `data-tauri-drag-region` belongs only on the header/identity drag surfaces.
- Window state is restored by `tauri-plugin-window-state`.
- Prefer stable normal/always-on-top modes over WorkerW or wallpaper-host shell hacks.
- Keep `windows_subsystem = "windows"` for release so no console opens.
- For local silent installs and updates, invoke the NSIS installer with `/S /NS` so it does not create a desktop shortcut; preserve the Start Menu entry.

## Quality and Git

- Run check, tests, frontend build, and a native build before stable commits.
- Add tests for malformed/missing/stale market data and every calculation change.
- Use milestone Conventional Commit messages; do not commit broken states or secrets.
- Primary branch is `main`; never force-push shared history.
- Corporate actions, dividends, options, shorts, interest accrual, imports, tax-lot selection, and contribution-adjusted returns remain out of scope.
