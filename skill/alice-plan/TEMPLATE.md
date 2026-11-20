# alice-plan templates

Copy these exactly. Every heading is required. Replace every `<…>`; a section with nothing to say states
why in one line (for example "External: none — all material is in the repository").

Follow [OUTPUT-FORMATS.md](OUTPUT-FORMATS.md) for source requirement references. Cite existing ids as
`<source brief id or path> / REQ-001`; do not assign ids to someone else's brief or renumber them.
Include the requirement references below when the source has them. For older documents cite the source
section; for supporting work cite the design decision or spike question instead of inventing an id.

## Leaf task description

```markdown
## Outcome
<One sentence: what is true when this task is done.>

## Context
<Why this task exists, in 2–4 sentences.> Reference: <reference document title> (<doc id>) § <section>.
Plan: plan:<slug> · Parent: <parent title>.

## Scope
- In: <what this task changes>
- Out: <what it deliberately does not change, and which task does>

## References
- Repository: <remote> · base <branch> · planned at <commit>
- Files:
  - `<path>` → `<symbol>` — <what to change there> <(permalink)>
- Prior art: `<path>` → `<symbol>` — <the pattern to follow>
- Tests: `<path>` — <the cases to add or extend>
- Docs: <Alice document title> (<doc id>) § <section>
- Requirements: <source brief id/path / REQ-001, …; include when the source has ids>
- External: <url> — <why it matters>
- Excerpt (only if critical, ≤ 20 lines):
  ```<language>
  <the interface, schema or config to match>
  ```

## Steps
1. <An approach, in order. Decisions are already made; do not leave choices open.>

## Acceptance criteria
1. <Observable, independently checkable outcome; cite the source requirement when applicable.>
2. <…at most 7; split the task if there are more.>

## Verification
- `<exact command>` — <what it proves>
- <manual check, if any, with where and how>

## Done when
The `complete_task` summary states: <the commit or pull request, the files changed, the verification run,
and any follow-up task ids>.
```

## Parent task description

```markdown
## Outcome
<One sentence: what this group of tasks delivers.>

## Context
Reference: <reference document title> (<doc id>). Plan: plan:<slug>.
Repository: <remote> · base <branch> · planned at <commit>
Requirements: <source brief id/path / REQ-001, …; include when the source has ids>

## Tasks
1. <leaf title> — <one line>
2. <…in recommended order; note which can run in parallel>

## Done when
<Group-level criteria: every leaf done, plus any end-to-end check that spans the leaves.>
```

## Reference document (new planning reference)

Summarize the agreed input and established technical approach. Do not author a new technical design
in this template. If main design decisions are missing, follow the readiness rule in SKILL.md and
recommend `alice-spec` before producing the plan.

```markdown
# <Title>

## Problem
<What is wrong or missing today, and for whom.>

## Solution
<What will exist when the plan is done, using the agreed design or established project patterns.>
Source requirements/design: <document ids/paths, or the agreement in chat and relevant code patterns>.

## Decisions
- <Planning decisions within the agreed design: task boundaries, sequencing, dependencies and verification, with reasons. Reference existing design decisions without rewriting them.>

## Conventions
- <Project rules every task must follow (from README, CLAUDE.md, AGENTS.md), e.g. test seam, style, migrations.>

## Repository
<remote> · base <branch> · planned at <commit>

## Out of scope
- <What this plan deliberately does not do.>

## Plan
plan:<slug> — parent tasks: <titles; ids are added after creation>
```

For an existing reference document, append instead:

```markdown
## Planning notes (plan:<slug>)
- Repository: <remote> · base <branch> · planned at <commit>
- Decisions added during planning: <implementation planning choices within the agreed design>
- Requirements covered: <source brief id/path / REQ-001, …; include when the source has ids>
- Parent tasks: <titles / ids>
```

## Pre-creation checklist

Run this on the draft and report the result before asking for approval:

- [ ] Every leaf has all eight sections with no placeholders, "TBD" or open choices.
- [ ] Main technical design decisions are settled by source designs or established patterns; no task delegates missing architecture, contracts, data modeling or migration design to implementation.
- [ ] Every leaf cites at least one concrete file and symbol, or states why none applies (for example a docs-only task).
- [ ] Every leaf has 1–7 acceptance criteria and at least one exact verification command or check.
- [ ] Every leaf is one reviewable change; none needs "and" to join separable work.
- [ ] Spikes are labelled `spike` and state their question and output.
- [ ] Blocker edges exist only for real ordering needs, and the graph has no cycles.
- [ ] No task duplicates existing Alice work found during discovery; related work is linked.
- [ ] The repository remote, base branch and commit appear in the reference document and every parent.
- [ ] Each leaf description is under ~8,000 characters; the reference document is under ~20,000.
- [ ] Every task carries `plan:<slug>`; statuses are `backlog`; no assignees.
- [ ] Source requirement ids, when present, are preserved and cited by relevant tasks and acceptance criteria; supporting work cites its design decision or spike question.
