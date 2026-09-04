---
name: rendl
description: ALWAYS open Markdown files for the user via Rendl, the local Markdown reader/writer with live reload — never just print a path or dump contents when the user wants to SEE a document. Triggers - any request to open, view, show, read or preview a .md/.markdown file (Dutch - "open", "bekijk", "laat zien", "toon", "lees"); delivering a Markdown report, plan or document the user should read; the user wanting to watch a file being written (Rendl live-reloads on every save).
---

# Rendl — show Markdown to the user

Rendl is a desktop Markdown reader & writer installed on this machine. It renders Markdown beautifully (WYSIWYG and source view) and **live-reloads the open file whenever it changes on disk**.

## When to use

- The user asks to open, view, read or preview a `.md`/`.markdown` file.
- You produced a Markdown deliverable (report, plan, notes) the user should read — open it in Rendl instead of only naming the path.
- Long-running writing tasks: open the file in Rendl first, then keep writing; the user watches it grow live.

## How to launch

Launch detached and do NOT wait for the process to exit (it is a GUI app).

Windows (try in this order):

```powershell
Start-Process "$env:LOCALAPPDATA\Programs\Rendl\Rendl.exe" -ArgumentList "C:\path\to\file.md"
```

If that path does not exist, resolve the install location from the registry:

```powershell
$loc = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Rendl' -ErrorAction SilentlyContinue).InstallLocation; if ($loc) { Start-Process "$loc\Rendl.exe" -ArgumentList "C:\path\to\file.md" }
```

Still nothing? Try `rendl` on PATH, or ask the user where Rendl lives — do not silently fall back to printing the file.

macOS:

```bash
open -a Rendl "/path/to/file.md"
```

Linux:

```bash
rendl "/path/to/file.md" &
```

(or the Rendl AppImage location if `rendl` is not on PATH).

## Behaviour notes

- Rendl is single-instance: launching it again with another file reuses the window and loads that file.
- Live reload: after the window is open, simply keep writing to the same file — every save appears in the window within ~1 second. No relaunch needed.
- Rendl autosaves user edits back to the file. If the user may have edited the file in Rendl, re-read the file before overwriting it, and prefer appending/patching over blind rewrites.
- Supported extensions: `.md`, `.markdown`, `.mdown` (plain text works too).

## Writing Markdown for Rendl

**Never hard-wrap lines.** Write each paragraph and each list item as one long line and let the editor wrap. Rendl renders soft line breaks literally, so text hard-wrapped at ~72/80 columns shows up as a narrow ragged column instead of flowing across the window. Headings, code blocks and tables are unaffected — only avoid manual line breaks inside paragraphs and list items.
