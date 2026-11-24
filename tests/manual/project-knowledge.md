# Project Knowledge qualification

This procedure qualifies the approved **Project Knowledge — Find and reuse context** brief and
**Project Knowledge — Technical design**, including REQ-001 through REQ-011. Use disposable data;
never migrate, curate, review or restore the operator's real library as a test. Passing these checks
is not permission to merge, release or migrate production.

## Reproduce

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run storybook:build
npm run test:ui
npm run test:desktop
npm run test:scale
```

The demo tests need their documented media tools. This qualification used the already prepared
`/private/tmp/alice-demo-tools/bin` on PATH. E2E includes the real Rust Desktop probe when the Rust
toolchain is available; do not disable it for Knowledge qualification. UI can run with fewer workers
without dropping stories/checks. Concurrent Playwright runners must use separate `--output` directories
(e.g. `.alice-test/project-knowledge/e2e-results` and `ui-results`); distinct JSON filenames alone do
not isolate their temporary traces. Existing opt-in tests are reported separately, never counted as
executed passes. Chromium/Pixel and native-bridge/native-core evidence do not certify Safari,
Firefox or physical iOS devices.

## Requirements and concrete evidence

| Requirement | Implemented behavior | Executable evidence |
|---|---|---|
| REQ-001 | Topics, explicit curation, ordinary Documents remain accessible | `knowledge-topics`, `knowledge-members`, `knowledge-search` system/E2E tests |
| REQ-002 | Introductions and deterministic ordered starting references; no mandatory copied overview | membership/context ordered-dedup and reading-list UI cases |
| REQ-003 | Shared original Documents across topics/projects with actual provenance and workspace isolation | membership/search/backlink/window/recovery cases |
| REQ-004 | Canonical Markdown, derived edges, backlinks with inline/manual provenance, safe links/preview | unit document-links/Markdown, system link-index/backlinks/windows, browser document-links/preview |
| REQ-005 | Scoped lexical discovery with bounded metadata and truthful empty/fallback states | knowledge-search/context/CLI and browser search cases |
| REQ-006 | Outline/window continuations and actual revision/review evidence | document-windows/context, CLI and real cross-client Knowledge case |
| REQ-007 | Stale continuation conflicts, explicit uncertainty and source/code/inference distinction | window/context conflicts; shared guidance and reviewed scenario transcript |
| REQ-008 | Scoped proposal/partial application, no curation-as-review or unrelated archive/supersedes | `knowledge-approval-scenarios.test.ts`, installer/shared-guidance regressions |
| REQ-009 | Exact extended/warm/mixed workloads and unchanged baseline budgets | `tests/scale/knowledge.test.ts`, original scale/client-load suites |
| REQ-010 | Auth/workspace guards, safe Markdown, atomic activity/replay/CAS, old-client fallback | complete system/security/conformance and focused UI cases |
| REQ-011 | Append-only upgrade, readiness-before-work, resumable projection, verified backup/export v3 | upgrade/knowledge-upgrade/recovery/operations/Local backup suites |

## Seven DoD areas

- **Test levels:** full unit/system, E2E and Knowledge-specific Web/CLI/real Rust Desktop/MCP parity.
- **Security:** foreign IDs/workspaces, auth, malformed links/URLs/query data, XSS and actor-scoped replay.
- **Deployment/operation:** prior-schema upgrades, interrupted/failing preparation, restart and readiness.
- **Performance:** original budgets unchanged; 10,000 Documents/100,000 pairs/1,000 topics/20,000 members,
  5% 50,000-character bodies, >=50 warm samples per read, 10 reader/5 writer workers x100 measured
  operations after warm-up, distinct writer targets and separate deliberate conflicts.
- **Accessibility/compatibility:** keyboard, actual mobile touch, Escape/focus return, both-theme axe,
  existing clients/capability fallback and append-only MCP tool ordering.
- **Integrity/recovery:** failure injection, no half-writes, revision conflicts, replay mismatch, source/
  history/review/order equality after backup/restore and source-safe derived rebuild. Export v3 excludes
  secrets and does not treat derived projections as portable authority; downgrade restores older data.
- **Documentation:** executed commands extracted from the actual guide, API examples, repository links,
  six-skill shared installer parity and reviewable maintenance instructions.

## Evidence capture

Reports live under ignored `.alice-test/project-knowledge/`:

- `final-typecheck.log`, `final-vitest.json`/`.log`, `final-build.log`.
- `final-e2e.json`/`.log`, `final-storybook-build.log`, `final-ui.json`/`.log`, `final-desktop.log`.
- `capacity-report.json`, `capacity-scale.log`, `capacity-search-regression.json`; unchanged baseline
  `.alice-test/scale-report.json`. The capacity report contains reference hardware, SQLite/runtime,
  live/checkpointed DB/WAL sizes, counts, timings, errors/conflicts, test-only limiter and measured-source
  hashes. Verify these hashes when later changes reuse that report; rerun if measured paths changed.
- `recovery-vitest.json`, `approval-scenarios.json`, `guidance-vitest.json`, `skill-validation.txt`,
  `docs-examples.json`, `docs-vitest.json`, and focused leaf browser reports.
- `qualification.json` records the observed integrated results and limitations, not proposed checks.

The approval transcript is a scripted public-contract walkthrough reviewed against the guidance,
not a statistical/autonomous model evaluation. The generic skill validator does not understand
Alice's pre-existing `version` frontmatter; temporary compatibility copies omit only that field,
while actual installer/YAML/version tests validate the unchanged real package for both clients.

## Observed integrated result

Qualification passed: typecheck and production/Storybook builds; 549 unit/system tests,
203 E2E cases (zero flaky), 151 Storybook/UI cases and 27 native Rust tests. Existing nonfocused
opt-in cases skipped: 1 unit, 2 E2E and 12 UI snapshots. No focused Knowledge case was skipped.
The passed 11-test scale report is reused after verifying all six measured source hashes.
The real Web/CLI/Rust Desktop/MCP Knowledge case checks shared context, events and stale revision
rejection. An earlier full E2E attempt had two trace-directory collisions while UI ran concurrently;
the complete isolated-output rerun passed. Exact reports and limitations are in `qualification.json`.
