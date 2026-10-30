# Arkitektur: kjerne og lag

Mål: nye funksjonar (eigenvurdering, stiar, årsplan, Faglogg, notat) skal kunne leggjast til
**utan å endre kjernen eller kartfilene**. Alt nytt er eit *lag* som les kartet og eit *overlegg*.

```
kart/*.yaml ──bygg──▶ dist/<KART>.json ──┐
                                         ├──▶ visningskjerne ──▶ lag A, lag B, …
overlegg (fil / localStorage / Faglogg) ─┘         (zoomflate)
```

## Tre slags data, strengt skilde
| Kva | Kven eig | Kvar | Elevdata? |
|---|---|---|---|
| **Kart** (nodar, piler, tema, nivå, løyper) | fagforfattar | `kart/` → `dist/` | aldri |
| **Overlegg** (markeringar, notat, planar) | brukaren | fil (`fagkart-overlegg/1`), localStorage, Faglogg | ja, berre lokalt |
| **Visningsstate** (zoom, val, opne seksjonar) | nettlesaren | localStorage | nei |

Ingen lag skriv til kartet. Elevdata forlèt aldri eininga utan at brukaren sjølv lastar ned ei fil.

## Visningskjernen (stabil)
Kjernen eig: zoomflata (Tema · Kart · Detalj), temavisinga (eitt tema om gongen), layout, val av node, nodekort-ramma, søk, toppfeltet og «Fleire val».
Kjernen teiknar pilene etter `edgeStyle` frå laga og ingen eigne avkryssingsboksar: `dekkjer` blir aldri teikna (eit valt kompetansemål
uthevar nodane sine), og pilene mellom temaboksane (`byggjer_paa`) står alltid. Teiknforklaringa («?») viser pilene som er teikna no:
«Byggjer på» alltid, dei fire andre når «Vis andre koplingar» er på.
Toppfeltet har berre namnet, zoomknappane, søk, «Lærar | Elev» og «Fleire val»; resten ligg bak «Fleire val» (sjå under).
Han tilbyr eit lite **lag-API** (`window.fagkart.registerLayer`, sjå § Lag-API under).

Reglar: eit lag kan ikkje fjerne eller flytte nodar, berre farge, merke, utheve, dimme og leggje til
kortseksjonar. Fleire lag kan vere aktive; kjernen bestemmer prioritet (val > sti > markering > tema-farge).
Grafalgoritmar (føresetnadskjede, topologisk rekkjefølgje, kortaste veg, «klar til å lære») ligg i éin modul
(`viewer/src/graph.js`) som alle lag brukar.

## Lag-API
Filer i `viewer/`:

| Fil | Kva |
|---|---|
| `src/graph.js` | Grafalgoritmar, reine funksjonar utan DOM: `makeGraph`, `reach`, `topoOrder`, `prerequisiteChain`, `shortestPath`, `readyToLearn`. Testar i `test/graph.test.mjs`. |
| `src/layers.js` | Lagregisteret: tek imot lag og slår saman svara deira etter prioritet. Testar i `test/layers.test.mjs`. |
| `src/tema.js` | Reine hjelparar for temaa: fargeplassen til eit tema (`temaSlot`) og tala på temaboksen (`countText`). Testar i `test/tema.test.mjs`. |
| `src/route.js` | Ruteren for piler: rette stykke (vassrett og loddrett) som går utanom alle boksar, frå kant til kant (`routeEdges`), og omrekning til Cytoscape (`toSegments`). Brukt både av bygginga (`layout.mjs`, pilene i kartet) og av sida (pilene mellom temaboksane). Testar i `test/route.test.mjs`. |
| `src/kartkantar.js` | Kva piler flata teiknar (`kartEdges`, `arrowEnds`) og id-ane deira (`o<i>`, `e<i>`), og kva nodar og piler temavisinga har for eitt tema (`temaMembers`). Bygginga og sida bruker same lister, så rutene passar. |
| `temalayout.mjs` | Layouten til temavisinga, rekna ut ved bygging: ei ramme med nodane i temaet, grå nabonodar på sidene og rutene til pilene. Kalla frå `layout.mjs`; ligg i det same mellomlageret. Testar i `test/temavising.test.mjs` og `test/temavising.browser.test.mjs`. |
| `src/app.js` | Kjernen: zoomflata og temavisinga. Spør laga i kvar oppdatering og teiknar svaret. |
| `src/lag/*.js` | Dei innebygde laga (sjå under). Kvar fil er eit vanleg skript som berre kallar `fagkart.registerLayer`. |

`build.mjs` legg modulane (`texlabel.js`, `graph.js`, `tema.js`, `route.js`, `kartkantar.js`, `layers.js`) inn før kjernen og laga etter. Eit lag utanfor kjernen blir med med
`node build.mjs --lag=sti/til/lag.js`; ingen kjernefil treng endrast.

