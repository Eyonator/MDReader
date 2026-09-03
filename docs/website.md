# Rendl-website — plan & documentatie

> Status: **documentatie, er wordt nog niets gebouwd.**
> Doel: één centrale plek voor alles wat de website straks moet worden en doen.
> Besluitenronde 2026-09-04: domein, repo, prijsmodel, PSP, modules, platforms en activatiebeleid vastgelegd (zie "Besluiten").

## Doel van de site

Een **one-pager** die Rendl presenteert en distribueert:

1. Rendl laten zien (merk, tagline, screenshots) en de download aanbieden.
2. **De updatefeed voor de app serveren** — dit wordt essentieel zodra de GitHub-repo weer privé is: de ingebouwde updater kan dan niet meer bij GitHub en móét via de site (zie "Updatefeed" hieronder).
3. **Rendl Pro verkopen** — abonnement via Stripe, met klantaccount en licentiedashboard (zie "Licenties").
4. Later uitbreidbaar met downloadstatistieken, blog en nieuwsbrief.

## Besluiten (2026-09-04)

| Vraag | Besluit |
| ----- | ------- |
| Domeinnaam | **rendl.app** — beschikbaarheid/prijs nog checken vóór vastleggen |
| Website-repo | **rendl-site** (eigen privé repo, Fundament als submodule) |
| Prijsvorm | **Abonnement** (bedrag en interval nog open) |
| PSP | **Stripe** (Checkout + Billing + customer portal + webhooks) |
| Pro-features | **Export (PDF/HTML/Word)** en **synchronisatie**; lijst blijft open voor meer. Tabs/split view zijn sinds v1.3.0 gratis uitgebracht en gaan niet met terugwerkende kracht achter de betaalmuur. |
| Platforms | Nu alleen Windows. macOS/Linux zijn eenvoudig te builden maar kosten extra aan GitHub-runners; **we builden die zodra de site live is, op teken van de eigenaar.** |
| Fundament-modules | **cms** (inline teksten one-pager) + **blog/nieuwsbrief** |
| Activaties | **Maximaal 5 apparaten** per licentie, gebonden aan machine-kenmerk. Klant kan in zijn dashboard een activatie **intrekken** en speelt zo een slot vrij; de ingetrokken machine verloopt direct (zie licentie-ontwerp). |

## Stack

| Onderdeel | Keuze |
| --------- | ----- |
| Server | PHP (one-pager, server-side rendering) |
| Database | MySQL (downloadteller, licenties, nieuwsbrief) |
| Hosting/beheer | DirectAdmin |
| Basis | **Fundament** — https://github.com/Eyonator/Fundament |
| Betalingen | **Stripe** |

### Fundament als basis (repo ingezien op 2026-09-03)

Fundament is de herbruikbare projectbasis van HTM: accounts (2FA, passkeys), beheer-shell met rollen, migraties, mail, versleuteling op rust, juridische teksten + cookiewall, en aanzetbare modules (cms met inline bewerken, mediabibliotheek, blog, webshop, mail). Vereist PHP 8.1+ en MySQL (utf8mb4).

Zo start het websiteproject straks (samengevat uit `START.md` van Fundament — dat document is bij de bouw leidend, stap voor stap):

1. **Eigen, nieuwe, privé repo** voor de website: **rendl-site** (nooit bouwen in de Fundament-repo zelf); Fundament hangt erin als **git-submodule** op `app/Fundament`, vastgezet op de nieuwste release-tag.
2. `skelet/` eenmalig naar de projectroot kopiëren (daarna projectbezit): `public_html/`, `app/` (bootstrap, routes, functions, config, views), `dev-router.php`, `cron/`, `dev/update-fundament.sh`.
3. `secret/.env` invullen: `APP_KEY`, `ADMIN_KEY`, `KOPPEL_KEY`, `DB_*`, `APP_URL`; database utf8mb4 + `schema/001-fundament.sql`.
4. Smoke draaien (`dev/check-fundament.sh`) tot **ALLES GROEN**, daarna schoon opleveren volgens START.md §3.
5. Werkwijze-structuur aanleggen (CLAUDE.md, HANDOFF.md, CHANGELOG.md, todo.md, leergeld.md — het Sinius-model).

