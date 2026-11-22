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
- Tests: `<path>` — <the scenarios/cases and existing suite to add or extend; cite Testing design when present>
- Docs: <title> (<id/path>) § <section> — <why this task needs it; repeat for relevant extracted documents>
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
<Include applicable DoD criteria from the approved technical design when one exists.>

## Verification
- `<exact command>` — <what it proves>
- <manual check, if any, with where and how>
<For applicable DoD criteria, specify pass criteria and the evidence to retain.>

## Done when
The `complete_task` summary states: <the commit or pull request, the files changed, the verification run,
the results/evidence for applicable DoD criteria, and any follow-up task ids>.
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
<Group-level criteria: every leaf done, plus applicable DoD checks that span leaves, their pass criteria,
required evidence and the leaf responsible for running them.>
```

## Reference document (new planning reference)

Summarize the agreed input and established technical approach. Do not author a new technical design
in this template. If main design decisions are missing, follow the readiness rule in SKILL.md and
recommend `alice-spec` before producing the plan.

```markdown
# <Title>

- Type: Planning reference.
- Scope: <the agreed work covered by this plan>.
- Source: <requirements/design title + id/path + section, or the agreement in chat>.
- Related documents: <title + id/path + section — why it is needed; include relevant extracted topics>.

## Problem
<What is wrong or missing today, and for whom.>

## Solution
<What will exist when the plan is done, using the agreed design or established project patterns.>

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

Run this on the draft before writing anything, and fix every failure yourself. Do not show it in chat;
mention an item only when it cannot be satisfied without the person's decision.

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
- [ ] Every task carries `plan:<slug>`; tasks are created `backlog` with no assignees (eligible leaves become `ready` right after creation).
- [ ] Source requirement ids, when present, are preserved and cited by relevant tasks and acceptance criteria; supporting work cites its design decision or spike question.
- [ ] Every in-scope requirement maps to one or more leaf tasks, or has an evidence-based reason why no system change is needed; source sections are used when ids are absent.
- [ ] Leaf acceptance criteria collectively cover the source acceptance conditions. Planning gaps are fixed before writing; gaps requiring main technical design follow the readiness rule and are recommended to `alice-spec` before planning continues.
- [ ] When an approved design has a DoD, every applicable criterion maps to leaf acceptance criteria, Verification and Done when, with pass criteria and required evidence. Checks spanning leaves appear in parent Done when and have a leaf responsible for execution. The planning reference cites rather than duplicates the design, and the draft does not claim checks have passed.
- [ ] When an approved design has Testing design, its scenarios and critical cases map to leaf tasks, test files/suites and verification commands without redesign. When it is absent, tasks use source acceptance conditions, established test patterns or agreed prototype/investigation validation.
- [ ] When no separate technical design is needed, source quality/transition requirements and acceptance conditions provide the task coverage; the plan does not require a spec merely to create a DoD.
- [ ] Relevant extracted documents have been read, conflicting sources resolved, and each task cites and links the documents/sections it needs with a reason; no separate artifact index is created.

## Report after creation

Use the person's language, name tasks and documents by title, and replace the counts with actual
numbers. Keep it to a few lines; never repeat the plan or print task descriptions.

> สร้างแผน “<ชื่อแผน>” บนบอร์ดแล้วครับ: <จำนวน> งานใน <จำนวน> กลุ่ม อ้างอิงเอกสาร “<ชื่อเอกสาร>”
> - **ready (พร้อมทำ)** <จำนวน> งาน: “<ชื่องาน>”, “<ชื่องาน>”
> - รอ dependency <จำนวน> งาน เช่น “<ชื่องาน>” รอ “<ชื่องานที่ต้องเสร็จก่อน>”
> - ครอบคลุม requirement ครบ <หรือ: ยังขาด <รายการ> เพราะ <เหตุผล>>
>
> อยากเริ่มทำต่อแบบไหนครับ?
>
> **1. ทำต่อเนื่อง** — ไล่ทำทีละงานจนจบแผน
> **2. ทำทีละงาน** — จบงานแล้วถามก่อนเริ่มงานถัดไป
> **3. ยังไม่เริ่ม**
>
> ตอบแค่เลขได้เลย หรืออยากให้ทำเฉพาะงานไหน พิมพ์ชื่องานมาได้ครับ

If no task is ready, say what everything waits for and leave out the question.

After each completed task in one-at-a-time mode, report the outcome briefly and ask:

> งาน “<ชื่องาน>” เสร็จแล้วครับ ต่อไป “<ชื่องานถัดไป>” — ทำต่อไหมครับ?

If the next task is still backlog but its blockers are done, add that yes will change it to
**ready (พร้อมทำ)** and start it. For a requested task that cannot start, state the blocking task and
ask whether to work on that prerequisite instead; do not silently expand the selection. At the end
of all leaves, report completion rather than asking for another task.
