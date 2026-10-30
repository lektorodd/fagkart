# Lag eit eige fagkart

Eitt kart er éi mappe med YAML-filer. Skriptet `scripts/lint.py` sjekkar dei, `scripts/bygg.py` gjer dei om til éi JSON-fil, og `viewer/` lagar éi frittståande HTML-side av henne. Dataformatet står i [`FORMAT.md`](FORMAT.md): les det før du skriv noko, det er kontrakten.

## Før du byrjar

```
pip install -r requirements.txt
cd viewer && npm ci
```

Ha læreplanen du vil kartleggje ved hand, og vit kva fag elevane kjem frå (til dømes 1P og 1T før S2).

## Stega

1. **Vel ein kartkode.** Han blir namnet på mappa: `kart/<KODE>/`. Han treng ikkje vere lik læreplankoden. S1 og S2 deler til dømes `MAT04-02`, men har kvar sitt kart.

2. **Lag `kart/<KODE>/meta.yaml`.** Han har læreplankode (`laereplan`), `namn`, `versjon`, lenkje til kjelda (`kjelde`), kva fag elevane kan kome frå (`forkunnskapsfag`), kjerneelementa og kompetansemåla med ID `km01`, `km02` … i rekkjefølgja i læreplanen. Kvart kompetansemål har `tekst`, `verb` og `klynge` (tema). Sjå `kart/S2/meta.yaml` som døme.

3. **Legg læreplanteksten ordrett i `kjelder/<KODE>.md`**, éitt kompetansemål per linje: `- km01: <tekst>`. Skriv kjelda øvst («Kjelde: Utdanningsdirektoratet, <lenkje>»). Kompetansemåla i `meta.yaml` må stå ordrett som her; lint feilar elles. Du skal aldri omskrive dei.

4. **Skriv éi klyngjefil per tema** (`kart/<KODE>/<klynge>.yaml`). Kvar node har ein ID som aldri blir endra (nytt namn = endra `namn`, borte = `utgaatt: true`), ein type, kva kompetansemål han tener, ein tekst for læraren og ein for eleven, eit døme og ei vanleg misoppfatning, og kva han byggjer på (`byggjer_paa`). Sjå ei ferdig fil i `kart/S2/` som mal.

5. **Skriv `forkunnskap.yaml`:** det faget føreset at eleven kan frå før, med `ja`, `delvis` eller `nei` for kvart forkunnskapsfag. Kjeldene for vurderinga ligg òg i `kjelder/`.

6. **Valfritt:** `loeyper.yaml` (løyper, t.d. «Repetisjon til eksamen») og `endringar.yaml` (versjonslogg som blir til «Kva er nytt» i sida).

7. **Køyr lint og bygg.**

   ```
   python3 scripts/lint.py <KODE>
   python3 scripts/bygg.py <KODE>
   cd viewer && npm run build
   ```

   Lint stoppar på feil (sirkel i `byggjer_paa`, ukjende ID-ar, kompetansemål som ikkje står ordrett i kjelda) og åtvarar om det som manglar (døme, misoppfatning, få nodar per kompetansemål). Reglane står i [`FORMAT.md`](FORMAT.md) § Reglar som lint sjekkar. Resultatet er `dist/<KODE>.json` og `dist/<KODE>.html`.

8. **Opne `dist/<KODE>.html`** i nettlesaren. Matematikk skriv du som LaTeX (`$…$`), sjå `FORMAT.md` § Matematikk i tekst; `cd viewer && node check-latex.mjs <KODE>` sjekkar at alt lèt seg rendre.

## Metoden med agentane

Kartet til S2 vart laga i ein fast arbeidsgang der ein person styrer og KI-agentar gjer delarbeid. Agentane ligg i `.claude/agents/` og er laga for [Claude Code](https://claude.com/claude-code):

- `kjeldeuttrekk` hentar læreplanteksten ordrett og legg han i `kjelder/`. Han gjer mekanisk arbeid og vurderer ingenting.
- `kartutkast` fyller ut éi klyngjefil om gongen etter ei nodeliste og ei ferdig fil som mal.
- `fagreview` les kartet med friske auge: manglar føresetnader, stemmer forkunnskapsmerkinga med læreplanane, er teksten fagleg rett. Han endrar ikkje filer, berre rapporterer.

Mennesket bestemmer nodane og rekkjefølgja, les det agentane skriv, og avgjer kva som blir retta. Lint og testar er sikringa mot at agentar finn på ting eller endrar noko dei ikkje skulle: kompetansemåla må stå ordrett, ID-ar blir aldri endra, og fagstoff ein ikkje er sikker på skal merkast `delvis` heller enn å gjettast.
