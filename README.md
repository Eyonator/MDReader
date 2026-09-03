# Rendl

**Markdown reader & writer — Write plain. Read beautifully.** *(uitspraak: REN-dl)*

Een kleine, moderne Windows-app om Markdown-bestanden te schrijven én te lezen, met een "liquid glass"-interface. De naam komt van *render*: de kern van de app is het wisselen tussen kale Markdown-bron en de prachtig gerenderde weergave. Zie `docs/brand/BRAND.md` voor de merkidentiteit.

## Mogelijkheden

- **Eén gecombineerde editor** met een pill-schakelaar tussen **Opmaak** (Markdown-bron) en **Live** (WYSIWYG)
- **Volledige opmaakwerkbalk**: koppen, vet, cursief, doorhalen, lijsten, taken, citaten, tabellen, links, afbeeldingen, code(blokken) met syntaxkleuring
- **Automatisch opslaan** (dynamisch, zoals Google Docs) zodra het bestand een locatie heeft
- **Live herladen**: wijzigt een ander programma het geopende bestand, dan laadt de app direct de nieuwste versie
- **Licht, donker en automatisch thema** (volgt Windows)
- Recente bestanden, slepen-en-neerzetten, sneltoetsen (Ctrl+N/O/S, Ctrl+Shift+S, Ctrl+E wisselt weergave)

## Ontwikkelen

```bash
npm install   # installeert dependencies en bouwt de editorbundel
npm start     # start de app
```

## Uitleveren (.exe)

```bash
npm run dist
```

Dit bouwt twee bestanden in `dist/`:

- **`Rendl-Portable-<versie>.exe`** — portable: geen installatie nodig, direct te starten (ook vanaf een USB-stick)
- **`Rendl-Setup-<versie>.exe`** — installer: installeert de app én koppelt `.md`, `.markdown` en `.mdown` aan Rendl, zodat dubbelklikken op een Markdown-bestand de app opent

## Structuur

- `main.js` — Electron-hoofdproces (vensters, dialogen, bestands-I/O, file watcher)
- `preload.js` — veilige brug tussen hoofdproces en UI
- `renderer/` — de interface (HTML/CSS/JS, Toast UI Editor gebundeld via esbuild)
- `locales/nl.json` — alle teksten in de app; voeg een extra taal toe door een nieuw bestand naast dit bestand te leggen
- `build/editor-entry.js` — entry voor de gebundelde editor (`npm run build:editor`)

Alle code is Engelstalig; alle zichtbare teksten komen uit `locales/`.
