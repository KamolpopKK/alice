# Alice concept illustration draft

Generated with the built-in `image_gen` tool on 2026-11-22.

- Image: `docs/design/alice-concept-draft.png`
- Identity reference: `src/web/public/brand/alice-mascot-friendly.webp`
- Task: Approve the Alice concept illustration draft
- Review state: **Approved** by the requesting user on 2026-11-22 (answer to Claude Code: "Approve this draft"). The
  approval accepts this raster as the README concept image and drops the editable-source requirement for it.
  Publishing (an optimized WebP of at most 500 KB, alt text, light/dark check) is a separate task.

## Generation prompt

```text
Use case: infographic-diagram
Asset type: Alice README concept illustration draft, wide landscape 16:9.
Primary request: Tell the Alice product concept in one polished, friendly illustrated scene: humans and AI agents coordinate work on one shared board, use the workflow Think → Design → Plan → Work, keep reusable knowledge in Docs and a System graph, see live updates and attribution, and run Local / Self-hosted.
Input images: Image 1 is the EXISTING ALICE MASCOT identity reference, not an edit target. Preserve her distinctive face, short dark-brown bob, cream frilled headband, navy dress, ivory apron, chibi proportions, and warm expression. Use this same mascot as the guide; do not redesign her.
Composition: Spacious coherent editorial infographic, readable at 720px README display width. Alice stands at left presenting a large simplified central kanban board. Two small human collaborators and friendly generic AI-agent symbols contribute cards to the same board. Below the board, a strong clear four-step left-to-right workflow. To the right, Docs sheets connect to a small node-link System graph, looping knowledge back to the board. Small tasteful live attribution activity bubbles show who changed a card. A small desktop/server motif anchors local ownership.
Style/medium: Crisp polished flat illustration with subtle soft shading and rounded cards; professional open-source product storytelling, matching the reference character. No screenshot, no photorealism.
Color palette: ivory #FFF8EE, navy #202A44 and #344466, cocoa #4A312E, coral #EE715F. Opaque ivory canvas, generous margins, dark legible typography, usable within both light and dark GitHub pages.
Text (verbatim, large and sparse): "Alice"; "People + AI agents"; "One shared board"; "Think"; "Design"; "Plan"; "Work"; "Docs"; "System graph"; "Live updates"; "Who did what"; "Local / Self-hosted".
Constraints: All listed concepts must be visually connected; retain exact mascot identity. Prioritize clear visual narrative over tiny text. Four workflow stages must be ordered Think, Design, Plan, Work, once each. Board cards can be blank with simple colored lines. No extra paragraphs, tiny pseudo-text, watermarks, external company logos or decorative clutter. This is a draft for review, not a UI implementation.
```
