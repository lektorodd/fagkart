# Fagkart-formatet, versjon 1

Dette dokumentet er kontrakten. Skjema (`schema/`), byggjeskript, lint, visning
og Faglogg følgjer det. Endrar du noko her, må alt anna følgje med.

## Kjeldeformat (det vi skriv)

Eitt kart = éi mappe: `kart/<KODE>/`. Mappenamnet er **kartkoden**; han er ofte lik læreplankoden (`laereplan` i `meta.yaml`), men treng ikkje vere det (S1 og S2 deler `MAT04-02`).

```
kart/S2/
  meta.yaml          læreplan, kjerneelement, kompetansemål
  forkunnskap.yaml   nodar eleven skal ha med seg inn i faget
  <klynge>.yaml      éi fil per klynge av kompetansemål
  loeyper.yaml       valfri: løyper laga av lærar (ikkje ei klyngjefil)
```

### meta.yaml

```yaml
laereplan: MAT04-02
namn: Matematikk S2
versjon: "2026.3"            # kartversjon, bump når nodar endrar seg
kjelde: https://www.udir.no/lk20/MAT04-02
forkunnskapsfag: [1P-S1, 1T-S1]   # kva fag (eller vegar) elevane kan koma frå
kjerneelement:
  - id: utforsking
    namn: Utforsking og problemløysing
kompetansemaal:
  - id: km07                 # km01, km02 … i læreplanrekkjefølgje
    tekst: "forstå begrepene forventningsverdi, varians og standardavvik, og …"   # ORDRETT frå kjelder/
    verb: [forstå, bruke, tolke]
    klynge: stokastikk
    udir_kode: null          # Udir sin KM-kode når han er kjend
```

Kjerneelement-ID-ar: `utforsking`, `modellering`, `resonnering`,
`representasjon`, `abstraksjon`.

### Klyngjefil og forkunnskap.yaml

```yaml
klynge: stokastikk
namn: Stokastiske variablar og fordelingar
nodar:
  - id: varians                    # slug: a–z, 0–9, bindestrek. ALDRI endre.
    type: omgrep                   # omgrep | prosedyre | forklaring | representasjon
    namn: Varians
    km: [km07]                     # kompetansemål noden tener
    kjerneelement: [abstraksjon]
    verbnivaa: forklare            # kjenne_til | bruke | forklare | vurdere
    tekst_laerar: "…"              # fagleg presist, kan bruke fagspråk
    tekst_elev: "…"                # kort, enkelt, direkte til eleven
    doeme: "…"
    misoppfatning: "…"
    berre_laerar: []               # felt som ikkje skal med i elevversjonen
    byggjer_paa: [forventningsverdi]
    brukar: []
    doeme_paa: []
    forvekslast_med: [gjennomsnitt-standardavvik-data]
    representerast_som: []
    pos: {x: 420, y: 180}          # valfri, lagra posisjon
    utgaatt: false                 # valfri
```

Ein **forkunnskapsnode** har feltet `forkunnskap` og ligg normalt i
`forkunnskap.yaml`:

```yaml
  - id: derivasjon-s1
    type: omgrep
    namn: Den deriverte og derivasjonsreglar for polynom
    forkunnskap: {1P-S1: ja, 1T-S1: ja}  # ja | delvis | nei, for kvart forkunnskapsfag
    tekst_laerar: "…"
    tekst_elev: "…"
```

Verdiane gjeld det eleven har møtt *før faget startar, grunnskulen medrekna*:
`ja` = dekt, `delvis` = berre noko av det eller svakt, `nei` = hol. `nei` er lov og
viktig: det markerer til dømes noko 1T har og 1P manglar.

**Vegar i staden for fag.** Når alle elevane har same fag rett før (S2 byggjer alltid på
S1), men kjem dit ulike vegar, er forkunnskapsfaga vegar: `forkunnskapsfag: [1P-S1, 1T-S1]`.
Verdien gjeld då alt eleven har møtt på den vegen. Visninga viser bindestrek som pil
(«1T → S1»). Kjeldene for vurderinga er læreplanane i `kjelder/`.

Valfritt felt `sist_sett` seier kvar stoffet sist var tema, t.d. `"9. trinn"` eller
`"1T"`. Det fangar at noko er «ja» men lenge sidan.

