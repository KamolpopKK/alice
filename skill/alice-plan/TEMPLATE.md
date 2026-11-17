# alice-plan templates

Copy these exactly. Every heading is required. Replace every `<…>`; a section with nothing to say states
why in one line (for example "External: none — all material is in the repository").

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
- External: <url> — <why it matters>
- Excerpt (only if critical, ≤ 20 lines):
  ```<language>
  <the interface, schema or config to match>
  ```

## Steps
1. <An approach, in order. Decisions are already made; do not leave choices open.>

## Acceptance criteria
1. <Observable, independently checkable outcome.>
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

## Tasks
1. <leaf title> — <one line>
2. <…in recommended order; note which can run in parallel>

## Done when
<Group-level criteria: every leaf done, plus any end-to-end check that spans the leaves.>
```

## Reference document (new spec)

```markdown
# <Title>

## Problem
<What is wrong or missing today, and for whom.>

## Solution
<What will exist when the plan is done.>

## Decisions
- <Each decision made during discovery, with the reason. Include rejected alternatives when useful.>

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
- Decisions added during planning: <…>
- Parent tasks: <titles / ids>
```

## Pre-creation checklist

Run this on the draft and report the result before asking for approval:

- [ ] Every leaf has all eight sections with no placeholders, "TBD" or open choices.
- [ ] Every leaf cites at least one concrete file and symbol, or states why none applies (for example a docs-only task).
- [ ] Every leaf has 1–7 acceptance criteria and at least one exact verification command or check.
- [ ] Every leaf is one reviewable change; none needs "and" to join separable work.
- [ ] Spikes are labelled `spike` and state their question and output.
- [ ] Blocker edges exist only for real ordering needs, and the graph has no cycles.
- [ ] No task duplicates existing Alice work found during discovery; related work is linked.
- [ ] The repository remote, base branch and commit appear in the reference document and every parent.
- [ ] Each leaf description is under ~8,000 characters; the reference document is under ~20,000.
- [ ] Every task carries `plan:<slug>`; statuses are `backlog`; no assignees.
