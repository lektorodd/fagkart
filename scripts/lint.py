"""Lint fagkart source maps. Implements docs/FORMAT.md, "Reglar som lint sjekkar"."""
import datetime
import re
import sys
from collections import Counter, namedtuple
from pathlib import Path

import jsonschema

from fagkart import EDGE_FIELDS, ROOT, kart_dirs, load_kart, load_schema

Finding = namedtuple("Finding", "level file subject msg")
# Math must be LaTeX ($...$ inline, $$...$$ display). These characters outside
# math and `code` mean quasi-text math.
QUASI_MATH = re.compile(r"[²³¹⁰⁴-⁹ⁿ₀-₉ₙᵢₖₐ√Σ∑≤≥≈≠·×−∫′″∩∪\u0391-\u03a9\u03b1-\u03c9∞\u0304\u0302]")
MATH_OR_CODE = re.compile(r"\$\$.*?\$\$|\$[^$]*\$|`[^`]*`", re.S)


def math_problems(text):
    """Return (unbalanced, quasi_chars) for one text field."""
    if not text:
        return False, []
    stripped = MATH_OR_CODE.sub("", text)
    unbalanced = "$" in stripped
    return unbalanced, sorted(set(QUASI_MATH.findall(stripped)))


BOKMAAL = re.compile(r"\b(rekker|rekkene|ikke|hvis|hvordan|hva|hvor|mye|noen|jeg|være|dere|mens|bruker|trekker|retter|gjentatt|vera|tar|siden|trekning)\b", re.IGNORECASE)
TEXT_FIELDS = ["tekst_laerar", "tekst_elev", "doeme", "misoppfatning"]
KJELDE_LINE = re.compile(r"^\s*(?:[-*]\s+)?(km[0-9]{2}):\s*(.*)$")


def norm(s):
    return " ".join(str(s).split())


def quote(items):
    return ", ".join(f"«{i}»" for i in items)


def describe(err):
    """Nynorsk text for a jsonschema error."""
    if err.validator == "additionalProperties":
        return "ukjend felt " + quote(sorted(set(err.instance) - set(err.schema.get("properties", {}))))
    if err.validator == "required":
        return "manglar felt " + quote(k for k in err.validator_value if k not in err.instance)
    if err.validator == "enum":
        return f"ugyldig verdi «{err.instance}», lov: {', '.join(map(str, err.validator_value))}"
    if err.validator == "pattern":
        return f"ugyldig verdi «{err.instance}»"
    if err.validator == "type":
        return f"feil type, venta {err.validator_value}"
    return err.message


def schema_findings(rel, data, schema):
    validator = jsonschema.Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(data), key=lambda e: [str(p) for p in e.absolute_path]):
        path, subject = list(err.absolute_path), ""
        if path[:1] in (["nodar"], ["loeyper"]) and len(path) > 1 and isinstance(path[1], int):
            key = path[0]
            node = data[key][path[1]]
            subject = node["id"] if isinstance(node, dict) and isinstance(node.get("id"), str) and path[2:] != ["id"] else f"{key}[{path[1]}]"
            path = path[2:]
        where = ".".join(map(str, path))
        yield Finding("FEIL", rel, subject, (where + ": " if where else "") + describe(err))


def find_cycles(graph):
    """Return cycles in a {node: [targets]} graph, each as a path ending where it started."""
    cycles, state, stack = [], {}, []

    def visit(n):
        state[n] = 1
        stack.append(n)
        for m in graph.get(n, []):
            if state.get(m) == 1:
                cycles.append(stack[stack.index(m):] + [m])
            elif m not in state:
                visit(m)
        stack.pop()
        state[n] = 2

    for n in graph:
        if n not in state:
            visit(n)
    return cycles