### Forkjennskap (nodar i faget som nokre elevar har møtt før)

Ein node i faget (utan `forkunnskap`) kan ha `forkjennskap` med same verdiar:

```yaml
  - id: derivert
    km: [km09]
    forkjennskap: {1P: nei, 1T: ja}   # repetisjon for 1T, nytt for 1P
```

Det er her skiljet mellom 1P- og 1T-elevar blir synleg for stoff som faget sjølv
underviser. `forkunnskap` = faget føreset det; `forkjennskap` = faget underviser det,
men nokre har det frå før.

### Matematikk i tekst: LaTeX

All matematikk i `namn`, `tekst_laerar`, `tekst_elev`, `doeme` og `misoppfatning` er LaTeX:
`$…$` inline og `$$…$$` display. Visninga rendrar med KaTeX. Kvasimatte (², √, ≤, ·, x̄ …) utanfor
`$` er ein lint-feil. Kode og kommandoar i rekneark/GeoGebra står i `` `…` ``.

| Skriv | Ikkje |
|---|---|
| `$0{,}05$` (desimalkomma) | `$0,05$` (gir mellomrom), `0,05·x` |
| `$10\,000$` (tusenskilje) | `10 000` inni formel |
| `$a \cdot b$` | `a·b`, `a*b` |
| `$\bar{x}$`, `$\hat{p}$`, `$\mu$`, `$\sigma$` | `x̄`, `p̂`, `μ`, `σ` |
| `$x^2$`, `$a_n$`, `$\sqrt{x}$` | `x²`, `aₙ`, `√x` |
| `$\le$`, `$\ge$`, `$\approx$`, `$\neq$` | `≤`, `≥`, `≈`, `≠` |
| `$f'(x)$`, `$\int_a^b f(x)\,dx$`, `$\sum_{i=1}^{n} x_i$` | `f′(x)`, `∫`, `Σ` |
| `$N(\mu;\sigma)$`, `$P(A \mid B)$` | |
| `$5$ kr`, `$12\,\%$` i formel, «12 %» i vanleg prosa | |

Reine tal i prosa («30 elevar», «2026») treng ikkje `$`. Alt med variablar, operasjonar,
formlar eller symbol skal i `$`.

**YAML:** bruk blokkskalarar (`>-`) eller enkle hermeteikn for felt med LaTeX. Doble
hermeteikn tolkar `\` som escape og øydelegg LaTeX.

### Nivå

Valfritt felt `nivaa: 1 | 2`. Nivå 1 er kjernen, omgrep og reglar som skal synast på
oversiktskartet, typisk 40–60 nodar per fag. Nivå 2 er utdjuping (forklaringar,
representasjonar, delprosedyrar) og blir vist først når ein zoomar inn. Utan felt = 2.

Bygget lagar `oversiktskantar`: `byggjer_paa` mellom nivå 1-nodar, trekt saman gjennom
skjulte nivå 2-nodar og transitivt redusert, pluss `forvekslast_med` mellom nivå 1-nodar.

### Kantar

Kantar står i noden dei går *frå*:

| Felt | Tyding | Retning |
|---|---|---|
| `byggjer_paa` | denne noden føreset målnoden | frå → føresetnad |
| `brukar` | ein prosedyre brukar eit omgrep | prosedyre → omgrep |
| `doeme_paa` | denne er eit døme eller spesialtilfelle av målnoden | døme → generelt |
| `forvekslast_med` | blir ofte blanda, symmetrisk | skriv han éin gong |
| `representerast_som` | omgrep vist som representasjon | omgrep → representasjon |

`dekkjer`-kantar til kompetansemål blir laga automatisk frå `km`.

### Løyper (loeyper.yaml)

Fila er valfri og heiter alltid `loeyper.yaml`. Ho er ikkje ei klyngjefil: lastaren les henne for seg,
og ho har ikkje `klynge` eller `nodar` på toppnivå. Ei løype er ei ordna liste med nodar lærar meiner
det løner seg å ta i denne rekkjefølgja, t.d. til eksamen.

```yaml
loeyper:
  - id: repetisjon-eksamen          # slug som node-ID-ane; unik i kartet
    namn: Repetisjon til eksamen
    skildring: Kjernen i faget i den rekkjefølgja det løner seg å ta henne att.   # valfri
    maalgruppe: [1P-S1, 1T-S1]      # valfri; verdiar frå forkunnskapsfag i meta.yaml
    nodar: [forventningsverdi, varians, standardavvik]   # ordna; node-ID-ar frå kartet, utan prefiks
