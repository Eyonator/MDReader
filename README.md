# MD Lezer

Een kleine, moderne Windows-app om Markdown-bestanden te schrijven én te lezen, met een "liquid glass"-interface.

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

## Structuur

- `main.js` — Electron-hoofdproces (vensters, dialogen, bestands-I/O, file watcher)
- `preload.js` — veilige brug tussen hoofdproces en UI
- `renderer/` — de interface (HTML/CSS/JS, Toast UI Editor gebundeld via esbuild)
- `locales/nl.json` — alle teksten in de app; voeg een extra taal toe door een nieuw bestand naast dit bestand te leggen
- `build/editor-entry.js` — entry voor de gebundelde editor (`npm run build:editor`)

Alle code is Engelstalig; alle zichtbare teksten komen uit `locales/`.
