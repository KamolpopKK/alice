# Writing documents

Documents are written on their own pages: `/documents/new` and `/documents/:id/edit`. Every way in opens
these pages: the Documents list, Home, the New menu, the command palette, a task's or project's Documents
section, and Edit on a document. Older `/documents?new=1` links open the Create page.

## Rich text and Markdown

The body opens in a rich text editor with a toolbar for headings, bold, italic, strikethrough, inline code,
bulleted, numbered and check lists, code blocks, tables, links, undo and redo. **Markdown** shows the
source with a preview; **Rich text** goes back.

Markdown stays the saved format, so agents and the `alice` command read exactly what people write:

- Blocks you do not touch keep their exact text, including spacing.
- Content the editor cannot show safely (raw HTML, comments, reference links and their definitions,
  footnotes, images, or a list or table that contains them) appears as a **Markdown kept as written**
  block. It is shown as plain text, the toolbar cannot change it, and **Edit in Markdown** opens the
  source.
- Mermaid code blocks keep their source and show a diagram preview that renders after you type.
- Pasted scripts, event handlers, images and `javascript:` links are dropped. Links accept web, `mailto:`
  and in-app addresses.
- A document over 100,000 characters is never cut; the editor says so and keeps your text.

If the rich editor cannot load, the Markdown source is offered instead. Task descriptions and comments
keep the plain Markdown editor.

**Read draft** opens what you have written so far in the focus reader (see below), labelled *Unsaved
draft · not a saved revision*. In rich text it includes what you typed a moment ago; in Markdown it
shows the source as it is now. Reading saves nothing and leaves the editor exactly as it was: same mode,
same undo and redo history, raw blocks untouched. Each time you open it, it shows the latest draft. If the
draft cannot be converted to Markdown (for example it would pass 100,000 characters), the reader does not
open and your text stays as it is.

## Saving

- **Create document** creates nothing until pressed, then opens the new document. Opened from a task or
  project, the page says what it will link to, and links after creating.
- If the connection drops during a save, your text stays and the page says the save may not have
  finished. Pressing the button again finishes it without making a second copy.
- If the document was created but the link failed, the Edit page says so and **Retry link** finishes it.
- Edits send only the fields you changed. Content changes create a new revision and clear the review, as
  before; tags, keywords, owner and status alone do not.

## When someone else saves meanwhile

If someone (a person or an agent) saves the document while you edit it, an untouched editor shows their
version. With unsaved changes, your text stays and a notice says who saved and when. Saving then asks
whether to save over their version or load theirs. Alice never merges the two.

Documents are last-write-wins on the server. The check happens right before saving, so a save that lands
in between can still be overwritten.

## Leaving with unsaved changes

Following a link, going Back, a deep link, Cancel, signing out, switching workspace, and in Alice Desktop
closing the window, quitting or installing an update all ask **Discard unsaved changes?** first. **Stay
and keep editing** is the default. Reloading or closing the browser tab asks the browser to confirm.

Unsaved text is kept in memory only, for the workspace and person it belongs to. Moving around the app
keeps it; it never shows up in another workspace or for another account. A reload, force quit or crash
loses it.

## Reading in a larger view

- **Focus reader.** On a document, **Focus reader** (next to View) opens the saved content in a
  near-full-window view over the page. The title, status and revision stay at the top with **Close**;
  the content scrolls on its own. Text keeps a comfortable line length, while tables, code and
  diagrams can use the whole width. Links to headings in the same document scroll inside the reader;
  links to other pages close it and open them as usual. **Close** or Escape returns you to the same
  place and focus on the page. It is not remembered between visits and never changes the document.
- **Wide tables** scroll sideways inside their own frame, on the page and in the reader, instead of
  squeezing every column. Each cell wraps at a readable width. Focus the table (Tab) and use the arrow
  keys, a trackpad or touch to move across. Tables in the editor are unchanged.
- **Diagrams.** A Mermaid diagram that rendered shows **Expand diagram**. The viewer opens with the
  whole diagram fitted to the window and offers **Zoom out**, the zoom level, **Zoom in** and **Fit to
  view**. With focus in the viewer, + and − zoom and 0 fits; scroll, the arrow and Page keys, a trackpad
  or touch move around. Zooming resizes the same image, so it is instant and nothing is drawn again. A
  diagram that fails to render keeps its error and source and has no viewer.
- **Escape closes one layer at a time**: the diagram viewer first, then the reader, then a preview.
  Focus returns to the button that opened each one.

These views work the same in the browser and in Alice Desktop. They were tested in Chromium on desktop
and phone-sized screens; Safari, Firefox and physical phones and tablets are not yet qualified.

## Internal document links and previews

The Link toolbar can search existing Documents and inserts standard ID-based Markdown links while
keeping selected labels. Renames do not rewrite stored labels. Internal navigation, rendered heading
fragments, provenance-aware backlinks and bounded accessible previews, including **Expand to read**, are
described in [Project knowledge](project-knowledge.md). Existing source/raw Markdown preservation still applies.