```

Ei løype peikar berre på nodar i faget (og forkunnskapsnodar), ikkje på kompetansemål.

### Endringar (endringar.yaml)

Versjonslogga til kartet: éi kort linje per versjon, skriven for hand, nyaste versjon først. Fila ligg i kartmappa
(`kart/<KODE>/endringar.yaml`) og er valfri. Lista over kva som er nytt, endra og sletta blir ikkje skriven for hand:
`scripts/endringar.py` reknar henne ut frå to bygg (sjå § Byggformat).

```yaml
endringar:
  - versjon: "2026.2"
    dato: 2026-10-29
    samandrag: Forkunnskapen er delt i vegane 1P → S1 og 1T → S1, og kartet er sjekka mot NDLA og læreboka.
    etter_innspel: 3        # valfritt: tal innspel (kommentarar) som er behandla i denne versjonen
  - versjon: "2026.1"
    dato: 2026-10-18
    samandrag: Første versjon av kartet.
```

- `versjon` (tekst), `dato` (`ÅÅÅÅ-MM-DD`, som YAML-dato eller tekst) og `samandrag` (éi–to setningar, LaTeX som elles) er påkravde.
- `etter_innspel`: valfritt heiltal (0 eller meir).
- Den øvste versjonen skal vere lik `versjon` i `meta.yaml`. Ny versjon: legg ei ny post øvst og endre `meta.yaml` i same commit.
- Release-commiten får git-taggen `<KODE>-<versjon>` (`S2-2026.2`). Frå taggen hentar neste versjon
  det førre bygget som ho blir samanlikna med.

## Byggformat (det vi les)

`python3 scripts/bygg.py` lagar `dist/<KODE>.json`:

```json
{
  "format": "fagkart/1",
  "kode": "S2",
  "laereplan": "MAT04-02",
  "namn": "Matematikk S2",
  "versjon": "2026.3",
  "forkunnskapsfag": ["1P-S1", "1T-S1"],
  "kjerneelement": [{"id": "utforsking", "namn": "…"}],
  "klyngjer": [{"id": "stokastikk", "namn": "Stokastiske variablar og fordelingar"}],
  "nodar": [
    {"id": "S2/km07", "type": "kompetansemaal", "namn": "km07", "tekst": "…", "verb": ["…"], "klynge": "stokastikk"},
    {"id": "S2/varians", "type": "omgrep", "namn": "Varians", "klynge": "stokastikk", "km": ["S2/km07"], "…": "…"}
  ],
  "kantar": [
    {"fra": "S2/varians", "til": "S2/forventningsverdi", "type": "byggjer_paa"},
    {"fra": "S2/varians", "til": "S2/km07", "type": "dekkjer"}
  ]
}
```

`kode` er **kartkoden**: mappenamnet under `kart/` og filnamnet `dist/<KODE>.json`. Han kan vere ulik `laereplan`, for
ei læreplankode kan ha fleire kart (S1 og S2 har begge `laereplan: MAT04-02`). Alle node-ID-ar i bygget har
prefikset `<KODE>/` (kartkoden, ikkje læreplankoden). Visninga, layout-fila og overlegg identifiserer kartet med `kode`.
`kode` er valfritt i lesinga: bygde filer frå før feltet kom manglar det, og då er `laereplan` kartkoden. `format` er
framleis `fagkart/1`. Felt utan verdi blir utelatne.

Har kartet ei `loeyper.yaml`, får bygget feltet `loeyper` (utelate når kartet ikkje har løyper). Løype-ID-en er
slugen frå kjelda, utan prefiks; `nodar` har prefiksa node-ID-ar, i same rekkjefølgje som i kjelda:

```json
  "loeyper": [
    {"id": "repetisjon-eksamen", "namn": "Repetisjon til eksamen", "skildring": "…", "maalgruppe": ["1P-S1", "1T-S1"],
     "nodar": ["S2/forventningsverdi", "S2/varians", "S2/standardavvik"]}
  ]
