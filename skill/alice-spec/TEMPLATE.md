# alice-spec output templates

Read [OUTPUT-FORMATS.md](OUTPUT-FORMATS.md) for the shared document header, splitting rules, requirement
references, Mermaid conventions and spikes.
Default to one technical design separate from its source brief. The core sections are Purpose, scope
and references; Decisions and alternatives; and Verification and evidence. Select other sections using
SKILL.md. Keep selected sections in the order below with the same headings and field order. Replace
every placeholder, repeat entries as needed, and omit irrelevant sections or optional fields instead
of empty headings or `N/A`.

## Technical design

```markdown
# <Title>

## Purpose, scope and references
- Type: Technical design.
- Scope: <technical boundaries>.
- Source: <brief/document title + id/path + section/requirement ids, task or agreed needs in chat>.
- Related documents: <title + id/path + section — how it is used and what is reused or superseded by agreement>.
- Purpose: <what is being designed>.
- Constraints: <agreed requirements and existing technical decisions>.
- Repository evidence: <repository/revision when available; paths and symbols inspected>.

## Architecture and interactions
- Requirements covered: <source brief id/path / REQ-001, or source section for older documents>.
<Insert a Mermaid component/flow diagram using the shared wrapper.>

| Component | Responsibility | Boundary/ownership |
|---|---|---|
| <component> | <responsibility> | <owner/boundary> |

- Interactions: <how components communicate, including failure boundaries>.
- Rationale and trade-offs: <why this structure; reference detailed decisions below>.

## Technical data model
- Requirements covered: <source references>.

| Entity | Field/type | Constraints/invariants |
|---|---|---|
| <entity> | <field/type> | <constraint> |

- Relationships: <cardinality and ownership>.
- Lifecycle: <creation, updates, retention and deletion>.
- Consistency and concurrency: <required guarantees and approach>.
<Insert a Mermaid ER diagram using the shared wrapper when relationships need explaining.>

## Contracts and integrations
### <Operation or event name>
- Requirements covered: <source references>.
- Operation/event: <method/path, event name, producer/consumer or equivalent identifier>.
- Input: <fields, types, required/optional and an example where helpful>.
- Output: <fields, types and an example where helpful>.
- Validation and errors: <invalid cases, error shapes/codes and caller behaviour>.
- Authorization: <who may perform or consume the operation>.
- Compatibility: <versioning and existing-consumer guarantees>.
- Delivery and recovery: <ordering, retry and idempotency semantics where relevant>.
<Reference or embed the relevant machine-readable schema if one exists; do not maintain conflicting copies.>
<Add a Mermaid sequence diagram using the shared wrapper when interaction order matters.>

## Behaviour and failure handling
- Requirements covered: <source references>.

| Current state | Trigger | Guard | Action | Next state |
|---|---|---|---|---|
| <state> | <trigger> | <condition> | <action> | <state> |

- Failure and recovery: <timeouts, partial failure, consistency and degraded behaviour as relevant>.
<Add a Mermaid state diagram using the shared wrapper when it clarifies the lifecycle.>

## Migration, rollout and rollback
- Requirements covered: <source references>.
- Preconditions: <conditions before starting>.

| Step | Change | Check and go/no-go criterion | Rollback/recovery |
|---|---|---|---|
| 1 | <transition step> | <proposed check and criterion> | <rollback or recovery action> |

- Transition compatibility: <how old/new data, users and consumers coexist>.
- Activation and monitoring: <activation conditions, signals and stop conditions>.
- Irreversible steps: <what cannot be undone, when reached and the recovery approach>.

## Operational design
- Requirements covered: <source references or supporting design decision>.
- Configuration and secrets: <required settings, ownership and secret handling; no secret values>.
- Observability: <signals, diagnosis and actionable failure conditions>.
- Capacity and security: <required controls or limits and how they are satisfied>.
- Support and recovery: <operational owner, procedures and recovery behaviour>.

## Decisions and alternatives
### <Decision title>
- Decision: <chosen approach>.
- Reason and evidence: <why it fits the requirements and evidence>.
- Alternatives: <significant options rejected and why>.
- Trade-offs: <what the approach gives up>.

## Verification and evidence
| Requirement/source | How the design satisfies it | Evidence or proposed verification |
|---|---|---|
| <source id/path / REQ-001> | <design section and mechanism> | <evidence or proposed check> |

### Evidence read
- <Source id/path/revision and what was observed; distinguish assumptions>.

### Proposed checks
- <Exact command/operation, target, what it proves and side effects. Not yet executed.>

### Checks performed
- <Command/operation, target, result and evidence from the approved execution>.

### Limitations
- <Checks not run, declined approval, inaccessible sources or remaining assumptions and their impact>.

## Remaining implementation details
| Detail | Allowed choices/boundary | Why it does not change the design |
|---|---|---|
| <detail for planning> | <constraints on the choice> | <reason> |
```

Omit unavailable optional references and inapplicable contract/operational fields. Use a diagram only
where it adds clarity; component responsibilities and precise contracts remain in text/tables. For
decisions without significant alternatives, omit Alternatives rather than inventing options.

Split architecture, contracts, data models or other topics only under the shared splitting criteria.
The extracted document uses the shared header and the relevant section format above. Its detail is
authoritative; the main design keeps the summary, affected decisions and a precise reference rather
than a duplicate specification. Show all document changes in the existing content approval.

Verification and evidence is always present. Keep only its relevant subsections; if no check was run,
state "No checks executed" under Limitations and why. Never fill Checks performed with proposed work.
Writing a check in the design or obtaining content approval does not authorize execution; ask before
each execution, including Mermaid syntax or render checks. Unresolved main design decisions stay in
discovery and prevent recommending planning.

After saving, report the design id/title or path, what it designs, verification limitations and the
recommended next step. Recommend `alice-plan` with design and source requirements references when
ready; otherwise identify the blocker or spike. Do not invoke another skill.
