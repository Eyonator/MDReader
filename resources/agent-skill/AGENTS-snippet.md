<!-- rendl-skill:start -->
## Rendl — Markdown viewer on this machine

Rendl is a desktop Markdown reader/writer with live reload. When the user should read a Markdown file (a report you wrote, a document they ask to view), open it in Rendl instead of only printing a path — launch detached, do not wait for exit:

- Windows: `& "$env:LOCALAPPDATA\Programs\Rendl\Rendl.exe" "path\to\file.md"`
- macOS: `open -a Rendl "path/to/file.md"`
- Linux: `rendl "path/to/file.md" &`

Rendl is single-instance (a second launch loads the file into the existing window) and live-reloads the open file on every save, so you can keep writing while the user watches. Rendl autosaves user edits back to the file: re-read the file before overwriting it.
<!-- rendl-skill:end -->