```

### Layout (dist/<KODE>.layout.json)

`node build.mjs` (i `viewer/`) skriv ei fil til ved sida av `dist/<KODE>.html`: `dist/<KODE>.layout.json`, med dei faste
posisjonane og pilrutene til kartet. Posisjonar finst elles berre inni HTML-fila; denne fila er for lesarar utan nettlesar
(Faglogg, Typst-PDF). Ho er **avleidd** frå `dist/<KODE>.json` og layoutkoden: ho blir aldri handredigert, og ho blir skriven på
nytt ved kvart bygg.

```json
{"format": "fagkart-layout/1", "kart": "S2", "kartversjon": "2026.3", "layout": {"version": 2, "nodes": {}, "…": "…"}}
```

- `format`: alltid `fagkart-layout/1`.
- `kart`: kartkoden (som i filnamnet).
- `kartversjon`: `versjon` frå `dist/<KODE>.json` som layouten er rekna ut frå.
- `layout`: nøyaktig same objekt som HTML-fila legg inn i `<script id="fagkart-layout">`, utan omforming, så fila og sida kan ikkje sprike. `null` når kartet ikkje har noko å leggje ut (berre kompetansemål). Feltnamna på toppnivå:
  - `version`: versjonen av layoutformatet (talet 2).
  - `order`: rekkjefølgja på områda (klyngjene) i layouten.
  - `cols`: områda fordelte på kolonnar (lister med område-ID-ar).
  - `nodes`: node-ID til `{x, y, w, h, lines, l, …}`; `x`, `y` er midten av boksen, `lines` er namnet brote i linjer, `l` er nivået (1 eller 2). Berre nodar som ikkje er utgåtte og ikkje er kompetansemål.
  - `areas`: område-ID til `{x, y, w, h, band}` (midten, storleik og høgda på namnebandet); same boks som temaboksen.
  - `bounds`: `{x1, y1, x2, y2}`, rektangelet kring alle områda.
  - `routes`: pil-ID til ruta, ei liste `[[x, y], …]` frå `fra`-noden til `til`-noden.
  - `tema`: tema-ID til temavisinga (`frame`, `nodes`, `bounds`, `routes`): ramma, nodane (òg dei grå naboane, med `role`) og pilrutene i temaet.
  - `problems`: feil frå utlegginga (til dømes ei pil utan veg); tom liste når alt gjekk bra.
  - `utanForkunnskap`: same oppbygging utan forkunnskapsklynga («Vis forkunnskapar» av); `null` når kartet ikkje har forkunnskapsnodar.
  - `smal`: same oppbygging (med `utanForkunnskap`), pakka for ein telefon som står oppreist; `null` for kart med færre enn tre område.

### Endringslogg (dist/<KODE>.endringar.json)

Har kartet ei `endringar.yaml`, skriv `python3 scripts/bygg.py` (via `scripts/endringar.py`) òg `dist/<KODE>.endringar.json`.
`python3 scripts/endringar.py <KODE>` gjer berre dette steget og listar dei nye nodane. Fila er **avleidd** og blir ikkje handredigert.
Versjonane står nyaste først, same rekkjefølgje som i `endringar.yaml`:

```json
{"format": "fagkart-endringar/1", "kart": "S2", "versjonar": [
  {"versjon": "2026.2", "dato": "2026-10-29", "samandrag": "…", "etter_innspel": 3, "utrekna": true,
   "nye": [{"id": "S2/eulers-metode", "namn": "Eulers metode: …", "tema": "vekstmodellar"}],
   "endra": [{"id": "S2/grenseverdi", "namn": "Grenseverdi", "felt": ["tekst_laerar", "doeme"]}],
   "sletta": [{"id": "S2/gamal-node", "namn": "…"}],
   "kantar": {"nye": [{"fra": "S2/a", "til": "S2/b", "type": "byggjer_paa"}], "fjerna": []}},
  {"versjon": "2026.1", "dato": "2026-10-18", "samandrag": "Første versjon av kartet.", "utrekna": false}
]}
```

- Den nyaste versjonen blir samanlikna med `dist/<KODE>.json` slik han nett er bygd, ein eldre med bygget i taggen `<KODE>-<versjon>`
  (`git show <KODE>-<versjon>:dist/<KODE>.json`). Det han blir samanlikna med, er bygget til *neste post* i `endringar.yaml`.
- `nye`: nodar (òg kompetansemål) som er i det nye bygget, men ikkje i det gamle; `tema` er `klynge`. `sletta`: nodar som er borte
  eller har `utgaatt: true` i det nye bygget. `endra`: nodar i begge, med `felt` (i denne rekkjefølgja) av `namn`, `tekst_laerar`,
  `tekst_elev`, `doeme`, `misoppfatning`, `nivaa`, `verbnivaa`, `forkjennskap`, `km`, `klynge`; eit felt som manglar tel som tomt.
  `kantar.nye` og `kantar.fjerna` er `{fra, til, type}` mellom nodar som finst i begge bygga (`forvekslast_med` er symmetrisk).
  Alt anna (`loeyper`, `implisitt`, `oversiktskantar`, nodar som er utgåtte) tel ikkje.
- `utrekna: false` (berre `versjon`, `dato`, `samandrag`, `etter_innspel`): den eldste posten, eller ein post der taggen manglar. Då skriv
  skriptet éi linje til stderr og held fram med returkode 0. Nodelistene manglar då.
- `etter_innspel` står berre når han er sett. `dato` er alltid ei ISO-tekst.
- `build.mjs` legg fila inn i sida (`<script id="fagkart-endringar">`, `null` utan fil) og kopierer ho til `publiser/<sti>/`;
  hjelpeboksen viser «Kva er nytt», sjå `docs/ARKITEKTUR.md` § Integrasjonar.

## Overleggsformat

Overlegg peikar berre på bygde node-ID-ar og ligg aldri i `kart/`.

```json
{
  "format": "fagkart-overlegg/1",
  "kart": "S2",
  "kartversjon": "2026.3",
  "namn": "Årsplan 2026–27",
  "type": "dekning",
  "oppdatert": "2026-10-23T14:02:00+02:00",
  "skala": ["planlagt", "undervist", "vurdert"],
  "skala_namn": {"planlagt": "Planlagt", "undervist": "Undervist", "vurdert": "Vurdert"},
  "merke": {"S2/varians": "undervist"},
  "notat": [{"node": "S2/varians", "tekst": "…"}],
  "omraade": [{"namn": "Periode 2", "nodar": ["S2/varians"]}],
  "eigne_kantar": [{"fra": "…", "til": "…", "tekst": "…"}]
}
```

- `kart` er **kartkoden** (`kode` i det bygde kartet, t.d. `S2`), ikkje `laereplan` (`MAT04-02`). Eit overlegg med
  ein annan kode enn kartet blir avvist.
- `type` (valfri): `eigenvurdering` | `dekning` | `notat`. Eit lag les berre overlegg av sin eigen type; utan `type` er
  fila ei eldre fil, og eit lag kan velje å godta henne.
- `oppdatert` (valfri): tidsstempel i ISO 8601 med tidssone (`2026-10-23T14:02:00+02:00` eller `…Z`), sett kvar gong
  overlegget blir endra. Gamle filer utan `type` og `oppdatert` er framleis gyldige.
- **Eigenvurdering** (`type: "eigenvurdering"`): `namn` er alltid «Mi eigenvurdering» (inga namnefelt, ingen elevnamn),
  `skala` er `["ikkje", "delvis", "heilt"]`, og `merke` gir ein av dei tre verdiane per bygd node-ID. Ein node utan
  merke er *ukjend*, ikkje «ikkje». `merke` kan innehalde ID-ar som ikkje finst i kartet (ny kartversjon); dei blir
  tekne vare på og skrivne tilbake, aldri sletta.
- **Markering** (`type: "dekning"`, laget «Markering» i lærarvisinga): årsplan eller eksamenskonstrukt. Ei fil = eitt
  overlegg = éin plan eller eitt konstrukt.
  - `skala` har 2–6 ulike verdiar. Førehandsdefinerte: årsplan `["planlagt", "undervist", "vurdert"]` og eksamen
    `["del1", "del2", "ikkje-eigna", "uavklart"]`. Ein eigen skala får verdiar laga av namna (`"Kanskje"` → `kanskje`).
  - `skala_namn` (valfri): kva verdiane heiter på skjermen, t.d. `{"del1": "Del 1 (utan hjelpemiddel)", "del2": "Del 2",
    "ikkje-eigna": "Ikkje eigna", "uavklart": "Uavklart"}`. Namna ligg i fila, så dei kan endrast når eksamensordninga
    endrar seg, utan ny kode. Utan namn blir verdien vist med stor forbokstav.
  - `merke`: éin verdi frå `skala` per node. Ein verdi som ikkje er i skalaen, blir forkasta ved opning (og sagt frå om);
    ID-ar som ikkje finst i kartet, blir tekne vare på.
  - `notat`: fritekst per node, til dømes innspel frå møtet. Laget held eitt notat per node (fleire blir slått saman).
  - `omraade`: namngitte sett, til dømes «Sett A, våren 2027» med nodane settet rører, eller «Periode 2» i årsplanen.
    Namna er unike. Kva sett som er aktivt, står ikkje i fila.
  - Fila inneheld aldri elevdata.

## Reglar som lint sjekkar

Feil (stoppar bygget):
1. Skjemafeil, eller ugyldig ID.
2. Ein ID som finst to gonger i kartet.
3. Ein referanse (`km`, kantar) som ikkje finst.
4. Sirkel i `byggjer_paa`, eller ein kant frå ein node til seg sjølv.
5. Eit kompetansemål utan nodar.
6. Ein faginterne node (utan `forkunnskap`) som manglar `km`, `verbnivaa`, `tekst_laerar` eller `tekst_elev`.
7. Ein forkunnskapsnode som manglar verdi for eit forkunnskapsfag.
8. Ein forkunnskapsnode som ingen node byggjer på.
9. Ein kompetansemåltekst i `meta.yaml` som ikkje står ordrett i `kjelder/<KODE>.md`.
10. `forkjennskap` på ein forkunnskapsnode, eller utan verdi for eit forkunnskapsfag.

Åtvaringar:
- Eit kompetansemål med færre enn 3 nodar.
- Ein node utan `doeme` eller `misoppfatning`.
- Ein node i faget utan `forkjennskap`, når kartet elles brukar `forkjennskap` (då skal alle nodar ha eit eksplisitt val, også `{1P: nei, 1T: nei}`).
- `tekst_elev` over 300 teikn.
- Vanlege bokmålsord og a-infinitiv «vera» i tekst (ikke, hvis, hvordan, hva, hvor, mye, noen, jeg, være, dere, mens, bruker, trekker, retter, gjentatt, vera).

Løyper (`loeyper.yaml`), feil:
- Skjemafeil (ukjend felt, manglande `id`, `namn` eller `nodar`, ugyldig slug).
- Løype-ID som finst to gonger i kartet.
- Ein node i `nodar` som ikkje finst i kartet (kompetansemål er ikkje nodar i denne samanhengen).
- Same node to gonger i ei løype.
- Ei løype med færre enn 2 nodar.
- `maalgruppe` med ein verdi som ikkje står i `forkunnskapsfag` i `meta.yaml`.

Løyper, åtvaringar:
- Ein node står *før* ein node han byggjer på (direkte eller gjennom ei kjede av `byggjer_paa`) i same løype.
- Ei løype inneheld ein `utgaatt`-node.

Endringslogg (`endringar.yaml`), feil:
- Skjemafeil (ukjend felt, manglande `versjon`, `dato` eller `samandrag`, `dato` som ikkje er `ÅÅÅÅ-MM-DD`, negativ `etter_innspel`).
- `dato` som ikkje finst i kalenderen (til dømes `2026-13-45`).
- Same `versjon` to gonger.
- Øvste versjon i fila er ulik `versjon` i `meta.yaml` («øvste versjon i endringar.yaml (x) er ikkje lik versjon i meta.yaml (y)»).

### Implisitte kantar
Bygget merkjer ein `byggjer_paa`-kant med `"implisitt": true` når han alt følgjer av
ein lengre kjede (A → B → C gjer A → C implisitt). Kanten blir ikkje sletta,
men visninga skjuler han som standard.