### Døme
Heile testlaget (`viewer/test/lag/testlag.js`, 15 liner): fargar alle prosedyrar og legg til ein kortseksjon
med det du må kunne først, i lærerekkjefølgje.

```js
fagkart.registerLayer({
  id: 'testlag',
  label: 'Testlag',
  priority: 'markering',
  nodeStyle: (n) => (n.type === 'prosedyre' ? { fill: '#ffe08a', ring: '#c98a00' } : null),
  nodeCard(n, ctx) {
    const chain = ctx.alg.prerequisiteChain(ctx.graph(), n.id).map((id) => ctx.byId.get(id));
    return ctx.h('section', { class: 'testlag' },
      ctx.h('h3', null, 'Lær først (testlag)'),
      chain.length ? ctx.h('ol', null, chain.map((m) => ctx.h('li', null, ctx.rich(m.namn)))) : ctx.h('p', { class: 'empty' }, 'Ingenting.'));
  },
  toolbar: (ctx) => ctx.h('p', { class: 'note' }, 'Prosedyrane er gule.'),
});
```

### Felt og krokar
Alle krokar er valfrie. `node` er noden frå kartet (`dist/<KART>.json`), aldri eit Cytoscape-element.

| Felt / krok | Kva |
|---|---|
| `id`, `label` | Unik id; namnet blir vist over kontrollane til laget. |
| `modes` | Når laget er tilgjengeleg: `elev`, `laerar`, `faglogg` (standard: alle). Elevvising = `elev`. |
| `priority` | `tema` < `markering` (standard) < `sti` < `val`, eller eit tal. Høgare vinn. Valet av node teiknar kjernen alltid øvst. |
| `overlay` | Kva overleggstype laget eig (`fagkart-overlegg/1`). Berre dokumentasjon førebels. |
| `init(ctx)` | Éin gong før første teikning. |
| `styles(c, { mix })` | Ekstra Cytoscape-reglar for klassane til laget. `c` er fargetokena (`c.red`, `c.surface` …). |
| `prepare(ctx)` | Éin gong per oppdatering, før `nodeStyle`. For utrekningar som gjeld fleire nodar. |
| `nodeStyle(node, ctx, el)` | Svar `{ fill, ring, classes, badge: { tone, text, size }, fade, hide, keep }` eller `null`. `keep` held noden open når ein vald node dimmar alt utanom naboane sine (stega på ein sti). `el` = `{ grey, kart, lvl }` (`grey` er `true` for ein grå nabonode i temavisinga, elles `false`; `kart` er alltid `true`; `lvl` er nivået, 1 eller 2). Ein grå nabonode skal stå roleg: lag set ikkje farge, merke eller hol på han, men `hide` og `fade` blir tekne med. |
| `nodeLabel(node, ctx)` | Ei ekstra line under namnet. Zoomflata har faste boksar og spør ikkje etter han førebels; kroken er teken imot, men gjer ingenting. |
| `edgeStyle(kant, ctx)` | `{ hide }` for ei pil. `kant` = `{ type, fra, til, implisitt }`. |
| `clusterStyle(cid, ctx)` | `{ badge }` på temaboksen (synleg på Tema-nivået; temavisinga har ingen temaboks). `cid` er id-en til temaet (`klynge` i kartet). |
| `nodeCard(node, ctx)` | Seksjon(ar) i nodekortet. `cardSlot: 'top'` (under tittelen) eller `'bottom'` (standard, etter dei lukka seksjonane). Bruk `ctx.fold` for ein seksjon som er lukka til brukaren opnar han. |
| `kmCard(km, ctx)` | Seksjon i kortet for eit kompetansemål. |
| `toolbar(ctx)` | Kontrollar. Returner eit element (kjernen lagar ein eigen seksjon **i «Fleire val»**, ei skuff under toppfeltet; botnskuff på mobil), eller kople til kontrollar som alt finst i sida og returner `null`. Skuffa er lukka ved opning, så ikkje legg noko du treng heile tida her. |
| `render(ctx)`, `status(ctx)` | Etter kvar oppdatering: synkroniser eigne kontrollar; kort tekst til «Visning»-overskrifta i «Fleire val». |
| `reveal(node, ctx)` | Noden er bede om (søk, lenkje), men laget skjuler han: slepp han fram. |
| `onSelect(node, ctx)` | Brukaren har valt ein node. |
| `viewport(ctx)` | Éin gong per ramme etter pan, zoom, nivåskifte og `update()`: plasser HTML som skal følgje nodane (i `ctx.stageLayer`, med `ctx.nodeBox`). Ikkje før sida er starta. |

