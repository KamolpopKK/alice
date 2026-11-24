# Curating project knowledge

`alice-curate` is an agent skill that inspects your Alice knowledge library when you ask. It reports
what it found in chat, with evidence, and proposes changes. It changes the library only for the items
you approve. Nothing runs in the background: there is no scheduled scan, no new app screen, no
Graph View, no embeddings and no model download. The agent uses the same Documents, Topics, links and
revision/review rules described in [Project knowledge](project-knowledge.md).

## Starting an inspection

Invoke it as `$alice-curate` in Codex or `/alice-curate` in Claude Code, then say what you want checked:

```text
/alice-curate Check the alice dev knowledge with a focused inspection.
$alice-curate Compare every document in the Payments project in full.
/alice-curate Tidy up the Onboarding project's knowledge.
/alice-curate Inspect the whole Personal workspace, focused.
```

The agent uses the workspace already chosen in the conversation (or asks which one, like every Alice
skill). It then needs two things:

- **Scope.** One project by default. Name the whole workspace to inspect everything. When an in-scope
  document references a document elsewhere, the agent reads that document but does not inspect the
  rest of its project; it offers that as a separate inspection.
- **Depth.** If your request does not say, the agent asks once and recommends A, then waits for your
  answer:
  - **A — Focused inspection.** Checks topics, reading starts, links and status, then reads content
    only where a finding gives a reason.
  - **B — Full content comparison.** Reads and compares every document in scope. It takes noticeably
    more time and tokens.

```text
❓ Depth: how deep should I inspect "Onboarding"?
- A — Focused inspection: check topics, reading starts, links and status, then read content only where a finding gives a reason.
- B — Full content comparison: read and compare every document in scope. Takes noticeably more time and tokens.

➡️ A. I will wait for your choice before starting.
```

When you already said "focused" or "full", the agent does not ask again.

## What it checks

- documents in scope that no topic includes, and topics without a clear reading start;
- links, references and reading-list members pointing to archived, unavailable or superseded
  documents, with the replacement when a `supersedes` relation names one;
- draft or unreviewed documents that a topic presents as a starting point;
- at the chosen depth, content that contradicts another document, overlaps it, or points at replaced
  sources.

Scope comes from actual project links plus active topic membership, the same set that knowledge search
uses. A document with no topic or no backlinks is information to weigh, not an error. Age alone never
makes a document stale, and similar titles alone never make two documents duplicates.

## The report

The report stays in chat. It is not saved as a Document and creates no tasks unless you ask. It shows:

- scope, depth, how many documents and topics were listed, what was read and what was not, and why;
- each finding as what was found → evidence → impact → proposal;
- whether each finding is a **fact**, a **suspicion**, a **conflict** between named sources, or an
  **unknown** the agent could not check;
- which proposals you can approve now, and which need your decision or more checking.

Content evidence names the document title, its id, the revision actually read and the heading or offset
range. Example:

```markdown
## Knowledge inspection — Onboarding

**Scope and coverage**
- Workspace / scope / depth: Personal (personal) / Onboarding / A
- Documents listed: 12 (10 linked to the project, 2 through topics only); topics: 3
- Content read: 2 of 12 — "Local setup" (suspected duplicate), "First week" (links a superseded guide)
- Not inspected: content of the other 10 documents (depth A)

**Findings**

| # | Class | Found | Evidence | Impact | Proposal |
|---|---|---|---|---|---|
| F1 | Fact | "First week" links a superseded guide | "First week" (doc_…) rev 4, § Tools; "Old setup" (doc_…) is superseded by "Local setup" (doc_…) | Readers follow outdated steps | P1 |
| F2 | Suspicion | "Local setup" and "Dev machine" may cover the same steps | "Local setup" rev 7 § Install; "Dev machine" rev 2 § Install | Two places to maintain | Decide which one owns the steps |
| F3 | Fact | "Release notes" is in no topic | Listed through the project link only | Harder to find from Knowledge | P2 |

**Ready to apply**: P1 — update the link in "First week" § Tools; P2 — add "Release notes" to topic "Reference".
**Needs a decision or more checking**: F2 — which document should own the install steps?
```

If nothing turns up, the report says no issues were found within the inspected scope and depth. That is
not a guarantee that the whole library is correct, and content comparison never promises to find every
duplicate or conflict.

With B, the agent reads every document to its end, window by window. If it cannot finish, it reports
which documents and windows are read, which remain and how to continue. It does not quietly switch to A.

## Approving changes

Inspection alone changes nothing. To stop after the report, say so or simply do not approve anything.
Each proposal names the target, the revision it is based on, the exact change, the reason and the
effect on revision and review:

- a content edit creates a new revision and clears a current review;
- topic membership, order and introduction changes, and links between documents, leave content
  revision and review unchanged.

You can approve all items, some by number, adjust them, or reject them all:

```text
Apply P2 only.
Skip everything; I only wanted the report.
Apply P1 and P2, but put "Release notes" first in the topic.
```

Before writing each approved item the agent re-reads the latest document or topic. If it changed so
the proposal no longer fits, the agent does not apply that item; it shows the revised item and waits for
your approval. Other approved items continue. Content edits are merged into the latest body so other
people's edits survive; document updates have no compare-and-swap, so the agent re-reads immediately
before writing rather than promising an atomic edit. Topic changes use the topic revision and a
mutation id, so a concurrent change is detected instead of overwritten.

The agent finishes with what was applied, what failed (with the error), what was not applied and why,
and what waits for re-approval:

```markdown
| # | Result | Detail |
|---|---|---|
| P1 | Not applied — changed since proposal | "First week" is now rev 5; revised proposal below |
| P2 | Applied | Topic "Reference" now rev 9 |
```

Approving organisation or edits never approves review, archive, restore or supersedes. Ask for those
separately. Curation and generated content never count as a review.

## Project files

For a board kept as Markdown in `.alice/`, the skill inspects `.alice/docs/` with the same scope, depth,
evidence and approval rules. Project files have no topics, lifecycle status, review, backlinks or typed
relations, so the agent does not invent them; it proposes reading order and links as Markdown edits and
commits approved edits on their own.

## Which skill to use

| You want to | Use |
|---|---|
| Check or tidy existing knowledge: topics, reading starts, links, status, overlapping content | `alice-curate` |
| Understand a codebase or system and record what it does | `alice-understand` |
| Agree the needs for new work | `alice-think` |
| Break agreed work into tasks | `alice-plan` |
| Work on a task | `alice` |

`alice-curate` does not audit code. When a finding needs new work, it describes it and may recommend
`alice-think`; it never invokes another skill by itself.

## Installing

`alice install-skill --client codex --skill alice-curate` (or `--client claude-code`) installs only this
skill and its shared guides; omit `--skill` for every Alice skill. `alice integration enable` and
`alice integration refresh` include it for Local workspaces. Start a new agent session after installing.
An older released CLI cannot install a skill it does not bundle. See [agent guidance](agents.md) and the
[chat templates](../skill/alice-curate/TEMPLATE.md).
