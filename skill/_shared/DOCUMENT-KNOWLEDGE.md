# Reusing Alice document knowledge

Read this when an Alice workspace supports runtime Documents. It does not apply to project files in
`.alice/`: those Markdown documents only support their documented front matter and body references;
do not invent lifecycle metadata or typed relationships there.

Before creating a brief, design, plan or reusable finding:

1. Discover the relevant project/topic first with `list_knowledge_topics` and `get_knowledge_context`
   when available; inspect candidates, not the whole vault. Use `search_documents` / `search` for normal
   discovery or when curation is empty. Do not ask for attachments that the selected workspace already
   contains. Search is lexical (title, keywords, tags, body and source URL), not semantic or vector search
   or conflict detection. Older servers without `project-knowledge` use ordinary document search.
   For Local CLI: `alice knowledge context --project ID [--q QUERY] [--topic ID] --json`.
   Read selected headings with `get_document_outline`, then `get_document` at the returned
   `expectedRevision` and selected offsets. CLI equivalents are `document outline/content --revision N`.
   Follow actual cursors/windows only as needed; a changed revision returns `CONFLICT`, so restart the
   dependent read instead of combining revisions.
2. Inspect `status`, owner, source URL, review revision/time/actor and relations. Treat `current` as evidence of a
   recorded review, not proof that every statement still matches current code. Verify `draft` and `unreviewed`; use `superseded` only as history and follow its
   relations to a newer source.
3. Reuse or update the authoritative document when its scope still fits. Cite the title + id + revision actually read + heading or offset range
   in another document or task. Distinguish source statements, current repository evidence and your inference. Do not cite a search excerpt as if it were the source.
4. Give reusable documents focused tags, search keywords and an owner when known. Content edits create
   a revision and clear a current review; metadata-only edits preserve the content revision and review.
5. Review with the revision you actually read. A stale revision returns `CONFLICT`; reload and review
   again rather than forcing it.
6. Use `references` for a source dependency, symmetric `related` for peer context, and `supersedes` only
   when the new document replaces the target. Supersedes requires explicit acknowledgement and marks the
   target `superseded`; removing the relation does not restore its former status.

Task/project links and document relations are different: `link_document` connects a document to work;
`link_document_relation` connects two knowledge documents.

## Using project understanding during work

Choose the entry point to fit the task. For a precise code change, start at that code and do a short
search for its component/feature and relationships in the overview or System graph. For an unclear or
cross-service request, start with the overview, then follow only the relevant detail. Do not load all
project knowledge or invoke alice-understand automatically for every task.

Check the source evidence in the area you will change: document review is not proof that the current
code still matches it. Compare relevant repository baselines and working-tree changes, including
staged, unstaged and untracked files. Look beyond the immediate code for consumers, event contracts,
data ownership and external integrations. If knowledge conflicts with code, inspect the evidence and
correct the owning detail rather than silently relying on either source.

When authorized work changes a documented responsibility, contract, dependency or flow, update its
authoritative detail and affected System graph nodes/edges, and keep overview links accurate. Preserve
unrelated coverage and earlier evidence. An internal-only change does not require a document rewrite.
Use the task's knowledge-maintenance authorization; ask before an update outside that scope. Keep the
normal revision/review rules: content changes clear review, and generation is not review.

## Curating and maintaining runtime knowledge

Topics hold a short introduction and ordered references to existing Documents. A Document can belong
to multiple topics/projects in the same workspace without copying its body or automatically adding a
project link. Topic membership is curation, not a review. Source projects are the actual linked
projects; do not invent one exclusive owner project. Standard `[label](/documents/id#fragment)` links
create derived backlinks; manual `references`, `related` and `supersedes` remain distinct.

Before applying an organization or content-maintenance change, make it reviewable: name the target
Document/topic, actual revision, proposed add/remove/move or content diff, reason and consequences for
review/references. Use the person's scoped approval already given in chat or the task when it covers
those exact changes; do not ask twice. Otherwise obtain approval before those runtime writes. A broad
request to find/read context is not authorization to reorganize the library. These rules do not add
approval requirements to ordinary implementation, tests or already-approved brief/design delivery.
Apply only the approved subset and report partial results. A rejected or still-pending proposal makes
no runtime knowledge changes. Approval to curate/edit does not authorize unrelated archive,
supersedes or marking content current; generation and curation never count as review.

Re-read the actual source before writing. Topic/member mutations require its current topic revision
and an explicit mutation ID. Reuse the unchanged ID/payload after an uncertain response within the
configured idempotency-retention period; a payload mismatch fails. After a conflict or expired replay
window, reload state and reconcile before another attempt. For reviewed evidence, always use the
revision actually inspected; do not force review of a newer revision.

When sources are missing, stale or disagree, disclose the uncertainty, follow relevant relations and
check accessible code/source evidence. Ask only for decisions that evidence cannot resolve. Stop the
work dependent on that unresolved point while continuing independent authorized work. An empty
lexical search is not proof that the knowledge does not exist. Archived/unavailable previews expose
no body; open/read an appropriate source deliberately instead of substituting old cached text.