Slik blir svara slått saman: `classes` blir lagde saman, `hide`, `fade` og `keep` gjeld om eitt lag seier det,
og alle andre felt (`fill`, `ring`, `badge` …) kjem frå laget med høgast prioritet som set dei.
`hide` tek noden ut av kartet; plassane i zoomflata er faste, så filter bruker `fade`. Eit tema der alle omgrepa er dimma, blir dimma som boks på Tema-nivået.
Merke (`badge.tone`): `new` (blå), `rep`/`ok` (mint), `part` (gul), `hole` (raud).

`ctx` gir kartet og nokre hjelparar: `data`, `kode` (kartkoden), `nodes`, `byId`, `isFk`, `isKm`, `groupOf`, `clusters()`,
`clusterNodes`, `graph()` (med implisitte piler når dei er viste), `alg` (algoritmane i `graph.js`),
`h`, `rich` (tekst med LaTeX), `dotFor`, `nodeLink`, `section`, `fold(key, tittel, innhald, tal?)` (lukka seksjon i kortet, `<details>`; kva brukaren opnar blir hugsa per `key` i localStorage; gir `null` utan innhald), `level` (`tema`, `kart` eller `detalj`; følgjer zoomen, og er alltid `detalj` i temavisinga, der nivå 1 og 2 begge er med), `tema` (id-en til temaet som er opna i temavisinga, eller `null` på zoomflata), `view` (alltid `'kart'`, berre for eldre lag), `mode`, `state` (berre lesing,
bortsett frå felt laget sjølv eig), `layer(id)` (eit anna lag, eller `null`; for det laget tilbyr utanom krokane, t.d. `layer('eigenvurdering').mark(id)`), og handlingane `update()`, `rebuild()`, `select(id)`, `shownIds()`, `frame(ids)` og `leaveRoom()` (ut av rommet, sjå § Integrasjonar). For HTML som skal følgje nodane: `stageLayer` (`<div id="stageLayer">` ved sida av `#cy` i `.stage`, halde over kartet av kjernen; ikkje inni `#cy`, for Cytoscape tek alle touch-hendingar på sitt eige element, og eit trykk på ein knapp der ville aldri kome fram; laget tek ikkje peikarhendingar sjølv, barna gjer det) og `nodeBox(id)` → `{ x, y, w, h, op, dim, sel }` i pikslar frå øvre venstre hjørne av kartflata (midten og storleiken til boksen, opacity, dimma, vald), eller `null` når noden ikkje er teikna (skjult, ute ved denne zoomen, grå nabo i temavisinga, ikkje på kartet).

