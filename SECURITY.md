# Security Policy

## Supported version

Security fixes are applied to the latest published release and the `main` branch.

## Reporting a vulnerability

Please use a [private GitHub security advisory](https://github.com/Copypaster3000/finance-widget/security/advisories/new). Do not disclose a vulnerability, credential, local store, or real portfolio data in a public issue.

Include the affected version, reproduction steps using synthetic data, expected impact, and any suggested mitigation. Reports will be acknowledged as soon as practical for this hobby project.

## Data model

Finance Widget has no application server or telemetry service. Portfolio records are stored locally. Network requests contain symbols and requested time bounds, but not quantities, transactions, account balances, cost basis, or portfolio totals.
