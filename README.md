# Rendl

**Markdown reader & writer — Write plain. Read beautifully.** *(uitspraak: REN-dl)*

Een kleine, moderne Windows-app om Markdown-bestanden te schrijven én te lezen, met een "liquid glass"-interface. De naam komt van *render*: de kern van de app is het wisselen tussen kale Markdown-bron en de prachtig gerenderde weergave. Zie `docs/brand/BRAND.md` voor de merkidentiteit.

## Mogelijkheden

- **Eén gecombineerde editor** met een pill-schakelaar tussen **Opmaak** (Markdown-bron) en **Live** (WYSIWYG)
- **Volledige opmaakwerkbalk**: koppen, vet, cursief, doorhalen, lijsten, taken, citaten, tabellen, links, afbeeldingen, code(blokken) met syntaxkleuring
- **Automatisch opslaan** (dynamisch, zoals Google Docs) zodra het bestand een locatie heeft
- **Live herladen**: wijzigt een ander programma het geopende bestand, dan laadt de app direct de nieuwste versie
- **Licht, donker en automatisch thema** (volgt Windows)
- Recente bestanden, slepen-en-neerzetten, sneltoetsen (Ctrl+N/O/S, Ctrl+Shift+S, Ctrl+E wisselt weergave, Ctrl+B/I/… voor opmaak)
- **Ongedaan maken over sessies heen**: Ctrl+Z/Ctrl+Y werken zoals verwacht, en blijven wérken nadat je de app afsloot en hetzelfde document opnieuw opent — per document worden opslag-snapshots bijgehouden in een verborgen map (`%LOCALAPPDATA%\Rendl\history`)

## Ontwikkelen

```bash
npm install   # installeert dependencies en bouwt de editorbundel
npm start     # start de app
```

## Uitleveren

```bash
npm run dist
```

Per platform is er **één pakket**:

- **Windows — `Rendl-<versie>-win.exe`**: start direct als portable app (geen installatie, ook vanaf USB). Wil je Rendl definitief installeren, klik dan in de app op **Installeren**: Rendl komt in `%LOCALAPPDATA%\Programs\Rendl`, in je startmenu en gekoppeld aan `.md`/`.markdown`/`.mdown` — zonder beheerdersrechten, met nette verwijder-optie in Instellingen → Apps. Stille varianten: `Rendl.exe --install-silent` en `Rendl.exe --uninstall`.
- **macOS — `Rendl-<versie>-mac.dmg`** (universal, Intel + Apple Silicon)
- **Linux — `Rendl-<versie>-linux.AppImage`**

macOS- en Linux-builds kunnen niet vanaf Windows worden gebouwd; de GitHub Actions-workflow (`.github/workflows/release.yml`) bouwt bij het pushen van een `v*`-tag alle drie de platforms en publiceert ze als GitHub Release.

### AI-agent-skill

Bij installatie kun je de **AI-agent-skill** meenemen: die leert lokale AI-agents (Claude Code, Codex, en andere) om Markdown-bestanden voor je te openen in Rendl — inclusief live meeschrijven dankzij live-reload. De skill wordt geplaatst in `~/.claude/skills/rendl/` en (indien Codex aanwezig is) als sectie in `~/.codex/AGENTS.md`; de bronbestanden staan in `resources/agent-skill/` en naast de geïnstalleerde app voor andere agents.

## Structuur

- `main.js` — Electron-hoofdproces (vensters, dialogen, bestands-I/O, file watcher)
- `preload.js` — veilige brug tussen hoofdproces en UI
- `renderer/` — de interface (HTML/CSS/JS, Toast UI Editor gebundeld via esbuild)
- `locales/nl.json` — alle teksten in de app; voeg een extra taal toe door een nieuw bestand naast dit bestand te leggen
- `build/editor-entry.js` — entry voor de gebundelde editor (`npm run build:editor`)

Alle code is Engelstalig; alle zichtbare teksten komen uit `locales/`.