def lint_kart(kart):
    out = []

    def add(level, file, subject, msg):
        out.append(Finding(level, file, subject, msg))

    for rel, msg in kart.errors:
        add("FEIL", rel, "", msg)
    for rel, data in kart.files:  # rule 1: schema and IDs
        name = "kjelde-meta" if rel.endswith("/meta.yaml") else "kjelde-klynge"
        out.extend(schema_findings(rel, data, load_schema(name)))
    if kart.loeyper_file:
        out.extend(schema_findings(*kart.loeyper_file, load_schema("kjelde-loeyper")))
    if kart.endringar_file:
        out.extend(schema_findings(kart.endringar_file[0], iso_dates(kart.endringar_file[1]), load_schema("kjelde-endringar")))
    if out:  # the checks below assume schema-valid input
        return out

    meta, meta_file = kart.meta, kart.files[0][0]
    kms = meta["kompetansemaal"]
    km_ids = {km["id"] for km in kms}
    nodes = list(kart.nodes())
    by_id = {}
    for rel, _, n in nodes:
        by_id.setdefault(n["id"], (rel, n))

    # Rule 2: duplicate IDs (kompetansemaal and nodes share one namespace)
    seen = {}
    for rel, i in [(meta_file, km["id"]) for km in kms] + [(rel, n["id"]) for rel, _, n in nodes]:
        if i in seen:
            add("FEIL", rel, i, f"ID finst fleire gonger (første gong i {seen[i]})")
        seen.setdefault(i, rel)

    # Rules 3 and 4: references, self-edges, cycles in byggjer_paa
    graph = {}
    for rel, _, n in nodes:
        for km in n.get("km") or []:
            if km not in km_ids:
                add("FEIL", rel, n["id"], f"km peikar på ukjend kompetansemål «{km}»")
        for fld in EDGE_FIELDS:
            for target in n.get(fld) or []:
                if target == n["id"]:
                    add("FEIL", rel, n["id"], f"{fld} peikar på noden sjølv")
                elif target not in by_id:
                    add("FEIL", rel, n["id"], f"{fld} peikar på ukjend node «{target}»")
                elif fld == "byggjer_paa":
                    graph.setdefault(n["id"], []).append(target)
    for cycle in find_cycles(graph):
        add("FEIL", by_id[cycle[0]][0], cycle[0], "sirkel i byggjer_paa: " + " → ".join(cycle))

    # Rule 5 and warning "færre enn 3 nodar"
    counts = Counter(km for _, _, n in nodes for km in n.get("km") or [])
    for km in kms:
        c = counts[km["id"]]
        if c == 0:
            add("FEIL", meta_file, km["id"], "ingen nodar")
        elif c < 3:
            add("ÅTVARING", meta_file, km["id"], f"berre {c} {'node' if c == 1 else 'nodar'}")

    built_on = {t for _, _, n in nodes for t in n.get("byggjer_paa") or []}
    uses_forkjennskap = any(n.get("forkjennskap") is not None for _, _, n in nodes)
    for rel, _, n in nodes:
        if n.get("forkunnskap") is None:
            # Rule 6: subject-internal node needs these fields
            missing = [f for f in ["km", "verbnivaa", "tekst_laerar", "tekst_elev"] if not n.get(f)]
            if missing:
                add("FEIL", rel, n["id"], "manglar " + ", ".join(missing))
            # Warning: once a map uses forkjennskap, every in-subject node must decide explicitly
            if uses_forkjennskap and n.get("forkjennskap") is None:
                add("ÅTVARING", rel, n["id"], "manglar forkjennskap (kartet brukar forkjennskap)")
            # Rule 10: forkjennskap (prior exposure to an in-subject node) covers every subject
            if n.get("forkjennskap") is not None:
                gaps = [f for f in meta.get("forkunnskapsfag") or [] if f not in n["forkjennskap"]]
                if gaps:
                    add("FEIL", rel, n["id"], "forkjennskap manglar verdi for " + ", ".join(gaps))
        elif n.get("forkjennskap") is not None:
            add("FEIL", rel, n["id"], "forkjennskap er berre for nodar i faget; bruk forkunnskap")
        else:
            # Rule 7: a value for every prior-knowledge subject
            gaps = [f for f in meta.get("forkunnskapsfag") or [] if f not in n["forkunnskap"]]
            if gaps:
                add("FEIL", rel, n["id"], "forkunnskap manglar verdi for " + ", ".join(gaps))
            # Rule 8: someone must build on it
            if n["id"] not in built_on:
                add("FEIL", rel, n["id"], "ingen node byggjer på denne forkunnskapsnoden")
        # Warnings
        lacking = [f for f in ["doeme", "misoppfatning"] if not n.get(f)]
        if lacking:
            add("ÅTVARING", rel, n["id"], "manglar " + " og ".join(lacking))
        if len(n.get("tekst_elev") or "") > 300:
            add("ÅTVARING", rel, n["id"], f"tekst_elev er {len(n['tekst_elev'])} teikn (maks 300)")
        for fld in TEXT_FIELDS + ["namn"]:
            unbalanced, quasi = math_problems(n.get(fld))
            if unbalanced:
                add("FEIL", rel, n["id"], f"ubalansert $ i {fld}")
            if quasi:
                add("FEIL", rel, n["id"], f"kvasimatte i {fld} (bruk LaTeX): {' '.join(quasi)}")
        for fld in TEXT_FIELDS:
            words = sorted({w.lower() for w in BOKMAAL.findall(n.get(fld) or "")})
            if words:
                add("ÅTVARING", rel, n["id"], f"bokmålsord i {fld}: {', '.join(words)}")

    check_loeyper(kart, by_id, graph, add)
    check_endringar(kart, add)
    check_kjelder(kart, meta_file, add)
    return sorted(out, key=lambda f: f.level != "FEIL")  # errors first, stable otherwise


