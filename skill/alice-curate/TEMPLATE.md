# Curation chat templates

These shapes are for chat. They are not documents to save: save a report only when the person asks.
Replace every placeholder with what actually happened; omit a section only when it is empty, and say so
where the template asks. Talk about documents and topics by title, with the id next to the title in
evidence and proposals, where the person may need to check it.

## Scope line

```markdown
Inspecting **<project or "workspace">** in **<workspace name> (<alias>)** — depth **<A — Focused inspection | B — Full content comparison>**.
```

## Depth question (only when the person has not chosen)

```markdown
❓ **Depth**: how deep should I inspect "<project>"?
- **A — Focused inspection**: check topics, reading starts, links and status, then read content only where a finding gives a reason.
- **B — Full content comparison**: read and compare every document in scope. Takes noticeably more time and tokens.

➡️ A. I will wait for your choice before starting.
```

## Report

```markdown
## Knowledge inspection — <scope>

**Scope and coverage**
- Workspace / scope / depth: <name (alias)> / <project or workspace> / <A or B>
- Documents listed: <n> (<n> linked to the project, <n> through topics only); topics: <n>
- Content read: <n of n> documents — <for A: each with its reason; for B: complete, or progress>
- Not inspected: <documents, windows or relations not read, and why: archived, unavailable, error, budget>
- Referenced documents outside scope read: <titles, or none>; their projects were not inspected.

**Findings**

| # | Class | Found | Evidence | Impact | Proposal |
|---|---|---|---|---|---|
| F1 | <Fact / Suspicion / Conflict / Unknown> | <what> | "<title>" (<doc id>) rev <n>, <heading or offset range>; or topic "<name>" (<topic id>) rev <n> | <who or what it affects> | <P-number, or "decide" / "check further"> |

**Ready to apply**: <P-numbers, with one line each> — or "none".
**Needs a decision or more checking**: <items and the question or check each needs> — or "none".

<If no findings:> No issues found in <scope> at depth <A/B>, within what was inspected above. This is not a guarantee that the whole library is correct.

<If B did not finish:> Read so far: <documents/windows>. Remaining: <documents/windows>. Continue with B from "<next document>" offset <n>, or stop here.
```

## Proposal

```markdown
## Proposed changes

| # | Target | Based on | Change | Reason | Revision and review effect |
|---|---|---|---|---|---|
| P1 | Topic "<name>" (<topic id>) | topic rev <n> | Add "<document>" (<doc id>) before "<document>" | <finding F-number> | Topic revision only; document content and review unchanged |
| P2 | "<document>" (<doc id>) | rev <n> | <exact diff or replacement text for the named section> | <finding> | New content revision; a current review is cleared |
| P3 | "<document>" → "<document>" | — | Add `references` relation | <finding> | No content revision; review unchanged |

Not included: review, archive, restore or supersedes. Each needs its own approval if you want it.

Which items should I apply? (all, some by number, adjust, or none)
```

## Apply summary

```markdown
## Applied changes

| # | Result | Detail |
|---|---|---|
| P1 | Applied | Topic "<name>" now rev <n> |
| P2 | Not applied — changed since proposal | "<document>" is now rev <n>; revised proposal below |
| P3 | Failed | <error code and message> |
| P4 | Not applied — not approved | — |

<Revised items needing approval, in the Proposal shape, or "none".>
```
