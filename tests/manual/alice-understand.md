# alice-understand behavioral walkthrough

Run in temporary repositories and a temporary Alice server/board only. Do not inspect private
credentials or save fixtures into a real user's workspace. Record the skill revision, inputs, actual
artifacts and differences from expectations. Static text tests do not prove these behaviors.

See [qualification evidence](alice-understand-results.md) for the author-driven run, executable
storage/install checks and their explicit evaluation limits.

## Scenarios

1. **First overview / monolith.** Supply a tiny app with routes, an owned store, package scripts and a
   test. Request project understanding. Expect overview + separate Mermaid graph, all nine coverage
   categories accounted for, code entry points and commands marked found rather than executed.
2. **Multiple repositories.** Supply an API publishing an event and a consumer repo handling it.
   Request the end-to-end business capability. Expect both repo identities/baselines and a supported
   publisher/consumer relationship, data ownership and links from capability to flow to code.
3. **Inaccessible service / conflicting docs.** Give an outbound client without the target repo and a
   README claiming a different endpoint than code. Expect a clearly bounded external node, unknown
   implementation and an explicit conflict, not an invented production fact. Ask only for access
   needed to answer the goal, not every unknown.
4. **Dirty tree.** Keep HEAD unchanged, edit a route, stage a contract edit and add an untracked
   consumer. Expect all three changes to be considered. Never claim freshness from HEAD alone.
5. **Focused refresh.** Seed prior knowledge for two modules. Change one module and its event edge.
   Expect that detail/edge updated, unrelated prose and earlier baseline retained, and untouched
   coverage marked not rechecked. Remove baseline history and expect re-inspection, not false reuse.
6. **Later work.** Give a precise validation fix, then an unclear cross-service request. Expect code
   first plus a short relationship lookup for the first, overview first for the second. Internal-only
   changes do not force a knowledge rewrite; contract/dependency changes update owning detail/graph.
7. **Destinations and scope.** Repeat saving into a temporary runtime project and a project-file
   board. Verify real IDs/links/relations, revision updates and unchanged identity on refresh. For
   project files use only id/title/optional source_url front matter, body references and Mermaid
   source. Source repos remain unchanged; no tasks, implicit reviews, deployment or secret copying.

## Evidence to retain

- Scenario inputs and source status/diff before and after (source files must be unchanged).
- Actual overview/detail/graph outputs and their source baselines/coverage.
- Runtime IDs/revisions/relations, or project-file paths and validated front matter.
- Requirement mapping REQ-001–008, executed command results and remaining limitations.
- Mermaid syntax/render result only if a validator/renderer actually ran. Otherwise say unvalidated.