def check_loeyper(kart, by_id, graph, add):
    """Rules for loeyper.yaml (routes): see docs/FORMAT.md, "Løyper". Input is schema-valid."""
    if not kart.loeyper_file:
        return
    rel = kart.loeyper_file[0]
    fag = set(kart.meta.get("forkunnskapsfag") or [])

    def below(start):
        """Every node `start` builds on, directly or through a chain."""
        seen, stack = set(), list(graph.get(start, []))
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack.extend(graph.get(x, []))
        return seen

    ids = Counter(r["id"] for r in kart.loeyper)
    for rid, c in ids.items():
        if c > 1:
            add("FEIL", rel, rid, f"løype-ID finst {c} gonger")
    for r in kart.loeyper:
        rid, nodar = r["id"], r["nodar"]
        if len(nodar) < 2:
            add("FEIL", rel, rid, f"løypa har {len(nodar)} {'node' if len(nodar) == 1 else 'nodar'} (minst 2)")
        unknown = [n for n in dict.fromkeys(nodar) if n not in by_id]
        if unknown:
            add("FEIL", rel, rid, "peikar på nodar som ikkje finst i kartet: " + quote(unknown))
        twice = [n for n, c in Counter(nodar).items() if c > 1]
        if twice:
            add("FEIL", rel, rid, "same node fleire gonger: " + quote(twice))
        bad = [g for g in r.get("maalgruppe") or [] if g not in fag]
        if bad:
            add("FEIL", rel, rid, f"maalgruppe med fag som ikkje står i forkunnskapsfag: {quote(bad)}")
        for i, n in enumerate(nodar):  # warning: a node placed before a node it builds on
            later = [m for m in dict.fromkeys(nodar[i + 1:]) if m in below(n)] if n in by_id else []
            if later:
                add("ÅTVARING", rel, rid, f"«{n}» står før {quote(later)}, som han byggjer på")
        gone = [n for n in dict.fromkeys(nodar) if n in by_id and by_id[n][1].get("utgaatt")]
        if gone:
            add("ÅTVARING", rel, rid, "inneheld utgåtte nodar: " + quote(gone))