Belangrijke Fundament-regels voor dit project:

* **Fundamentgrens**: nooit iets wijzigen in `app/Fundament/`; uitbreiden via registers en de view-/config-cascade.
* **DirectAdmin zonder terminal**: het skelet bevat een browser-installer (`public_html/install.php`) die schema-import en migraties in de browser doet — precies passend bij de DirectAdmin-stack.
* De **cms-module** (inline bewerken op de pagina) maakt de teksten van de one-pager beheerbaar zonder maatwerk; **blog/nieuwsbrief** gaan ook aan.
* De **accountlaag** van Fundament (2FA, passkeys) draagt straks de klantaccounts voor het licentiedashboard.
* Het `update.json`-endpoint wordt een kleine eigen route in `routes.php` van het project (of een statisch bestand in `public_html/`).
* Komt het design als apart HTML/CSS/JS-pakket, dan is `app/Fundament/design.md` het contract daarvoor.

## Updatefeed (integratie met de app)

De app checkt bij elke start een JSON-feed. Nu is dat de GitHub-API; de site neemt dit over door **hetzelfde JSON-formaat** te serveren, dan hoeft er in de app alleen een URL te wijzigen (constante `UPDATE_REPO`/feed-URL in `main.js`; tijdelijk overschrijfbaar via env `RENDL_UPDATE_FEED`).

Endpoint, bijvoorbeeld `https://rendl.app/api/update.json`:

```json
{
  "tag_name": "v1.0.4",
  "html_url": "https://rendl.app/#download",
  "assets": [
    {
      "name": "Rendl-1.0.4-win.exe",
      "browser_download_url": "https://rendl.app/downloads/Rendl-1.0.4-win.exe"
    }
  ]
}
```

Regels waar de app op rekent:

* `tag_name`: versienummer met of zonder `v`-prefix (semver, drie delen).
* `assets[].name`: exact `Rendl-<versie>-win.exe` — daarop matcht de app.
* `browser_download_url`: direct downloadbare URL (geen loginmuur/redirectpagina).
* De app toont de updateknop **alleen** als het Windows-asset aanwezig is; zet het JSON dus pas online nadat de .exe in `/downloads/` staat.
* PHP-kant: statisch JSON-bestand volstaat; een MySQL-tabel met releases kan later, maar is geen vereiste.
* **Updates blijven voor iedereen gratis** — de feed blijft open, ook voor niet-Pro-gebruikers.

## Distributie / release-flow (na privé-gaan van de repo)

1. Release bouwen: CI (Windows-only workflow) bouwt `Rendl-<v>-win.exe` bij het pushen van een `v*`-tag, of lokaal via `npm run dist`.
2. De .exe uploaden naar de site (`/downloads/`).
3. `update.json` bijwerken naar de nieuwe versie.
4. Bestaande installaties zien de update bij hun volgende start.

macOS/Linux: technisch simpel toe te voegen aan de CI, maar de runners kosten extra. **Afspraak: die builds gaan pas aan zodra de site live is, op teken van de eigenaar**; de site noemt tot die tijd alleen Windows.

## One-pager: structuur

1. **Hero** — Rendl-merk (ribbon-r), naam, tagline *"Write plain. Read beautifully."* (NL: schrijf kaal, lees prachtig), grote downloadknop.
2. **Features** — drie of vier blokken: liquid-glass editor (Opmaak/Live), autosave zoals Google Docs, live-reload, persistente undo, sleepbare tabs/split view.
3. **Screenshot(s)** — licht + donker thema.
4. **AI-agent-skill** — Rendl als weergavevenster voor code-assistenten.
5. **Download** — knop naar de .exe, versienummer, systeemeis (Windows 10+), vermelding portable + in-app installatie.
6. **Pro** — koopsectie: gratis vs Pro naast elkaar, abonnementsknop naar Stripe Checkout, login-link naar het klantdashboard.
7. **Footer** — versie, contact, link naar broncode-beleid (repo is privé), login.

## Merk

