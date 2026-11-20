# alice-think output templates

Read [OUTPUT-FORMATS.md](OUTPUT-FORMATS.md) for requirement ids, Mermaid conventions, small tasks and
spikes. Use one brief by default. The core sections are Problem and goal, Source and references, and
Decisions. Select other sections using SKILL.md; keep selected sections in the order below with the
same headings and field order. Repeat entries as needed, replace every placeholder and omit irrelevant
sections or optional fields rather than writing empty headings or `N/A`.

## Brief

```markdown
# <Title>

## Problem and goal
- Users: <who has the problem>.
- Problem: <what happens today and why it matters>.
- Goal: <the change people need>.
- Success measure: <how to tell it worked>.

## Source and references
- Source: <the request, feedback or link>.
- Related document: <id/path and title> — <what remains applicable and any agreed change>.

## Scope and out of scope
- In: <included users, cases and capabilities>.
- Out: <explicit exclusions>.

## Software requirements and acceptance conditions
### REQ-001 — <Short title>
- Requirement: <one observable behaviour>.
- Business rules: <permissions, limits and rules, when applicable>.
- Acceptance conditions:
  1. <A specific, checkable condition; include relevant failure or boundary cases>.

## Quality requirements and constraints
### REQ-002 — <Short title>
- Requirement: <the required quality or constraint without choosing implementation>.
- Acceptance conditions:
  1. <A measurable target and the circumstances under which it applies>.

## User journey
### <Journey name>
- User and goal: <who is trying to achieve what>.
- Start: <trigger and prerequisites>.

| Step | Actor | Action | System/channel response |
|---|---|---|---|
| 1 | <actor> | <action> | <response, including steps outside the system> |

- Result: <what the user achieves>.
- Alternatives and pain points: <which step branches or causes difficulty and why>.

## UI flow and states
### <Flow name>
- Related requirements: <local requirement ids>.
- Entry: <where and how the flow starts>.

| Screen/state | User action or trigger | Result/next state |
|---|---|---|
| <screen/state> | <action/trigger> | <result/state> |

- Failure paths: <error and recovery>.
- Other states: <loading, empty, cancel and back behaviour where applicable>.
<Insert a Mermaid diagram with the shared wrapper when it clarifies the flow.>

## Domain and information needs
| Concept | Meaning | Relationships | Owner |
|---|---|---|---|
| <business concept> | <definition> | <business relationships> | <owner> |

- Lifecycle rules: <business states and allowed changes>.
- Information needs: <information required and retention needs; no physical schema>.

## Transition requirements
### REQ-003 — <Short title>
- Requirement: <what existing users, data or integrations must retain during the transition>.
- Acceptance conditions:
  1. <Required continuity, compatibility or acceptable disruption>.

## Decisions
- <Question> → <agreed answer>. Reason: <why>. Source: <evidence or the person's decision>.

## Open questions
| Question | Owner | Next step | Why it does not block the agreed needs or scope |
|---|---|---|---|
| <technical detail left for design/planning> | <owner> | <action> | <reason> |
```

Related document entries, business rules, exclusions, journey alternatives and UI states are optional
when they do not apply. Requirement numbers above are examples, not reserved ranges per section.
Existing ids take precedence over the sample numbering. A question that could change the agreed
problem, goal, scope or acceptance conditions stays in discovery rather than this Open questions table.

After saving, report the brief id/title or path, the content included, and the recommended next skill
with the reason and input references. For a task or spike, report its id/title and the next step. Do
not invoke the recommended skill.
