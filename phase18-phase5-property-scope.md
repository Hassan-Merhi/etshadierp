# Phase 18 Wave 2 — Phase 5 Scope

Scope: property signatures and index signatures only.

Safety rules:
- start from current main
- require a green full TypeScript baseline
- accept only strict type-escape reductions
- roll back compiler-breaking files
- do not widen the type-escape ratchet
- do not perform union, cast, suppression, broad-unknown, or final residual transforms
- certify exhaustion with a final full TypeScript compiler gate
