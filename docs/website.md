# Rendl-website — plan & documentatie

> Status: **documentatie, er wordt nog niets gebouwd.**
> Doel: één centrale plek voor alles wat de website straks moet worden en doen.

## Doel van de site

Een **one-pager** die Rendl presenteert en distribueert:

1. Rendl laten zien (merk, tagline, screenshots) en de download aanbieden.
2. **De updatefeed voor de app serveren** — dit wordt essentieel zodra de
   GitHub-repo weer privé is: de ingebouwde updater kan dan niet meer bij
   GitHub en móét via de site (zie "Updatefeed" hieronder).
3. Later uitbreidbaar met downloadstatistieken en een nieuwsbrief.

## Stack

| Onderdeel | Keuze |
|---|---|
| Server | PHP (one-pager, server-side rendering) |
| Database | MySQL (downloadteller, later nieuwsbrief) |
| Hosting/beheer | DirectAdmin |
| Basis | **Fundament** — https://github.com/Eyonator/Fundament |

### Fundament als basis (repo ingezien op 2026-09-03)

Fundament is de herbruikbare projectbasis van HTM: accounts (2FA,
passkeys), beheer-shell met rollen, migraties, mail, versleuteling op
rust, juridische teksten + cookiewall, en aanzetbare modules (cms met
inline bewerken, mediabibliotheek, blog, webshop, mail). Vereist PHP 8.1+
en MySQL (utf8mb4).

Zo start het websiteproject straks (samengevat uit `START.md` van
Fundament — dat document is bij de bouw leidend, stap voor stap):

1. **Eigen, nieuwe, privé repo** voor de website (nooit bouwen in de
   Fundament-repo zelf); Fundament hangt erin als **git-submodule** op
   `app/Fundament`, vastgezet op de nieuwste release-tag.
2. `skelet/` eenmalig naar de projectroot kopiëren (daarna projectbezit):
   `public_html/`, `app/` (bootstrap, routes, functions, config, views),
   `dev-router.php`, `cron/`, `dev/update-fundament.sh`.
3. `secret/.env` invullen: `APP_KEY`, `ADMIN_KEY`, `KOPPEL_KEY`, `DB_*`,
   `APP_URL`; database utf8mb4 + `schema/001-fundament.sql`.
4. Smoke draaien (`dev/check-fundament.sh`) tot **ALLES GROEN**, daarna
   schoon opleveren volgens START.md §3.
5. Werkwijze-structuur aanleggen (CLAUDE.md, HANDOFF.md, CHANGELOG.md,
   todo.md, leergeld.md — het Sinius-model).

Belangrijke Fundament-regels voor dit project:

- **Fundamentgrens**: nooit iets wijzigen in `app/Fundament/`; uitbreiden
  via registers en de view-/config-cascade.
- **DirectAdmin zonder terminal**: het skelet bevat een browser-installer
  (`public_html/install.php`) die schema-import en migraties in de
  browser doet — precies passend bij de DirectAdmin-stack.
- De **cms-module** (inline bewerken op de pagina) kan de teksten van de
  one-pager beheerbaar maken zonder maatwerk.
- Het `update.json`-endpoint wordt een kleine eigen route in `routes.php`
  van het project (of een statisch bestand in `public_html/`).
- Komt het design als apart HTML/CSS/JS-pakket, dan is
  `app/Fundament/design.md` het contract daarvoor.

## Updatefeed (integratie met de app)

De app checkt bij elke start een JSON-feed. Nu is dat de GitHub-API; de
site neemt dit over door **hetzelfde JSON-formaat** te serveren, dan hoeft
er in de app alleen een URL te wijzigen (constante `UPDATE_REPO`/feed-URL
in `main.js`; tijdelijk overschrijfbaar via env `RENDL_UPDATE_FEED`).

Endpoint, bijvoorbeeld `https://<domein>/api/update.json`:

```json
{
  "tag_name": "v1.0.4",
  "html_url": "https://<domein>/#download",
  "assets": [
    {
      "name": "Rendl-1.0.4-win.exe",
      "browser_download_url": "https://<domein>/downloads/Rendl-1.0.4-win.exe"
    }
  ]
}
```

Regels waar de app op rekent:

- `tag_name`: versienummer met of zonder `v`-prefix (semver, drie delen).
- `assets[].name`: exact `Rendl-<versie>-win.exe` — daarop matcht de app.
- `browser_download_url`: direct downloadbare URL (geen loginmuur/redirectpagina).
- De app toont de updateknop **alleen** als het Windows-asset aanwezig is;
  zet het JSON dus pas online nadat de .exe in `/downloads/` staat.
- PHP-kant: statisch JSON-bestand volstaat; een MySQL-tabel met releases
  kan later, maar is geen vereiste.

## Distributie / release-flow (na privé-gaan van de repo)

1. Release bouwen: CI (Windows-only workflow) bouwt `Rendl-<v>-win.exe`
   bij het pushen van een `v*`-tag, of lokaal via `npm run dist`.
2. De .exe uploaden naar de site (`/downloads/`).
3. `update.json` bijwerken naar de nieuwe versie.
4. Bestaande installaties zien de update bij hun volgende start.

## One-pager: structuur

1. **Hero** — Rendl-merk (ribbon-r), naam, tagline *"Write plain. Read
   beautifully."* (NL: schrijf kaal, lees prachtig), grote downloadknop.
2. **Features** — drie of vier blokken: liquid-glass editor (Opmaak/Live),
   autosave zoals Google Docs, live-reload, persistente undo.
3. **Screenshot(s)** — licht + donker thema.
4. **AI-agent-skill** — Rendl als weergavevenster voor code-assistenten.
5. **Download** — knop naar de .exe, versienummer, systeemeis (Windows 10+),
   vermelding portable + in-app installatie.
6. **Footer** — versie, contact, link naar broncode-beleid (repo is privé).

## Merk

Alles staat in `docs/brand/BRAND.md`: palet (licht `#EEF1F6`/accent
`#007AFF`, donker `#0D1015`/accent `#0A84FF`), typografie (Segoe UI
Variable-stack), iconen en logo's (`docs/brand/*.svg`). De site volgt het
liquid-glass-gevoel van de app: rustige gradiënten, glaspanelen, veel lucht.

## MySQL (minimaal beginnen)

- `downloads` — teller per versie (datum, versie, aantal). Meer niet, tot
  er een echte behoefte is.

## Open vragen

- [ ] Domeinnaam?
- [ ] Naam van de nieuwe website-repo (eigen privé repo, per Fundament-regel)
- [ ] DirectAdmin-omgeving: PHP-versie (8.1+ vereist), SSL, deploy-methode
- [ ] Moet de site ook de macOS/Linux-builds noemen? (CI bouwt nu alleen
  Windows; mac/linux vereisen opnieuw runners of een build-machine)
- [ ] Welke Fundament-modules aan: alleen cms, of ook blog/nieuwsbrief?