### Innebygde lag
| Lag | Fil | Kva |
|---|---|---|
| Forkunnskap 1P/1T | `lag/forkunnskap.js` | Fagvalet: hol i forkunnskapen, «nytt for 1P»-merke, merke på temaboksane, fagmerka i kortet |
| Implisitte piler | `lag/implisitte.js` | «Vis implisitte piler»: skjuler implisitte piler til brytaren er på |
| Andre koplingar | `lag/koplingar.js` | «Vis andre koplingar» (Visning, under «Vis implisitte piler», i alle visingar): skjuler `brukar`, `doeme_paa`, `representerast_som` og `forvekslast_med` til brytaren er på. Valet blir hugsa (`fagkart.koplingar`); i vertsmodus er det av og blir ikkje lagra. Koplingane står alltid i kortet |
| Filter | `lag/filter.js` | Tema · Type · Kjerneelement: dimmar det som ikkje passar (`fade`) |
| Neste steg | `lag/nestesteg.js` | Berre elevvising. Les markeringane frå «Kva kan eg?» (`ctx.layer('eigenvurdering').marks()`). Seksjonen «Neste steg» i «Fleire val»: **klar til å lære** (node i faget som ikkje er *heilt*, med alle føresetnader i faget *heilt* og ingen forkunnskapsføresetnad markert *ikkje*/*delvis*; umarkert forkunnskap = kunna; utan markeringar er dette startpunkta) og **svake punkt** (*ikkje*/*delvis*, flest nodar i faget som byggjer på dei først, med talet), inntil 8 per liste og «Vis fleire»; tal på det som ikkje er vurdert. Brytaren «Vis på kartet» gir merka «klar» (`new`) og «svakt» (`hole`), resten tonar ut, og `status` gir «5 klare». Nodekortet (`cardSlot: 'bottom'`) har éi line: «Du har det du treng for å lære dette» eller «Manglar: 2 føresetnader» (opnar lenkjer). Reglane les føresetnadene i den reduserte grafen (ein føresetnad som ei anna føresetnad alt byggjer på er utelaten), så svaret er det same med og utan «Vis implisitte piler». Reglane ligg i `plan(ctx)` (òg `layer.plan`), testa i `test/nestesteg.test.mjs` og `test/nestesteg.browser.test.mjs`. |
| Eigenvurdering «Kva kan eg?» | `lag/eigenvurdering.js` | Berre elevvising. Knappen «Kva kan eg?» i toppfeltet (`state.ev`, `setEv`) slår visinga på og av; valet blir hugsa per kart (`fagkart.<KODE>.evvising`, `pa` / `av`), og første gong er han av. **På:** kjernen teiknar kartet som strek (`state.strek`, som i vertsmodus), «Eg kan dette …» med tre knappar i nodekortet (*Ikkje enno · Delvis · Godt*, trykk på den valde fjernar merket; lagra som `ikkje` / `delvis` / `heilt`), fyll- og kantfarge på nodane (`ev-ikkje` / `ev-delvis` / `ev-heilt`, same tonar som `hole` / `part` / `ok`), og «3 av 12 kan eg godt» på temaboksen og i kompetansemålkortet. **Av:** det vanlege kartet utan noko frå laget i kartet eller kortet; markeringane står urørte. Seksjonen i «Fleire val» med tal, «Lagre kopi (fil)», «Hent frå fil» og «Tøm alle» står i begge tilstandane. Lagringa er sagt tre stader: øvst i seksjonen, som ei dempa linje i kortet medan eleven har 1–9 markeringar, og i gjennomgangen. Frå 10 markeringar kjem ei påminning med «Lagre kopi» i seksjonen og i kortet når eleven aldri har lagra kopi, har lagt til 10 sidan sist, eller sist lagra for over 7 dagar sidan; sist lagra kopi ligg i `fagkart.<KODE>.evkopi` (`{ naar, tal }`), aldri i fila. Er laget på og ingenting markert, står hintlinja `#evHint` over kartet til kortet blir opna. Står etter forkunnskapslaget i `BUILTIN_LAYERS`, så fyllfargen til eleven vinn over hol-fargane; hol-ramma frå forkunnskapslaget vinn over kanten. «Neste steg» og «Stiar» les markeringane same om knappen er på eller av. Tilbyr `mark(id)` (`ikkje` / `delvis` / `heilt` / `null`) og `marks()` til andre lag via `ctx.layer('eigenvurdering')`. |
| Markering | `lag/markering.js` | Berre lærarvising (`modes: ['laerar']`, `overlay: 'dekning'`). Av til ei fil er opna eller «Ny markering» er valt (namn og skala: *Årsplan* planlagt / undervist / vurdert, *Eksamen* del 1 / del 2 / ikkje eigna / uavklart, eller *Eigen* med 2–6 verdiar). **Kartet:** fyll og kant per verdi (`mk-<farge>`, fargen følgjer plassen i skalaen), umerka nodar blir kvitt papir med grå kant (`mk-av`) så dei merkte skil seg ut frå typefargane, og nodane i det aktive settet får ei stipla ramme (`mk-sett`, `outline`). Merke på temaboksen: «5 av 12 planlagt» når éin verdi er i bruk, «3 del 1 · 4 del 2» når fleire er (slått saman med merket frå forkunnskapslaget). **Nodekortet** (`cardSlot: 'top'`): skalaen som knappar med tastnummer, «I sett: A, B» med «Legg i / Ta ut av» det aktive settet, og notatfeltet (lagra medan du skriv, utan å teikne kortet på nytt). **Kompetansemålkortet:** same tal som i tabellen. **Hurtigtastar** (lyttar på `document` frå `init`, ingen endring i kjernen) med ein node vald: `1`–`6` set verdi nr. n, `0` fjernar, `n` opnar notatet, `s` legg noden i det aktive settet eller tek han ut; ikkje når fokus er i eit tekstfelt (`input`, `textarea`, `select`, `contenteditable`) eller med Ctrl/Alt/Cmd. **«Fleire val»:** namn, fil og ulagra-status, skala med tal, «Lagre» / «Lagre som» / «Opne fil» / «Ny» / «Lukk» (spør før ulagra endringar blir forkasta), «Vis stort» (rotskrift 20 px i staden for 16, tekststorleiken «Stor» på kartet, merke 16 i staden for 13), og tre underseksjonar: *Sett* (lag, gi nytt namn på staden, gjer aktivt, slett), *Dekning* (tabell per kompetansemål: nodar, tal per verdi, «ingen» i raudt; for eksamen i tillegg *bruke* merkt del 2 og nodar i meir enn eitt sett; «Kopier som tekst» med tabulatorar) og *Hurtigtastar*. **Fil:** med File System Access API (Chrome, Edge) skriv «Lagre» rett til fila som vart opna eller vald med «Lagre som»; elles blir «Lagre» ei nedlasting og «Opne fil» eit vanleg filval. localStorage held `{ overlegg, aktivt, ulagra, fil }` under `fagkart.<KODE>.markering`; «Lukk» tek kopien bort. Filhandtaket blir ikkje lagra, så etter omlasting lastar «Lagre» ned til «Lagre som» er brukt. Ingen nettverkskall, ingenting i URL-en. Tilbyr `overlegg()` (overlegget slik det blir lagra) og `dekningTekst()`. Testar i `test/markering.browser.test.mjs`. |
| Stiar | `lag/stiar.js` | Éin aktiv sti om gongen, frå to kjelder. (a) Nodekortet har den lukka seksjonen «Kva må eg kunne før dette?» (`prerequisiteChain` i lærerekkjefølgje, forkunnskapsnodar med grå merkelapp, i elevvisinga ein prikk med markeringa frå «Kva kan eg?»), og «Vis på kartet» gjer kjeda til sti. (b) «Løyper» i «Fleire val»: namn, skildring, målgruppe og tal steg frå `loeyper` i kartet; ei vald løype er sti, med stegliste og «Førre» / «Neste» (vel noden og sentrerer). På stien får nodane nummer 1…n som merke (`badge`, tone `new`; kjeda gir målnoden n+1) og resten tonar ut (`fade`); grå nabonodar i temavisinga får ingen nummer. Stien står til «Fjern sti» (i kortet og i «Fleire val») eller til eleven vel ein annan sti, og overlever val av andre nodar; han blir ikkje lagra. Prioritet `sti`, så merka vinn over eigenvurderinga sine, medan fyllfargen hennar står. Eit lite andre lag, `stiar-linje` (`cardSlot: 'top'`), set linja «Løype: …» med «Førre / Neste / Fjern sti» øvst i kortet, så stega er i rekkjevidd på mobil. Les berre markeringa (`ctx.layer('eigenvurdering').mark(id)`, berre i elevvisinga). Stega svarar `keep: true`, så ein vald node dimmar ikkje dei. Grense: nivå 2-nodar har nummer berre frå Detalj-zoom. Testar i `test/stiar.browser.test.mjs`. |

