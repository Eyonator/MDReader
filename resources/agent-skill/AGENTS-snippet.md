<!-- rendl-skill:start -->
## Rendl — Markdown viewer on this machine

Rendl is a desktop Markdown reader/writer with live reload. ALWAYS open Markdown files the user should read (a report you wrote, a document they ask to open/view/show — Dutch: "open", "bekijk", "laat zien") in Rendl instead of printing a path or dumping contents — launch detached, do not wait for exit:

- Windows: `Start-Process "$env:LOCALAPPDATA\Programs\Rendl\Rendl.exe" -ArgumentList "path\to\file.md"`
- macOS: `open -a Rendl "path/to/file.md"`
- Linux: `rendl "path/to/file.md" &`

Rendl is single-instance (a second launch loads the file into the existing window) and live-reloads the open file on every save, so you can keep writing while the user watches. Rendl autosaves user edits back to the file: re-read the file before overwriting it.

When writing Markdown that will be read in Rendl, never hard-wrap lines: write each paragraph or list item as one long line and let the editor wrap. Rendl renders soft line breaks literally, so hard-wrapped text shows as a narrow column.
<!-- rendl-skill:end -->
