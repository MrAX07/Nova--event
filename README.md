# 🎁 Nova Giveaway og Event Bot  ·  Nova Events Kontrolpanel

En komplet Discord-bot til **giveaways, talevents, entries, vindere, tickets, statistik og logs** – med et moderne, mobilvenligt kontrolpanel i rød/sort. Alt er på dansk.

> **Vigtigt:** Der er **intet køb, ingen betaling, ingen shop og ingen entries for rigtige penge**. Entries optjenes kun ved at deltage i et giveaway, eller de rettes manuelt af en **Højadmin/Ejer** – og hver ændring logges.

---

## Indhold

1. [Hvad kan den?](#hvad-kan-den)
2. [Sådan hænger projektet sammen](#sådan-hænger-projektet-sammen)
3. [Kommandoer](#kommandoer)
4. [Rettighedsniveauer](#rettighedsniveauer)
5. [Logs: kanaler og kategorier](#logs-kanaler-og-kategorier)
6. [Tickets](#tickets)
7. [Konfiguration](#konfiguration)
8. [Miljøvariabler (.env)](#miljøvariabler-env)
9. [Fejlfinding](#fejlfinding)
10. [Opdatering, backup og gendannelse](#opdatering-backup-og-gendannelse)
11. [**TRIN-FOR-TRIN: Sådan får du Nova Giveaway og Event Bot online**](#trin-for-trin-sådan-får-du-nova-giveaway-og-event-bot-online)

---

## Hvad kan den?

**Giveaways** – start, afslut, annuller, pause, genoptag, reroll, rediger, list, info, preview, planlagte giveaways (serverens tidszone), skabeloner, egne embeds (titel, tekst, footer, thumbnail, billede, farve, knaptekst, knap-emoji, vinderbesked), krav (roller, blokerede roller, kontoalder, tid på serveren, antal beskeder, stemmekanal), bonus-entries for roller, maks. entries pr. bruger, blacklist (global og pr. giveaway), vinder-verificering (forlod serveren? mistet rolle? blacklistet? → ny vinder trækkes automatisk og den afviste logges), vinder-DM, vinderrolle, "slutter snart"-beskeder (5 min / 1 min / 30 sek – kan ændres), testtilstand.

**Talevents** – skjult tal. Den første der skriver det **præcise** tal vinder (`7384abc` og `17384` tæller ikke, bots ignoreres). Vinderen vælges **atomisk i databasen**, så to personer aldrig begge kan vinde samme plads. Tilfældigt tal (min/max) eller selvvalgt tal (via privat formular), flere vindere med forskellig præmie pr. plads, hints (tid, interval, antal), valgfri ⬆️ højere / ⬇️ lavere, stop, reroll (genåbner pladsen), status og historik.

**Entries** – `/entries add|remove|set|check` kun for Højadmin/Ejer, med bekræftelse på farlige handlinger og fuld auditlog (admin, bruger, før, efter, forskel, giveaway-ID, årsag, tidspunkt).

**Tickets** – support-tickets og præmie-/event-ansvarlig-tickets med vinder-tjek, overtag, tilføj/fjern bruger og automatisk samtale-udskrift i loggen.

**Statistik og ranglister** – `/userstats`, `/leaderboard` (flest sejre / entries / talevent-sejre / deltagelser), `/stats`.

**Kontrolpanel** – Discord-login, overblik med grafer, giveaways, talevents, entries, brugere, vindere, tickets, logs, statistik, skabeloner, rettigheder, indstillinger, CSV-eksport, søgning og filtre, bekræftelsesdialoger, mørk/lys tilstand og mobilvenligt design.

**Robust** – alle timere ligger i **databasen**. Genstarter botten, fortsætter aktive, pausede og planlagte giveaways og talevents automatisk.

---

## Sådan hænger projektet sammen

Botten og kontrolpanelet kører i **én og samme proces** (én tjeneste at hoste, ét sted at sætte miljøvariabler).

```
nova-events/
├── prisma/schema.prisma      ← databasen (tabeller)
├── public/                   ← kontrolpanelets forside (HTML/CSS/JS + logo)
├── src/
│   ├── index.ts              ← starter bot + kontrolpanel
│   ├── bot/                  ← slash-kommandoer, events, knapper, formularer
│   │   └── commands/         ← giveaway, entries, numberevent, ticket, config, setup …
│   ├── services/             ← al forretningslogik (delt af bot og kontrolpanel)
│   ├── web/                  ← Express-server, Discord OAuth2, API, CSV
│   └── shared/               ← rettigheder, tid, tekster
├── Dockerfile · render.yaml · ecosystem.config.cjs
├── scripts/backup.sh · scripts/restore.sh
└── .env.example
```

Rettigheder tjekkes **altid på serveren** (både i bot og API) – aldrig kun i kontrolpanelet. `DISCORD_TOKEN`, `DATABASE_URL` og `CLIENT_SECRET` sendes aldrig til browseren.

---

## Kommandoer

| Kommando | Hvad den gør | Mindste niveau |
|---|---|---|
| `/setup` | Guidet opsætning i 12 trin | Højadmin (Discord-administrator før første opsætning) |
| `/config view/channel/logchannel/logs/rolelogs/role/winnerrole/timezone/testmode/defaults/endingsoon/message/ticket/dashboard` | Skift indstillinger | Højadmin (`role`: Ejer) |
| `/giveaway start` | Start et giveaway | Eventansvarlig |
| `/giveaway schedule` | Planlæg et giveaway (`start: 18:00`) | Eventansvarlig |
| `/giveaway preview` | Se præcis hvordan det kommer til at se ud | Eventansvarlig |
| `/giveaway end / cancel / pause / resume` | Styr et giveaway | Eventansvarlig |
| `/giveaway edit / customize` | Rediger (inkl. formularer til udseende) | Højadmin |
| `/giveaway reroll` | Træk nye vindere / erstat en vinder | Højadmin |
| `/giveaway list / info` | Se giveaways | Moderator |
| `/giveaway template create / list / delete` | Skabeloner (`/giveaway start skabelon:VIP`) | Højadmin (list: Eventansvarlig) |
| `/numberevent start / stop` | Start/stop talevent | Eventansvarlig |
| `/numberevent reroll` | Diskvalificér vinder og genåbn | Højadmin |
| `/numberevent status / history` | Se talevents (hemmeligt tal vises kun for Højadmin+) | Moderator |
| `/entries add / remove / set / check` | Ret entries manuelt | Højadmin |
| `/blacklist add / remove` · `check` | Blacklist | Højadmin · Moderator |
| `/event info / search` | Find gamle og nye events | Moderator |
| `/stats` | Serverstatistik | Moderator |
| `/userstats [bruger]` | Egen statistik (andre: Moderator) | Alle |
| `/leaderboard` | Ranglister | Alle |
| `/ticket panel / claim / close / add / remove / list` | Tickets | Panel: Højadmin · list: Moderator · resten: se [Tickets](#tickets) |

Tip: skriv `/giveaway start` og vælg valgene i Discord – de hedder på dansk (`praemie`, `varighed`, `vindere`, `kanal` …). Varighed skrives som `30m`, `2t`, `1d` eller `1d12h`.

---

## Rettighedsniveauer

| Niveau | Må |
|---|---|
| **Ejer** | Alt – også at ændre rettigheder. Serverens ejer er altid Ejer. |
| **Højadmin** | Ret entries (tilføj/fjern/sæt) · opret, rediger, afslut og reroll giveaways · styr talevents · se brugere · indstillinger · logs · CSV-eksport |
| **Eventansvarlig** | Opret giveaways · pause/genoptag/afslut · start og stop talevents · håndtér præmie-tickets. **Kan ikke ændre entries.** |
| **Moderator** | Se events, deltagere, vindere, tickets og grundlæggende statistik |
| **Bruger** | Deltag i giveaways · se egen statistik · deltag i talevents |

Rollerne sættes under `/setup`, `/config role` eller **Rettigheder** i kontrolpanelet. Eventansvarlige og moderatorer får **ikke** automatisk adgang til at ændre entries.

---

## Logs: kanaler og kategorier

Vælg en **log-kanal** (`/setup` trin 3, `/config channel`, eller Indstillinger i kontrolpanelet). Så logges *alt* dér. Vil du have mere orden, kan **hver kategori få sin egen kanal** med `/config logchannel`, og du kan slå kategorier til/fra med `/config logs`.

| Kategori | Hvad logges |
|---|---|
| **Giveaway-logs** | Oprettet, planlagt, startet, redigeret, afsluttet, annulleret, pauset, genoptaget, slettet, skabeloner |
| **Talevent-logs** | Startet, vundet, udløbet, stoppet, genåbnet (det hemmelige tal står *aldrig* i loggen) |
| **Entry-logs (manuelle)** | Tilføjet / fjernet / sat – admin, bruger, før, efter, forskel, giveaway-ID, årsag, tidspunkt |
| **Entry-logs (knap)** | Hver deltagelse via knappen. Slået **fra** som standard (mange beskeder) – slå til med `/config logs` |
| **Vinder-logs** | Vinder valgt, afvist, rerollet, DM fejlede |
| **Indstillings-logs** | Ændrede indstillinger (før/efter), testtilstand, skabeloner |
| **Admin-logs** | Roller givet/fjernet (vinderrolle + rettigheds-, krav- og bonusroller), rettighedsændringer, blacklist, CSV-eksport |
| **Ticket-logs** | Oprettet, overtaget, bruger tilføjet/fjernet, lukket **med samtale-udskrift som fil** |
| **Fejl-logs** | Alle fejl botten selv opdager (også gemt i databasen og i kontrolpanelet) |

Alt gemmes også i databasen og kan søges, filtreres og eksporteres under **Logs** i kontrolpanelet.

---

## Tickets

1. Sæt en kategori: `/config ticket kategori:#Tickets` (valgfrit: ekstra support-/præmie-roller).
2. Send panelet: `/ticket panel kanal:#hjælp`. Panelet har to knapper:
   - 🛠️ **Support** – emne + beskrivelse.
   - 🏆 **Præmie / Event-ansvarlig** – event-ID, præmie og ekstra info. Botten tjekker automatisk om brugeren er **registreret som vinder** af eventet (✅ verificeret / ⚠️ ikke registreret).
3. Hver ticket er en **privat kanal** kun for brugeren og staff. Staff kan **overtage** (🙋), `/ticket add|remove` brugere og **lukke** (🔒).
4. Ved lukning gemmes samtalen, sendes som tekstfil til **Ticket-logs** (og som kopi til brugeren i DM, hvis DM er åben), og kanalen slettes efter 8 sekunder.

Support-tickets kan håndteres af Moderator og op; præmie-tickets af Eventansvarlig og op (plus de roller du selv tilføjer). En bruger kan have 1 åben ticket pr. type og højst 3 i alt.

---

## Konfiguration

* **Første gang:** kør `/setup` – 12 trin (giveaway-kanal, talevent-kanal, log-kanal, roller, vinderrolle, tidszone, standarder, annonceringer, kontrolpanel).
* **Senere:** `/config …` eller **Indstillinger** i kontrolpanelet.
* **Annonceringer:** alle automatiske beskeder kan slås fra eller få ny tekst (`/config message` eller kontrolpanelet). Variabler: `{prize} {id} {winners} {ends} {host} {link} {number} {winner} {place}`.
* **Testtilstand:** `/config testmode aktiv:ja` eller `test:ja` på det enkelte event. Testevents tæller ikke i statistik, og der sendes ingen roller/DM'er – ellers virker alt som normalt.

---

## Miljøvariabler (.env)

| Variabel | Betydning | Hvor får du den? |
|---|---|---|
| `DISCORD_TOKEN` | Botten's hemmelige adgangskode | Developer Portal → **Bot** → *Reset Token* |
| `CLIENT_ID` | Applikationens ID | Developer Portal → **General Information** → *Application ID* |
| `CLIENT_SECRET` | Hemmelighed til Discord-login | Developer Portal → **OAuth2** → *Reset Secret* |
| `DATABASE_URL` | Adresse til PostgreSQL | Din database (se trin 9–10) |
| `DISCORD_REDIRECT_URI` | Hvor Discord sender folk hen efter login. **Skal ende på `/auth/callback`** og være identisk med den du tilføjer i Developer Portal | Fx `http://localhost:3000/auth/callback` eller `https://events.dit-domæne.dk/auth/callback` |
| `SESSION_SECRET` | Lang tilfældig tekst (mindst 32 tegn) | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PORT` | Port (hostingen sætter den ofte selv) | Valgfri, standard 3000 |
| `AUTO_REGISTER_COMMANDS` | Registrér slash-kommandoer ved hver start | Valgfri, standard `true` |

**Del aldrig `.env` eller `DISCORD_TOKEN` med nogen. Læg dem aldrig på GitHub.**

---

## Fejlfinding

| Problem | Løsning |
|---|---|
| Opstart siger `Missing environment variable: …` | Den variabel mangler i `.env` (eller i hostingens miljøvariabler). |
| `Used disallowed intents` | Slå **Server Members Intent** og **Message Content Intent** til i Developer Portal → Bot (trin 5), og start igen. |
| Slash-kommandoer vises ikke | Vent 1 minut, genstart Discord (Ctrl+R). Tjek at botten er inviteret med `applications.commands`. Kør `npm run commands:register`. |
| Talevent reagerer ikke på tal | Message Content Intent er ikke slået til, eller botten kan ikke se kanalen. |
| `Can't reach database server` | `DATABASE_URL` er forkert, eller databasen kører ikke. Tjek bruger/kodeord/port. |
| Tabeller findes ikke | Kør `npx prisma db push` (trin 14). |
| Login: `redirect_uri` ugyldig | `DISCORD_REDIRECT_URI` i `.env` og i Developer Portal → OAuth2 → Redirects skal være **bogstav-for-bogstav ens**. |
| "Ingen adgang" efter login | Du har ingen rolle med adgang. Ejeren af serveren kan køre `/setup` og sætte rollerne. |
| Vinderrolle gives ikke | Botten har ikke *Administrer roller*, eller botten's rolle ligger **under** vinderrollen. Træk botten's rolle op over den i Serverindstillinger → Roller. (Fejlen står i Admin-logs.) |
| Ticket kan ikke oprettes | Botten mangler *Administrer kanaler* (og kategorien skal være synlig for botten). |
| Botten går offline på hostingen | Du bruger en gratis plan der går i dvale. Vælg en altid-tændt plan. |
| Kontrolpanel viser ingen servere | Botten er ikke på serveren, eller du er ikke Moderator eller højere. |
| Intet i log-kanalen | Sæt en log-kanal, og tjek at botten kan skrive der. Kategorien må ikke være slået fra (`/config view`). |

Fejl logges i konsollen, i databasen (tabellen `ErrorLog`), i **Fejl-logs** i Discord og under **Logs → Fejl-logs** i kontrolpanelet. Hemmeligheder vises aldrig.

---

## Opdatering, backup og gendannelse

**Opdatér** (efter du har fået nye filer): `npm install` → `npm run build` → `npx prisma db push` → genstart (`pm2 restart nova-events` eller "Manual Deploy" på Render).

**Backup:** `bash scripts/backup.sh` (kræver `pg_dump`; på Windows se trin 28).
**Gendan:** `bash scripts/restore.sh backups/filnavn.sql`.

Tag backup **før** hver opdatering og mindst en gang om ugen.

---

# TRIN-FOR-TRIN: Sådan får du Nova Giveaway og Event Bot online

Skrevet til dig der aldrig har hostet en Discord-bot før. Følg trinnene i rækkefølge. Alt hvad du skal skrive i en terminal står i en grå boks – kopiér det præcis.

> 🧭 **Overblik:** Du skal (A) lave en bot hos Discord, (B) have en database, (C) få projektet til at køre på din egen computer, (D) lægge det på en hosting så det kører 24/7.
> **Der er kun ÉN mappe/tjeneste at uploade** – hele projektmappen. Botten og kontrolpanelet kører sammen, og databasen er en separat tjeneste.

## Del A – Discord

### 1. Hvilken software skal installeres?
* **Node.js** (version 20 eller nyere) – kører botten.
* **PostgreSQL** – kun hvis du vil teste på din egen computer (på hostingen får du en database for dig).
* **Git** (valgfri) – gør opdateringer lettere.
* En teksteditor, fx **Visual Studio Code**.

### 2. Hvor henter jeg Node.js?
Gå til **https://nodejs.org**, klik på den grønne knap **LTS**, og installér (klik Næste hele vejen). Åbn derefter en terminal (Windows: søg efter **PowerShell**; Mac: **Terminal**) og skriv:

```bash
node -v
```

Du skal se noget i retning af `v22.x.x`. Er det 20 eller højere, er du klar.

### 3. Opret Discord-applikationen
1. Gå til **https://discord.com/developers/applications** og log ind.
2. Klik **New Application** (øverst til højre).
3. Skriv navnet **Nova Events**, sæt flueben i vilkårene, klik **Create**.
4. Du er nu på **General Information**. Klik på det lille billede/ikon og **upload dit logo** (det røde N med festhat – filen ligger i `public/logo.png`).
5. **Kopiér "Application ID"** → det er din `CLIENT_ID`. Gem det i en tekstfil.

### 4. Opret botten og hent token
1. Klik **Bot** i menuen til venstre.
2. Klik **Reset Token** → **Yes, do it!** → bekræft evt. med kodeord/2FA.
3. Klik **Copy**. Det er din `DISCORD_TOKEN`. **Gem den med det samme** (den vises kun én gang) og vis den aldrig til nogen.
4. Under **Bot** kan du også slå **Public Bot** fra, hvis kun du skal kunne invitere den.

### 5. Slå de nødvendige intents til
Stadig under **Bot**, scroll ned til **Privileged Gateway Intents** og slå **TIL**:

* ✅ **Server Members Intent** (roller, medlemsalder, vinder-tjek)
* ✅ **Message Content Intent** (talevents og "minimum beskeder")
* (Presence Intent skal **ikke** slås til.)

Klik **Save Changes**.

### 6. Invitér botten til din server
1. Klik **OAuth2** i menuen.
2. Find **OAuth2 URL Generator** (nederst).
3. Under *Scopes* sæt flueben i **bot** og **applications.commands**.
4. Under *Bot Permissions* vælg disse (se trin 7).
5. Kopiér den URL der dukker op nederst, åbn den i din browser, vælg din server og klik **Godkend**.

**Genvej:** erstat `DIT_CLIENT_ID` og åbn linket – det har alle tilladelserne:

```
https://discord.com/oauth2/authorize?client_id=DIT_CLIENT_ID&scope=bot%20applications.commands&permissions=268561424
```

### 7. Hvilke tilladelser skal botten have?
* View Channels (Se kanaler)
* Send Messages (Send beskeder)
* Embed Links (Indlejr links)
* Attach Files (Vedhæft filer – ticket-udskrifter)
* Read Message History (Læs beskedhistorik)
* Manage Messages (Administrer beskeder – sletter giveaway-besked ved sletning)
* Manage Roles (Administrer roller – vinderrolle og ticket-adgang)
* Manage Channels (Administrer kanaler – opretter ticket-kanaler)

⚠️ **Rolle-rækkefølge:** Gå i Discord til *Serverindstillinger → Roller* og træk botten's rolle **højere op** end vinderrollen og de roller den skal give.

### 8. Opret OAuth2 (login til kontrolpanelet)
1. Developer Portal → **OAuth2** → under **Client information** klik **Reset Secret** → **Copy**. Det er din `CLIENT_SECRET`. Gem den.
2. Samme side, **Redirects** → klik **Add Redirect**.
3. Skriv: `http://localhost:3000/auth/callback` og klik **Save Changes**.
   *(Når du senere går online, tilføjer du også din rigtige adresse – se trin 19.)*

## Del B – Din computer

### 9. Opret PostgreSQL-databasen (lokalt)
1. Download **PostgreSQL** fra **https://www.postgresql.org/download/** og installér. Vælg et kodeord til brugeren `postgres` – **husk det**. Behold port **5432**.
2. Åbn programmet **pgAdmin** (følger med) → højreklik på **Databases** → **Create → Database…** → navn: `nova_events` → **Save**.

*(Foretrækker du at springe lokal installation over, kan du gå direkte til Del C – hostingen laver databasen for dig, og du kan teste direkte dér.)*

### 10. Hvor skal databaseforbindelsen stå?
I filen `.env` (trin 11) på linjen `DATABASE_URL=`. Format:

```
postgresql://postgres:DITKODEORD@localhost:5432/nova_events
```

Indeholder dit kodeord specialtegn (`@`, `#`, `/`), så skriv dem URL-kodet (`@` = `%40`, `#` = `%23`, `/` = `%2F`).

### 11. Konfigurér `.env`
1. Åbn projektmappen `nova-events` i **Visual Studio Code** (*File → Open Folder*).
2. Højreklik på **`.env.example`** → **Copy**, og indsæt → omdøb kopien til **`.env`**.
3. Udfyld:
   * `DISCORD_TOKEN=` → token fra trin 4
   * `CLIENT_ID=` → fra trin 3
   * `CLIENT_SECRET=` → fra trin 8
   * `DATABASE_URL=` → fra trin 10
   * `DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback`
   * `SESSION_SECRET=` → kør dette i terminalen og **kopiér resultatet**:
     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
4. Gem filen (Ctrl+S). Ingen mellemrum omkring `=`.

### 12. Installér projektet
I VS Code: *Terminal → New Terminal*. Kør:

```bash
npm install
```

(Det tager 1–2 minutter og henter alle pakker.)

### 13. Hvilke kommandoer kører jeg?
Kort fortalt, i denne rækkefølge: `npm install` → `npx prisma db push` → `npm run build` → `npm start`. Hvert trin er forklaret herunder.

### 14. Opret databasetabellerne
```bash
npx prisma db push
```

Du skal se `Your database is now in sync with your Prisma schema`. (Får du fejl, så tjek `DATABASE_URL` og at PostgreSQL kører.)

### 15. Registrér slash-kommandoer
Det sker **automatisk** hver gang botten starter. Vil du gøre det manuelt (eller hvis de ikke dukker op):

```bash
npm run build
npm run commands:register
```

### 16. Start botten
```bash
npm run build
npm start
```

Du skal se linjer som `Logget ind som Nova Events#1234` og `Kontrolpanel kører på port 3000`. I Discord skriver du `/setup` – og følger guiden (log-kanal, roller m.m.).

*(Under udvikling kan du bruge `npm run dev`, som genstarter automatisk ved ændringer.)*

### 17. Start kontrolpanelet
Det starter **sammen med botten** (trin 16). Åbn **http://localhost:3000** i din browser og klik **Log ind med Discord**.

### 18. Konfigurér Discord OAuth2 (kontrolpanelets login)
Allerede gjort i trin 8. Fungerer login ikke: tjek at `DISCORD_REDIRECT_URI` i `.env` er **identisk** med redirect-adressen i Developer Portal.

### 19. Konfigurér kontrolpanelets adresse
Kontrolpanelets adresse udledes af `DISCORD_REDIRECT_URI`. Når du går online (fx `https://nova-events.onrender.com`) skal du:
1. Sætte `DISCORD_REDIRECT_URI=https://nova-events.onrender.com/auth/callback` i hostingens miljøvariabler.
2. Tilføje **præcis den samme adresse** under *Developer Portal → OAuth2 → Redirects → Add Redirect → Save Changes*.

## Del C – Online 24/7

### Anbefalet til begyndere: **Render** (render.com)
Én tjeneste (botten + kontrolpanelet) + én database. HTTPS og domæne følger med. **Vælg en altid-tændt (betalt) plan** – gratis planer går i dvale, og så går botten offline. Tjek priser på render.com/pricing.

*(Alternativ: en billig VPS (fx Hetzner) – se "Egen server" nederst.)*

### 20. Upload projektet til hosting
Hostingen henter koden fra **GitHub**:
1. Opret en gratis konto på **https://github.com** og klik **New repository** → navn `nova-events` → **Private** → **Create**.
2. **Upload hele projektmappen** (alt *undtagen* `node_modules`, `dist`, `.env`): på repo-siden klik **uploading an existing file**, træk filerne ind, **Commit changes**. (`.gitignore` beskytter dine hemmeligheder, hvis du bruger Git i terminalen.)

> ⛔ Upload **aldrig** `.env`. Du indtaster hemmelighederne direkte hos hostingen i næste trin.

### 21 + 24. Opret database og sæt miljøvariabler på hostingen
1. På **https://render.com**: log ind → **New +** → **PostgreSQL** → navn `nova-events-db`, vælg en plan og region (vælg samme region til begge) → **Create Database**.
2. Når den er klar: kopiér **Internal Database URL** (det er din `DATABASE_URL` på hostingen).

### 22 + 23. Deploy botten og kontrolpanelet (samme tjeneste)
1. **New +** → **Web Service** → forbind din GitHub-konto → vælg repo `nova-events`.
2. Udfyld:
   * **Runtime:** `Node`
   * **Build Command:** `npm install && npm run build`
   * **Start Command:** `npm run start:prod`
   * **Instance Type:** en betalt, altid-tændt plan (fx *Starter*)
3. Under **Environment** → **Add Environment Variable** – tilføj én ad gangen:

   | Key | Value |
   |---|---|
   | `DISCORD_TOKEN` | token fra trin 4 |
   | `CLIENT_ID` | fra trin 3 |
   | `CLIENT_SECRET` | fra trin 8 |
   | `DATABASE_URL` | Internal Database URL fra forrige trin |
   | `SESSION_SECRET` | en ny lang tilfældig tekst (trin 11) |
   | `DISCORD_REDIRECT_URI` | `https://DIT-NAVN.onrender.com/auth/callback` *(Render viser din adresse øverst på siden; skriv den præcist)* |

4. Under **Advanced** sæt **Health Check Path** til `/healthz`.
5. Klik **Create Web Service**. Følg loggen – når du ser `Logget ind som …` og `Kontrolpanel kører på port …`, er du online. `start:prod` opretter databasetabellerne automatisk (`prisma db push`).
6. **Gør trin 19:** tilføj redirect-adressen i Developer Portal.

*(Smart genvej: filen `render.yaml` i projektet opretter både database og tjeneste. Render → **New + → Blueprint** → vælg repo → udfyld de fire hemmeligheder.)*

### 24. Forbind databasen
Det er `DATABASE_URL` ovenfor. Bruger du Render-databasen i samme region, så brug **Internal** URL (hurtigere og lukket for omverdenen).

### Domæne og HTTPS
Render giver dig `https://dit-navn.onrender.com` med HTTPS automatisk. Vil du have eget domæne: Render → din tjeneste → **Settings → Custom Domains → Add**, og følg DNS-vejledningen. Husk at opdatere `DISCORD_REDIRECT_URI` **og** redirect i Developer Portal til den nye adresse.

### 25. Sådan kører alt 24/7
Hostingen genstarter automatisk tjenesten, hvis den går ned. Alle timere ligger i databasen, så giveaways og talevents **fortsætter hvor de slap** efter en genstart. Brug en altid-tændt plan.

**Egen server (VPS) i stedet:** installér Node 20+ og PostgreSQL, upload projektet, kør `npm install && npm run build && npx prisma db push`, og start med PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Sæt en reverse proxy med HTTPS foran (fx **Caddy**: `dit-domæne.dk { reverse_proxy localhost:3000 }`).

### 26. Sådan genstarter du botten
* **Render:** din tjeneste → **Manual Deploy → Restart service** (eller *Deploy latest commit*).
* **PM2:** `pm2 restart nova-events`
* **Lokalt:** Ctrl+C i terminalen og `npm start`.

### 27. Sådan opdaterer du botten
1. Tag en backup (trin 28).
2. Erstat filerne på GitHub med de nye (eller `git pull`).
3. Render bygger automatisk. På egen server: `npm install && npm run build && npx prisma db push && pm2 restart nova-events`.

### 28. Sådan tager du backup af databasen
* **Render:** din database → **Backups** (indbygget) → *Create backup* / download.
* **Med kommando** (Mac/Linux/Git Bash): `bash scripts/backup.sh` → filen lægges i `backups/`.
* **Windows uden Git Bash:** i en terminal:
  ```bash
  pg_dump "DIN_DATABASE_URL" --no-owner --no-privileges -f backup.sql
  ```
  (`pg_dump` følger med PostgreSQL-installationen.)

### 29. Sådan gendanner du en backup
1. Stop botten.
2. `bash scripts/restore.sh backups/filnavn.sql` (skriv `JA` når den spørger) – **det overskriver nuværende data**.
   Manuelt: `psql "DIN_DATABASE_URL" < backup.sql`.
3. Start botten igen.

### 30. Fejlfinding af almindelige fejl
Se tabellen under [Fejlfinding](#fejlfinding). De tre hyppigste:
1. **`Used disallowed intents`** → slå Server Members + Message Content Intent til (trin 5).
2. **Login-siden fejler** → `DISCORD_REDIRECT_URI` og redirect i Developer Portal er ikke identiske (trin 8/19).
3. **Vinderrolle gives ikke** → træk botten's rolle højere op end vinderrollen (trin 7).

---

## ✅ Tjekliste før I går live

- [ ] Intents slået til (Server Members + Message Content)
- [ ] Botten har rolle **over** vinderrollen og de nødvendige tilladelser
- [ ] `/setup` kørt – log-kanal, roller og tidszone sat
- [ ] `/config ticket` + `/ticket panel` hvis I bruger tickets
- [ ] Test med `test:ja` på et giveaway og et talevent
- [ ] Logget ind i kontrolpanelet på den rigtige adresse
- [ ] Backup-rutine aftalt

*Nova Events – lavet til Nova Roleplay.* 🔴⚫