«Vis forkunnskapar» (to faste layoutar), lista over kompetansemål, lista over alle omgrep og metodar, «Lærar | Elev», val og søk høyrer til kjernen.
Laget «Kompetansemål» (kompetansemåla som eigne nodar) er fjerna: det fanst berre i «Alle nodar» og klyngjevisinga, som zoomflata og temavisinga har erstatta.

## Zoomflata (Tema · Kart · Detalj)
Éin flate, ikkje tre visingar. Posisjonane er faste og kjem frå `layout.mjs` ved bygging; nettlesaren berre teiknar dei.
Zoomen åleine avgjer nivået (`renderLevels` i `app.js`); knappane **Tema · Kart · Detalj** er snarvegar som flyg til eit nivå.

| Nivå | Zoom | Kva som er teikna |
|---|---|---|
| **Tema** | heile kartet i flata (`Z.t`) | ein boks per tema med namn, tal («4 omgrep · 2 metodar») og kompetansemål, med piler og tal mellom temaa |
| **Kart** | `Z.k` ≈ 1,5 × Tema, minst 0,9 | boksane har opna seg til områda sine og viser nivå 1 (omgrep og reglar) |
| **Detalj** | `Z.d` = 1,5 × Kart | nivå 2 kjem fram rundt omgrepa |

- Temaboksen er det same området som på Kart, berre mindre og midtstilt i området: han veks til området når ein zoomar inn,
  så plass og farge er dei same heile vegen. Eit klikk på ein temaboks, eller på temanamnet når boksen har opna seg, opnar temavisinga (sjå under).
- **Fargen** til eit tema er lagra deterministisk per tema-id (`temaSlot` i `src/tema.js`, ein av åtte Lektorodd-fargar), og er
  den same på temaboksen, området og plakaten. Forkunnskap er alltid grå.
- Pilene mellom temaboksane og pilene i kartet går i rette stykke rundt boksane (`route.js`): ingen pil går gjennom ein boks. Tala på temapilene er `byggjer_paa`-piler mellom temaa, og kvart tal er ein eigen liten boks (`mlab`) som er sett der han ikkje dekkjer ein boks eller eit anna tal.
- **Rutene** til pilene i kartet reknar bygginga ut (`layout.mjs`, `routes[<pil-id>]`, frå `fra`-noden til `til`-noden); sida teiknar dei med `round-segments`. Ei pil som ikkje fann ein veg blir meld som `problems` i layouten (og testen feilar).
- **Mobil:** layouten har eit eige par for ein telefon som står oppreist (`smal`, pakka for ei høg flate, `PORTRAIT_ASPECT`); sida vel det når skjermen er høgare enn brei (`max-aspect-ratio: 19/20`). Då får heile temanivået plass på skjermen.
- På Detalj med ein node vald: berre pilene til noden og pilene mellom naboane hans blir ståande, dei andre tonar ut.
- Rutenettet er vekke frå kartflata, og områda er dekkjande.
- Eit kart utan `nivaa` og `oversiktskantar` blir lagt ut «flatt»: alle nodar er nivå 1 og pilene deira teiknar kartet (`layout.mjs`).
- **Grensesnittet:** toppfeltet (namn, Tema · Kart · Detalj, søk, Lærar | Elev, Fleire val) og kartet; ingenting anna er synleg ved opning. «Fleire val» (`#side`) samlar fagval 1P/1T, vis forkunnskapar, implisitte piler, andre koplingar, filter, kompetansemål, lista over alt og «Skriv ut plakat», pluss kontrollane til laga. Teiknforklaringa er ein «?»-knapp nede til venstre i kartet. Nodekortet viser namn, type, forklaring, døme og «Lett å blande med» (`forvekslast_med`, lenkjer, berre når noden har det), og elles lukka seksjonar (misoppfatning, kompetansemål, kjerneelement, byggjer på, er grunnlag for, andre koplingar: brukar, døme på, representerast som); kva som er opna blir hugsa (`fagkart.opneSeksjonar`).
- Plakaten er Kart-nivået (`preparePoster`). Feilsøkingskroken `window.__fk` har m.a. `Z` (ankerzoomane), `KART.level` og `goLevel`.

