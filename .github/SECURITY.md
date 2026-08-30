# Security Policy

## Supported version

Security fixes are maintained on the current `main` branch. Older branches and historical snapshots are not supported security release lines.

## Reporting a vulnerability

Do **not** publish credentials, customer data, exploit details, or other sensitive evidence in a public issue or pull request.

For a suspected vulnerability:

1. Use GitHub's private vulnerability reporting for this repository when that option is available.
2. If private vulnerability reporting is unavailable, email the repository maintainer at `hassmerhi.etshadi@gmail.com` with the subject `ETS HADI ERP security report`.
3. Include the affected area, reproduction steps, expected impact, and the minimum evidence needed to validate the report. Redact secrets and personal/customer data.

Please allow the maintainer to validate and remediate the issue before public disclosure.

## Security expectations for changes

Changes should preserve the repository's existing security gates and must not bypass or weaken required checks. In particular:

- never commit production secrets, private keys, tokens, database credentials, or customer data;
- keep environment-specific secrets outside the repository and provide placeholders only in example files;
- use least-privilege GitHub Actions permissions;
- pin third-party GitHub Actions to immutable commit SHAs;
- keep dependency, secret-scanning, static-analysis, and workflow-security checks enabled;
- add or update focused tests when a security boundary or authorization path changes.

## Incident handling

If a secret is accidentally committed, removing the file is not sufficient. Revoke or rotate the exposed credential first, then remove it from the repository and investigate any possible use of the credential.
