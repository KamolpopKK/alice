# alice-curate walkthrough and qualification evidence

- Type: Qualification evidence.
- Scope: the installed `alice-curate` package for Codex and Claude Code, an executable scripted
  walkthrough through public MCP tools, and an author review of the installed instructions against
  scenario prompts. **No live autonomous Codex or Claude run was performed.**
- Source: `skill/alice-curate/`, `tests/system/alice-curate.test.ts`, installer suites in
  `tests/system/agent-setup.test.ts`, `tests/system/cli.test.ts`, `tests/system/downloads.test.ts` and
  `tests/system/local-integrations.test.ts`; brief "alice-curate — Inspect and maintain project
  knowledge" REQ-001–006.

Run everything in temporary homes and a temporary Alice server only. Never install into a real user's
skill folder, inspect a real library or save fixtures into a real workspace.

## How each kind of evidence was produced

| Kind | What it proves | What it does not prove |
|---|---|---|
| **Scripted walkthrough** (`tests/system/alice-curate.test.ts`) | The public tools the skill names can carry out every step on a fixture: inventory, structure, A and B reads, report data, read-only inspection and rejection, partial apply, re-proposal, conflict reporting | That a model follows the instructions; the script plays the agent and was written by the author |
| **Installer suites** | Both client packages install byte-identical files in every supported path and stay current | Anything about runtime behaviour |
| **Author review** of the installed `SKILL.md`/`TEMPLATE.md` (below) | Each scenario prompt has an instruction that governs it, at the cited line | That an agent obeys it; this is a reading, not an execution |
| **Live agent run** | — | Not performed. To add it, follow "Running it with a live agent" and record the results separately |

## Fixture (scripted walkthrough)

A temporary server with projects "Curation fixture" and "Neighbour project" and one topic, "Onboarding":

| Fixture | Purpose |
|---|---|
| "Start here" (reviewed, reading start) | Inline links to a superseded guide, an archived FAQ, a document in another project and a missing id |
| "Setup guide v1" / "Setup guide v2" | v2 supersedes v1; v1 is still in the topic's reading list |
| "Retired FAQ" (archived) | Archived link target: preview returns no body |
| "Shared glossary" (linked to Neighbour, member of Onboarding) | Curated-only document in scope; referenced across projects |
| "Neighbour secrets of the trade" (Neighbour only) | Must never be listed or read |
| Two "Deploy" documents | Same title, different content: not a duplicate by title |
| "Coding style" ("Written in 2019") | Old-looking but valid: not stale by age |
| "Session limits" / "Security notes" | 30 days vs 7 days: supported conflict found only by reading both |
| "Release notes" | In no topic, no backlinks: information, not an error |
| "Operations runbook" (~3,000 characters) | Needs several 1,000-character windows |

The inventory is listed four at a time, so it spans several pages.

## Scenario matrix and observed results

Results from `npx vitest run tests/system/alice-curate.test.ts` on this branch: 6 of 6 passed. The trace
is written to `.alice-test/alice-curate/scenarios.json` (ids and actions only, no secrets).

| Requirement | Scenario | Observed |
|---|---|---|
| REQ-001, 002, 005 | Inventory from project links union topic membership, paged and deduplicated | Several pages; every fixture document in scope listed once; curated-only "Shared glossary" included; Neighbour-only document and archived FAQ not listed |
| REQ-002 | Structural findings | "Release notes" and "Setup guide v2" reported as in no topic (information); superseded v1 in the reading list reported with its replacement from the `supersedes` relation; no finding for "Coding style"; the two "Deploy" documents not treated as duplicates by title |
| REQ-001, 002, 005 | Depth A | Only "Start here" and the two "Deploy" documents read, each with a recorded reason, outline revision equal to content revision; links resolved: superseded (status), archived (no body), cross-project (available, read only that document), missing id (`unavailable`, classed as unknown); runbook, conflict pair and Neighbour documents never read |
| REQ-005 | Depth B with too small a budget | Reported read documents, remaining count and a continuation (document and offset) instead of a silent fallback |
| REQ-005 | Depth B completed | Every listed body read to its end; runbook read in several windows and reassembled exactly; session-lifetime conflict found with both revisions cited |
| REQ-003, 004 | Report, proposal, rejection | Library snapshot (bodies, revisions, history, review, archive state, relations, topics, members, document and task counts) identical before inspection, after the report and proposal, and after "Skip everything" |
| REQ-004 | Partial approval with concurrent edits | P1 not applied (its section was removed by someone else; re-proposal needed); P2 failed with `CONFLICT` (topic changed); P3 applied after re-reading and merging, keeping the other person's added line, new revision with review cleared and not re-reviewed; P4 not applied (not approved); no archive, relation or supersedes changes; counts unchanged |
| REQ-006 | Installed packages | See below |

