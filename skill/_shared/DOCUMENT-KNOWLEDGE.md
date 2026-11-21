# Reusing Alice document knowledge

Read this when an Alice workspace supports runtime Documents. It does not apply to project files in
`.alice/`: those Markdown documents only support their documented front matter and body references;
do not invent lifecycle metadata or typed relationships there.

Before creating a brief, design, plan or reusable finding:

1. Search with `search` and `search_documents`. Search is lexical (title, keywords, tags, body and source
   URL), not semantic or vector search. Read the best match reason and then open the relevant sections.
2. Inspect `status`, owner, source URL, review revision/time/actor and relations. Treat `current` as the
   reviewed source. Verify `draft` and `unreviewed`; use `superseded` only as history and follow its
   relations to a newer source.
3. Reuse or update the authoritative document when its scope still fits. Cite it as title + id + section
   in another document or task. Do not cite a search excerpt as if it were the source.
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
