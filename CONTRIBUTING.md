# Contributing

Thanks for helping improve Finance Widget.

## Development

Use native Windows PowerShell and follow the build commands in the README. Before opening a pull request, run:

```powershell
npm run privacy:check
npm run check
npm test
npm run build
npm run tauri build
```

## Public-data rules

This is a public repository. Use fictional symbols, dates, quantities, prices, balances, and transaction histories in every test, example, issue, and screenshot.

Do not submit:

- Real portfolio records or application-data stores.
- Personal names, email addresses, account identifiers, or machine usernames.
- Absolute user paths, credentials, API keys, logs, or environment files.
- Screenshots that expose a real portfolio, notification, desktop, or account.

Use a GitHub no-reply address for commits if you do not want your email in Git history. Review the complete staged diff before pushing.

## Pull requests

- Keep calculation code deterministic and add focused tests for behavior changes.
- Preserve the terminal-instrumentation visual direction.
- Explain user-visible changes and any migration impact.
- Do not commit generated installers, build output, caches, or local configuration.