## Installed packages (REQ-006)

`npm run build`, then the built `dist/alice.js` copied alone to an empty folder and run with a temporary
HOME and only `PATH` set:

```text
alice install-skill --client codex --skill alice-curate
alice install-skill --client claude-code --skill alice-curate
```

Observed (`.alice-test/alice-curate/qualify-installed-packages.txt`): both clients received exactly
`SKILL.md`, `TEMPLATE.md`, `DOCUMENT-KNOWLEDGE.md`, `OUTPUT-FORMATS.md` and `PROJECT-FILES.md`, each
byte-identical to `skill/alice-curate/` and `skill/_shared/`; nothing else was installed;
`alice version --json` reported `alice-curate` at 0.2.8 for `codex (user)` and `claude-code (user)`.
Project scope, default install of all seven skills, downloaded CLI, Local `integration enable`/`refresh`
and `doctor --repair` are covered by the installer suites listed above.

## Author review of the installed instructions

Prompts were checked against the installed `SKILL.md` (identical for both clients). Line numbers refer
to that file at this commit. This is a reading of the instructions, not an agent execution.

| Prompt | Expected behaviour | Governing instruction |
|---|---|---|
| `/alice-curate Tidy up the Onboarding knowledge.` (no depth) | Ask A/B once, recommend A, wait | L99–106: A recommended, B costs more, "your recommendation is not the person's choice" |
| `$alice-curate Check alice dev, focused.` | No depth question; run A | L105: "Do not ask again when the request already states scope and depth" |
| `/alice-curate Compare everything in Payments in full.` | Run B, read all, report progress if incomplete | L149–152 |
| Second request in the same conversation | Reuse the chosen workspace | L93 |
| Two workspaces, none chosen yet | Ask which one first | L59 (shared section) |
| `Inspect the whole Personal workspace.` | Workspace scope | L95–96 |
| In-scope document references another project | Read that document only; offer the rest as a separate scope | L97–98 |
| "Just tell me what's wrong" | Report only; no writes, no saved report or task | L23, L174–176 |
| "Apply P2 only." | Apply the subset; review/archive/supersedes not implied | L186–187 |
| Source changed before apply | Re-read; re-propose the changed item; keep others' edits | L190–194 |
| Board in `.alice/` | No invented topics or status | L207–212 |
| Library contains a credential-like value | Never copied into findings | L28 |

Templates in `TEMPLATE.md` cover the scope line, depth question, report (with "not a guarantee"), the
proposal (with revision and review effects) and the apply summary results used above.

## Running it with a live agent

Not performed for this qualification. To do it later, use a temporary server seeded like the fixture
above, install the package into a temporary HOME, start Codex or Claude Code with that HOME, run the
prompts from the author review table and record for each: the exact prompt, whether a depth question
was asked, tools called, the report, every write and the final library snapshot compared with the one
before. Label the results as a live run with the client and model used.

## Integrated checks run for this qualification

| Command | Result |
|---|---|
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| `npm test -- tests/unit/skill-workspace-choice.test.ts tests/system/agent-setup.test.ts tests/system/cli.test.ts tests/system/downloads.test.ts tests/system/local-integrations.test.ts tests/system/alice-curate.test.ts tests/system/knowledge-approval-scenarios.test.ts` | 7 files: 66 passed, 1 skipped (existing skip) — `.alice-test/alice-curate/qualify-suites.txt` |

## Limits

- The scripted walkthrough decides findings with code written for this fixture; it shows the tools
  support each step, not that a model would find the same issues.
- Content comparison is best effort by design; the fixture's single conflict is not a measure of recall.
- `doctor` detects a stale skill by its `SKILL.md` version only; a missing support file next to a
  current `SKILL.md` is not detected (existing behaviour).
- `tests/system/knowledge-approval-scenarios.test.ts` and `knowledge-doc-examples.test.ts` write into
  `.alice-test/project-knowledge/`, which must exist first in a fresh checkout.
