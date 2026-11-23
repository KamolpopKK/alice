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