## Temavisinga (eitt tema om gongen)
Zoomflata viser alle temaa på ein gong; temavisinga viser **eitt**: omgrepa og metodane i temaet store og lesbare, berre pilene som høyrer til,
og dei få nodane frå andre tema som temaet heng saman med, svakt grå. Dette er den gamle klyngjevisinga, men med same fargar og lag som resten.

- **Opning.** Klikk på ein temaboks (Tema-nivå), på temanamnet (Kart-nivå og Detalj), på temaet i nodekortet eller på eit av temaa i kompetansemål-kortet.
  `openTema(cid, { sel })` zoomar inn på temaet i flata og tonar over i temavisinga (ca. 0,4 s). Klikk på ein grå nabonode opnar temaet hans med noden vald.
  Val av ein node frå eit anna tema (lenkje i kortet, «Alle omgrep og metodar») gjer det same; **søk** etter ein node utanfor temaet går tilbake til zoomflata og flyg til noden.
- **Tilbake.** «‹ Alle tema» øvst, Escape når ingenting er valt (første Escape slepp valet), og knappane Tema · Kart · Detalj. `leaveTema({ level })` byggjer flata på nytt,
  står på temaet vi kom frå på Kart-zoom og glid ut til nivået. Med `prefers-reduced-motion` er alt dette utan glid og toning.
- **Innhald** (`temaMembers` i `src/kartkantar.js`, felles for bygginga og sida): alle nodane i temaet (nivå 1 og 2 saman), og nodar frå andre tema som temaet har ei
  **eksplisitt** `byggjer_paa`-pil til eller frå (grå; ein node på begge sider går dit han har flest piler). Pilene er alle piler mellom nodane i temaet (òg implisitte, som
  «Vis implisitte piler» styrer) og `byggjer_paa` til og frå dei grå. Ingen piler til kompetansemål, ingen mellom to grå. Pil-id-ane er `e<i>`, same som på flata.
- **Layout** (`temalayout.mjs`, ved bygging, aldri i nettlesaren): elkjs-lag frå venstre mot høgre i ei ramme i temafargen (`temaSlot`); grå føresetnader til venstre, grå
  «bygg på»-nodar til høgre, kvar køyrebane sortert etter nodane han heng på. Dei grå har namnet på temaet sitt under seg. Pilene blir rutte rundt alle boksar med `route.js`.
  Oppreist skjerm (`PORTRAIT_ASPECT`): same vising med retning ned (føresetnader øvst, grå over og under ramma). Layouten ligg som `tema[<tema-id>]` i kvar layout
  (full, `utanForkunnskap`, `smal` og `smal.utanForkunnskap`): `{ frame, nodes: { id: { x, y, w, h, lines, l, role, cap? } }, bounds, routes }`.
- **Laga verkar.** Same `nodeStyle`, `edgeStyle`, `nodeCard` osv. som på flata: forkunnskap 1P/1T (hol og «nytt for»-merke på nodane i temaet), filter (`fade`), implisitte piler,
  val av node og kompetansemål (pilene og naboane lyser, resten dimmar; kompetansemåla til temaet ligg som knappar i toppen), søk og elevvising. `ctx.tema` er id-en til temaet.
  Eit kompetansemål temaet ikkje dekkjer går til flata, der temaa som dekkjer det lyser.
- **Plakaten** er alltid flata (`preparePoster` går ut av temavisinga og opnar ho att etter utskrifta). Forkunnskap av: forkunnskap-temaet og dei grå forkunnskap-nodane er borte.
- Feilsøkingskroken `window.__fk` har `openTema`, `leaveTema`, `temaLayout` og `TV`; `state.tema` er temaet som er opna.

