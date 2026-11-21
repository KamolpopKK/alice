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