def iso_dates(data):
    """endringar.yaml with each YAML date (dato: 2026-10-29) as its ISO string, so the schema sees one type."""
    entries = data.get("endringar") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return data
    fixed = [{**e, "dato": e["dato"].isoformat()} if isinstance(e, dict) and isinstance(e.get("dato"), datetime.date) else e for e in entries]
    return {**data, "endringar": fixed}


def check_endringar(kart, add):
    """Rules for endringar.yaml (version log): see docs/FORMAT.md, "Endringar". Input is schema-valid."""
    if not kart.endringar_file:
        return
    rel = kart.endringar_file[0]
    entries = iso_dates(kart.endringar_file[1])["endringar"]
    if entries[0]["versjon"] != kart.meta["versjon"]:
        add("FEIL", rel, "", f"øvste versjon i endringar.yaml ({entries[0]['versjon']}) er ikkje lik versjon i meta.yaml ({kart.meta['versjon']})")
    for v, c in Counter(e["versjon"] for e in entries).items():
        if c > 1:
            add("FEIL", rel, v, f"versjonen finst {c} gonger")
    for e in entries:
        try:
            datetime.date.fromisoformat(e["dato"])
        except ValueError:
            add("FEIL", rel, e["versjon"], f"dato «{e['dato']}» er ikkje ei gyldig dato (ÅÅÅÅ-MM-DD)")


def check_kjelder(kart, meta_file, add):
    """Rule 9: each kompetansemål text in meta.yaml appears verbatim in kjelder/<KODE>.md."""
    path = kart.root / "kjelder" / f"{kart.kode}.md"
    rel = path.relative_to(kart.root).as_posix()
    if not path.is_file():
        add("FEIL", rel, "", "fila manglar, kompetansemåla kan ikkje sjekkast mot kjelda")
        return
    source = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = KJELDE_LINE.match(line)
        if m:
            source.setdefault(m[1], norm(m[2]))
    for km in kart.meta["kompetansemaal"]:
        want, have = source.get(km["id"]), norm(km["tekst"])
        if want is None:
            add("FEIL", meta_file, km["id"], f"finst ikkje i {rel}")
        elif have != want:
            i = next((i for i, (a, b) in enumerate(zip(have, want)) if a != b), min(len(have), len(want)))
            add("FEIL", meta_file, km["id"],
                f"teksten er ikkje ordrett som i {rel}; første skilnad ved teikn {i + 1}: "
                f"meta «{have[i:i + 20]}» mot kjelde «{want[i:i + 20]}»")


def report(kode, findings, write=print):
    """Print findings and the summary line; return the number of errors."""
    for f in findings:
        label = "FEIL   " if f.level == "FEIL" else "ÅTVARING  "
        write(f"{label}{f.file}  {f.subject + ': ' if f.subject else ''}{f.msg}")
    errors = sum(f.level == "FEIL" for f in findings)
    warns = len(findings) - errors
    write(f"{kode}: {errors} feil, {warns} {'åtvaring' if warns == 1 else 'åtvaringar'}")
    return errors


def select_codes(argv, root):
    """Codes from argv (a code or a kart/<KODE> path), else every map with a meta.yaml."""
    codes = [Path(a.rstrip("/")).name for a in argv]
    return codes or kart_dirs(root)


def main(argv=None, root=ROOT):
    argv = sys.argv[1:] if argv is None else argv
    codes = select_codes(argv, root)
    if not codes:
        print("Fann ingen kart (kart/<KODE>/meta.yaml).")
        return 0
    failed = False
    for kode in codes:
        if not (Path(root) / "kart" / kode / "meta.yaml").is_file():
            print(f"FEIL   kart/{kode}/meta.yaml  fila finst ikkje")
            failed = True
            continue
        failed |= report(kode, lint_kart(load_kart(kode, root))) > 0
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