## Laga, og nokre som er planlagde
| Lag | Kva | Data |
|---|---|---|
| **Eigenvurdering** (innebygd, sjå over) | Eleven markerer *ikkje / delvis / heilt*; kartet farga etter det | overlegg `type: eigenvurdering`, skala ikkje/delvis/heilt |
| **Stiar** (innebygd, sjå over) | (a) «Kva må eg kunne før X?» — føresetnadskjeda til ein node, i lærerekkjefølgje; (b) *løyper* laga av lærar, t.d. «Repetisjon til eksamen», «Integrasjon på 3 veker»; (c) *snarvegar*: kortaste kjede mellom to nodar (ikkje laga) | (a)(c) rekna frå piler; (b) `loeyper.yaml` i kartet |
| **Neste steg** | Med eigenvurdering: «klar til å lære» = alle føresetnader *heilt*, sjølv ikkje; «svake punkt» = *ikkje/delvis* som mykje byggjer på | rekna |
| **Markering** (innebygd frå 15d, sjå over) | utbytbar skala: årsplan (planlagt / undervist / vurdert) eller eksamen (del 1 / del 2 / ikkje eigna / uavklart), sett (`omraade`), notat, dekning per kompetansemål; berre fil | overlegg `type: dekning` med `skala` og `skala_namn` |
| **Notat** | lappar, eigne piler, område | overlegg |

## Format som må vere klare før laga
- `fagkart-overlegg/1` (FORMAT.md § Overleggsformat): `type` (`eigenvurdering` | `dekning` | `notat`; eit lag les berre overlegg av sin type) og `oppdatert` (tidsstempel, for samanslåing) er med, begge valfrie. Løypeframdrift får ingen eigen type: han følgjer av eigenvurderinga.
- `loeyper.yaml` i kartmappa (FORMAT.md § Løyper): `id`, `namn`, `skildring`, `nodar` (ordna liste), valfri `maalgruppe`. Lint sjekkar at nodane finst; bygget har `loeyper` med prefiksa node-ID-ar.
- Stabile node-ID-ar og `kartversjon` i kvart overlegg (finst). Ved ny kartversjon: markeringar på ID-ar som ikkje finst i kartet (nye versjonar, utgåtte nodar) blir viste som «foreldrelause» og skrivne tilbake ved nedlasting, aldri sletta.
- **Eigenvurdering som overlegg:** `namn` er alltid «Mi eigenvurdering» (ingen namnefelt), `skala` er `["ikkje", "delvis", "heilt"]`, `merke` har ein verdi per bygd node-ID. Umarkert er *ukjend*, ikkje «ikkje». Lagringsnøkkel per kart: `fagkart.<KODE>.eigenvurdering` i localStorage held heile overleggsobjektet, så «Last ned» (`eigenvurdering-<KODE>-<ÅÅÅÅ-MM-DD>.json`) skriv det same objektet. Eldre lagring låg under læreplankoden (`fagkart.MAT04-02.eigenvurdering`). Når kartkoden er ulik læreplankoden og nøkkelen for kartkoden manglar, kopierer laget ved oppstart merka til noder med prefikset `<KODE>/` til den nye nøkkelen (ein gong; den gamle blir ståande, og vertsmodus rører ingenting). Test: `test/migrering.browser.test.mjs`.

