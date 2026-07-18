# Program 6B — Static Integration Audit and Compile-Safety Repair

Status: source-level integration audit complete; command-based compile verification not yet executed.

## Scope inspected

- Program 5 route registration and middleware ordering.
- Raw-stock company-context, sensitive-input, privileged-operation, and audit adapters.
- Stored-file and container-document protected-asset adapters.
- Program 5 regression harnesses affected by asynchronous audit persistence.
- Program 5 migration journal ordering from `0003` through `0006`.

## Defects found and repaired

1. **Mounted raw-stock validation could be bypassed**
   - The guard selected schemas with `req.path`.
   - Express may rewrite `req.path` to `/` inside mounted middleware.
   - The guard now derives a canonical path from `req.originalUrl`, strips query parameters and trailing slashes, and uses that same path in audit evidence.

2. **Stored-file audit action could be misclassified**
   - The adapter inferred preview versus download from `req.path`.
   - Mounted middleware can expose a rewritten path.
   - Audit classification now uses the explicit action passed when the middleware is registered.

3. **Container-document authorization preferred legacy company context**
   - The inherited adapter used `factoryCompanyId ?? currentCompanyId`.
   - It now uses `currentCompanyId` as authoritative and rejects mismatched legacy factory context.

4. **Raw-stock input regression harness was stale**
   - The middleware became asynchronous and audit-backed in Program 5H.
   - The test still invoked it synchronously without a session or database mock.
   - The harness now awaits the middleware, mocks audit persistence, supplies session metadata, and covers mounted-path rewriting.

## Evidence performed

- Repository source inspection through the GitHub connector.
- Targeted source edits committed to `agent/program-6-security-verification-rollout`.
- No TypeScript compiler, test runner, build, migration, runtime, deployment, or production command was executed in this phase.

## Remaining gate

Static source integration defects identified in this audit were repaired, but the compile gate remains unverified until Phase 6C executes the relevant command-based checks and records their output.
