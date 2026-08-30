# Maintenance bots

This repository includes preventive maintenance workflows in addition to the existing CI repair stack.

## Required configuration

### Production canary

Set the repository secret `PRODUCTION_HEALTH_URL` to a read-only production health endpoint that returns HTTP 2xx when the application is healthy. Until configured, the workflow stays inert and exits successfully.

### Backup restore verification

Set the repository secret `BACKUP_DATABASE_URL` to a read-only PostgreSQL connection string suitable for `pg_dump`. The workflow creates a logical backup and restores it only into the isolated PostgreSQL service running inside GitHub Actions. Until configured, the workflow stays inert and exits successfully.

## Safety behavior

- The repository janitor deletes only branches associated with already-merged pull requests.
- Unmerged stale branches are reported but never deleted automatically.
- The production canary performs only an HTTP GET-style health request.
- Backup verification never restores into production.
- Architecture drift checks are observational except when a high-severity production dependency audit or migration collision fails.