## Integrasjonar
- **Frittståande HTML** (elev/lærar): éi fil, fungerer offline og innebygd i itslearning (iframe); overlegg i localStorage + «Last ned / Opne fil».
- **Elevlenkje:** `?vising=elev` i URL-en opnar sida i elevvisinga, `?vising=laerar` i lærarvisinga. Elevane får lenkja med `?vising=elev`, òg som `src` i ein iframe i itslearning. I elevvisinga står seksjonane «Kva kan eg?», «Neste steg» og «Løyper» øvst i «Fleire val» (opne), «Visning» er lukka og «Vis implisitte piler» skjult (`arrangeSide`); versjonen står under overskrifta og i hjelpeboksen, òg på mobil. Med `?vising=elev` er «Lærar | Elev» og linja «Elevvising er på» i kortet skjulte: elevane treng ikkje lærarvisinga. Det er rydding, ikkje lås (lærarteksten er fagstoff), og utan parameteren står bytet der. Valet i «Lærar | Elev» blir hugsa (`fagkart.vising` i localStorage); URL-parameteren vinn, og ei lenkje lagrar ikkje noko. Lenkja inneheld aldri elevdata. Elevane si eigenvurdering ligg berre i nettlesaren deira og kan lastast ned som fil; lærarvisinga les ikkje elevfiler. Er lagring blokkert (iframe, privat vindauge), seier laget det og peikar på «Last ned».
- **Gjennomgang for elevar** (`viewer/src/gjennomgang.js`, eiga fil som blir lagd inn av `build.mjs`): første gong sida er open i elevvisinga, lyser eit «spotlight» opp eitt område om gongen (tema-knappane, kartflata, «Kva kan eg?», «Fleire val», søk) med ei tekstboble og «Førre / Neste / Hopp over». Steg med skjult element blir hoppa over. Aldri i lærarvisinga eller vertsmodus. «Ferdig» og «Hopp over» lagrar `fagkart.gjennomgang` = `ferdig` (per side, ikkje per kart); er lagring blokkert, kjem han ikkje att i same økt. «Vis gjennomgangen» i hjelpeboksen («?») startar han att. Escape hoppar over, piltastar byter steg. Nettlesartestar som opnar elevvisinga set `ferdig` på førehand (`TOUR_DONE` i `test/browser.mjs`). Test: `test/gjennomgang.browser.test.mjs`.
- **Oppdatering og service worker** (`viewer/src/oppdatering.js` og `viewer/src/sw.js`, begge frå `build.mjs`): adressa til utlegginga ligg i `publisering.json` (`https://fagkart.lektorodd.no/`), og i sida blir adressa til kartet si mappe bygd inn (`<adresse><kode med små bokstavar>/`, t.d. `…/s2/`); `build.mjs` skriv `dist/<KODE>.versjon.json` (`{ kart, versjon, fil }`), `dist/sw.js` og `dist/index.html` (flatt, for lokal bruk), og `dist/publiser/` slik mappa ligg på nettet (`index.html`, `sw.js`, `<sti>/index.html`, `<sti>/<KODE>.versjon.json`, `<sti>/sw.js`; ikkje i git). På ei hosta side (http/https) registrerer `oppdatering.js` `./sw.js`: han svarar frå cachen `fagkart` og hentar sida på nytt i bakgrunnen (stale-while-revalidate; cache-nøkkelen utan spørjestreng, så `?vising=elev` og `?vising=laerar` deler kopi), unntatt `*.versjon.json` som alltid går til nettet. Første besøk blir lagra ved at sida sender `{ type: 'fagkart:oppdater', url }`; same melding frå «Last på nytt» gir ei fersk kopi og svaret `{ type: 'fagkart:oppdatert' }`, så lastar sida om (seinast etter 3 s). Sida les `./<KODE>.versjon.json` (`cache: 'no-store'`) når kartet er klart, høgst éin gong i timen (`fagkart.<KODE>.versjonsjekk`); er versjonen nyare (tal for tal, «2026.10» > «2026.2»; ikkje lesbar og ulik = nyare), kjem stripa `#oppdatering` (`role="status"`) med «Last på nytt» og «Seinare» (skjult resten av økta). Ei nedlasta kopi (`file://`) sjekkar berre når adressa er sett, og stripa har då lenkja «Opne ny versjon» til kartet si mappe på nettet. Alle feil er stille, offline blir det ikkje sendt førespurnad, og i vertsmodus (`?vising=faglogg`) skjer ingenting. Test: `test/oppdatering.browser.test.mjs`.
- **Kva er nytt** (`viewer/src/endringar.js`, `app.js` `renderNytt`, `dist/<KODE>.endringar.json` frå `scripts/endringar.py`; FORMAT.md § Endringar og § Endringslogg): `build.mjs` legg fila inn som `<script id="fagkart-endringar">` (`null` når kartet ikkje har logg) og kopierer ho til `publiser/<sti>/`. Hjelpeboksen («?») har `#nytt` etter versjonslinja: «Kva er nytt i <versjon>», dato og samandrag, så listene «Nytt», «Endra» og «Sletta» (over ti rader viser dei åtte første og «Vis n til») med nodenamn som knappar (`linkbtn`) som vel noden (`select`; hjelpeboksen lukkar seg, og ein skjult forkunnskapsnode får «Vis forkunnskapar» på) og «n nye piler · m fjerna». Sletta nodar er vanleg tekst. Eldre versjonar ligg i `<details>` «Tidlegare versjonar», og ein versjon utan utrekna lister (`utrekna: false`) viser berre samandraget. I lærarvisinga står feltnamna etter namnet i «Endra»; elevvisinga har dei same listene utan feltnamn. Boksen blir teikna på nytt når «Lærar | Elev» byter. `endringarView(data, { elev })` i `endringar.js` er ei rein funksjon (testa utan nettlesar); DOM-en ligg i `app.js`. Stripa «Ny versjon» (neste punkt) har knappen «Kva er nytt»: han gjer det same som «Last på nytt» og set `sessionStorage['fagkart.nytt'] = '1'`; ved start fjernar sida nøkkelen og opnar hjelpeboksen med «Kva er nytt» i synsfeltet. Knappen finst berre på ei hosta side (ikkje i ei nedlasta kopi). Testar: `test/endringar.test.mjs`, `test/endringar.browser.test.mjs`, `test/oppdatering.browser.test.mjs`.

