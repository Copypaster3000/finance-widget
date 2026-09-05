# Security Policy

## Supported version

Security fixes are applied to the latest published release and the `main` branch.

The supported desktop release target is Windows x64 (`x86_64-pc-windows-msvc`). Linux and macOS desktop builds are not currently distributed or supported.

## Target-specific dependency assessment

### GHSA-wrw7-89jp-8q8g / RUSTSEC-2024-0429

Assessed against version 0.1.2: `glib 0.18.5` is present in `src-tauri/Cargo.lock` through Tauri's Linux GTK/WebKit dependencies. The affected package is absent from the supported Windows dependency graph, so this advisory does not affect the Windows build. The upstream defect remains real; this is a platform-scoped assessment, not a claim that the dependency was patched.

Reproduce the comparison from the repository root:

```powershell
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --invert glib
cargo tree --manifest-path src-tauri/Cargo.toml --locked --target x86_64-unknown-linux-gnu --invert glib
```

The Windows command reports nothing to print; the Linux command shows the GTK/WebKit dependency chain. Cargo resolves platform-specific dependencies for all platforms when maintaining its lockfile, so removing these lockfile entries is not a durable fix.

Disposition: dismiss this specific Dependabot alert as "Vulnerable code not used" (API reason `not_used`) for the Windows-only release. Keep dependency monitoring enabled without a blanket package ignore. Reassess this decision before adding another release target or if a dependency/feature change includes `glib` in the Windows build.

References: [RustSec advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), [Cargo platform-specific dependency resolution](https://doc.rust-lang.org/cargo/reference/resolver.html#dependency-kinds).

## Reporting a vulnerability

Please use a [private GitHub security advisory](https://github.com/Copypaster3000/finance-widget/security/advisories/new). Do not disclose a vulnerability, credential, local store, or real portfolio data in a public issue.

Include the affected version, reproduction steps using synthetic data, expected impact, and any suggested mitigation. Reports will be acknowledged as soon as practical for this hobby project.

## Data model

Finance Widget has no application server or telemetry service. Portfolio records are stored locally. Network requests contain symbols and requested time bounds, but not quantities, transactions, account balances, cost basis, or portfolio totals.