Alles staat in `docs/brand/BRAND.md`: palet (licht `#EEF1F6`/accent `#007AFF`, donker `#0D1015`/accent `#0A84FF`), typografie (Segoe UI Variable-stack), iconen en logo's (`docs/brand/*.svg`). De site volgt het liquid-glass-gevoel van de app: rustige gradiënten, glaspanelen, veel lucht.

## Licenties (Rendl Pro, abonnement)

Rendl is freemium: de kern blijft gratis, **Rendl Pro** is een abonnement dat extra functies ontgrendelt.

### Model

* **Gratis**: de volledige editor zoals hij nu is (schrijven, lezen, autosave, live-reload, undo-historie, tabs/split view, agent-skill). Wat eenmaal gratis is uitgebracht blijft gratis.
* **Pro (abonnement)**: **export (PDF/HTML/Word)** en **synchronisatie**; de lijst blijft open voor toekomstige Pro-features. Sync rechtvaardigt het abonnement: er lopen doorlopende serverkosten.
* **Updates blijven voor iedereen gratis** (de updatefeed blijft open); Pro ontgrendelt functies, geen updates.
* **Maximaal 5 apparaten** per licentie. De klant beheert zijn apparaten zelf in het dashboard en kan een activatie intrekken om een slot vrij te spelen.

### Architectuur in één oog­opslag

Omdat Pro een abonnement is, is een eenmalige offline code niet genoeg: de licentie moet kunnen **verlopen** (abonnement gestopt) en **per apparaat ingetrokken** kunnen worden. Het ontwerp scheidt daarom drie dingen:

1. **De licentiecode** — `RENDL-XXXXX-XXXXX-XXXXX-XXXXX` (Crockford base32, geen verwarrende tekens als `0/O` en `1/I`). Dit is de **activatiesleutel** die de app aan het abonnement koppelt: makkelijk voor te lezen en te typen, maar op zichzelf géén bewijs van een geldig abonnement.
2. **Het apparaat-token** — een door de server uitgegeven, **Ed25519-ondertekend** token per geactiveerd apparaat, met daarin: licentie-id, machine-kenmerk (hash), productvlag (pro), uitgifte- en **vervaldatum**. De app bundelt alleen de *publieke* sleutel en valideert het token dus zonder internet; de *private* sleutel bestaat uitsluitend op de server. Nep-tokens maken is onmogelijk zonder de private sleutel.
3. **De abonnementsstatus bij Stripe** — de bron van waarheid. Webhooks houden de MySQL-kant bij; tokens worden alleen uitgegeven/ververst zolang het abonnement loopt.

### Flow

**Kopen** — klant klikt "Upgrade naar Pro" op de site → Stripe Checkout → webhook `checkout.session.completed` maakt (of koppelt aan) een klantaccount, legt het abonnement vast en genereert de licentiecode → code direct tonen + mailen (mailverzending zit in Fundament).

**Activeren** — klant voert de code in de app in → app stuurt `code + machine-kenmerk` naar `POST https://rendl.app/api/activate` → server controleert: code geldig, abonnement actief, minder dan 5 actieve activaties → geeft een ondertekend apparaat-token terug. Zit het vol, dan meldt de foutmelding dat er in het dashboard een apparaat vrijgemaakt kan worden.

**Verversen** — het token heeft een korte houdbaarheid: **vervaldatum = min(einde huidige abonnementsperiode + 7 dagen coulance, uitgifte + 30 dagen)**. De app ververst stil op de achtergrond via `POST /api/refresh` (code + machine-kenmerk) — bij elke start als er internet is, en sowieso ruim vóór de vervaldatum. De server werkt daarbij `last_seen` van de activatie bij.

**Offline** — een geldig token werkt volledig offline tot zijn vervaldatum; de app blokkeert **nooit hard op een netwerkfout**. Pas als het token echt verlopen is én verversen niet lukt, vallen de Pro-features terug naar gratis (met vriendelijke melding, geen dataverlies).

**Intrekken** — klant trekt in zijn dashboard een apparaat in → server markeert de activatie als ingetrokken en het slot komt vrij. De ingetrokken machine merkt dat bij het **eerstvolgende online contact** (start of refresh): de server weigert het verversen en de app wist het lokale token direct. Blijft de machine offline, dan is de korte tokenhoudbaarheid (max 30 dagen) de harde bovengrens — "direct" betekent dus: direct bij het eerste contact, met de vervaldatum als vangnet.

**Opzeggen** — abonnement stopt (webhook `customer.subscription.deleted` / mislukte incasso na de Stripe-retrycyclus) → geen nieuwe tokens meer; bestaande tokens lopen af op einde periode + 7 dagen coulance. Heractiveren via het Stripe customer portal herstelt alles zonder nieuwe code.

### Machine-kenmerk

* Stabiel per installatie/machine (Windows: `MachineGuid`, via bijv. `node-machine-id`), **gehasht** vóór verzending — de server ziet nooit het rauwe kenmerk.
* De app stuurt bij activatie ook een leesbaar label mee (hostnaam + OS, bijv. "DESKTOP-VVS · Windows 11") zodat het dashboard herkenbare apparaten toont; de klant kan het label wijzigen.

### Website-kant

* **Koopsectie** op de one-pager (tussen Download en Footer): gratis vs Pro, prijs, knop naar Stripe Checkout.
* **Klantdashboard** (achter Fundament-login): abonnementsstatus, licentiecode (eenmalig tonen/opnieuw mailen), apparatenlijst (label, OS, laatst gezien, knop **Intrekken**), link naar het Stripe customer portal (betaalmethode, opzeggen, facturen).
* **API-routes** in `routes.php`: `POST /api/activate`, `POST /api/refresh`, `POST /api/stripe-webhook` (met signature-verificatie).
* **MySQL-tabellen** (persoonsgegevens per Fundament-regel versleuteld op rust, `VARBINARY`/`BLOB`):
    * `subscriptions` — account-id, Stripe customer-id, Stripe subscription-id, status, einde-huidige-periode, aangemaakt-op.
    * `licenses` — id, subscription-id, `code_hash` (nooit de code zelf opslaan), status (actief/ingetrokken), aangemaakt-op.
    * `activations` — `license_id`, machine-hash, label, geactiveerd-op, laatst-gezien, ingetrokken-op (NULL = actief).
* **Beheer** (Fundament-beheershell): licenties inzien, intrekken, heruitgeven; activaties inzien; webhook-log.
* **Sleutelbeheer**: het Ed25519-sleutelpaar wordt eenmalig gegenereerd; de private sleutel staat uitsluitend in `secret/` op de server (nooit in git), de publieke sleutel wordt in de app gebundeld.

### App-kant (te bouwen in de app-repo, niet op de site)

* Invoerveld voor de licentiecode (instellingen/menu) met duidelijke foutteksten via `locales/nl.json` (code ongeldig, abonnement verlopen, apparatenlimiet bereikt → verwijs naar dashboard).
* Opslag van het apparaat-token lokaal en versleuteld; validatie met de gebundelde publieke sleutel; stille refresh bij start en vóór de vervaldatum.
* Feature-gates checken één centrale licentiestatus (`isPro()`); nooit her en der losse checks.
* "Upgrade naar Pro"-link opent de website; "Beheer apparaten" opent het dashboard.
* Verloopt de licentie: vriendelijke melding, Pro-features uit, nooit dataverlies of harde blokkade.

## MySQL (minimaal beginnen)

* `downloads` — teller per versie (datum, versie, aantal).
* De licentietabellen hierboven (`subscriptions`, `licenses`, `activations`).
* Nieuwsbrief-/blogtabellen komen uit de Fundament-modules zelf.

## Open vragen

* [ ] **rendl.app**: beschikbaarheid en prijs checken, dan vastleggen.
* [ ] Prijs van het abonnement: bedrag en interval (maand/jaar, of beide met jaarkorting)?
* [ ] DirectAdmin-omgeving: PHP-versie (8.1+ vereist), SSL, deploy-methode.
* [ ] Definitieve Pro-featurelijst: export + sync staan vast; wat nog meer?
* [ ] Sync-ontwerp: wat syncen we precies (instellingen, documenten?) en waar staat de data — eigen server of koppeling met een dienst? (Groot genoeg voor een eigen werkdocument zodra dit speelt.)
* [ ] Stripe: alleen kaart/iDEAL via Checkout, of ook andere betaalmethodes aanzetten?
