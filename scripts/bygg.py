"""Build dist/<KODE>.json from kart/<KODE>/ (format: docs/FORMAT.md, "Byggformat")."""
import json
import sys
from pathlib import Path

import jsonschema

import endringar
import lint
from fagkart import EDGE_FIELDS, ROOT, load_kart, load_schema


def empty(v):
    return v is None or v == "" or v == [] or v == {}


def clean(d):
    return {k: v for k, v in d.items() if not empty(v)}


def mark_implied(edges):
    """Flag byggjer_paa edges already implied by a longer prerequisite chain
    (transitive reduction), so viewers can hide them. Data is kept as written."""
    g = {}
    for e in edges:
        if e["type"] == "byggjer_paa":
            g.setdefault(e["fra"], set()).add(e["til"])

    def reachable(start, skip):
        seen, stack = set(), [t for t in g.get(start, ()) if t != skip]
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack.extend(g.get(x, ()))
        return seen

    for e in edges:
        if e["type"] == "byggjer_paa" and e["til"] in reachable(e["fra"], e["til"]):
            e["implisitt"] = True


def overview_edges(nodes, edges):
    """byggjer_paa between nivaa-1 nodes, contracted through hidden nivaa-2 nodes and
    transitively reduced, plus forvekslast_med between nivaa-1 nodes."""
    lvl1 = {n["id"] for n in nodes if n.get("nivaa") == 1}
    g = {}
    for e in edges:
        if e["type"] == "byggjer_paa":
            g.setdefault(e["fra"], set()).add(e["til"])

    def first_visible(start):
        found, seen, stack = set(), set(), list(g.get(start, ()))
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            if x in lvl1:
                found.add(x)
            else:
                stack.extend(g.get(x, ()))
        return found

    c = {a: first_visible(a) for a in lvl1}

    def reach(a, skip):
        seen, stack = set(), [t for t in c[a] if t != skip]
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack.extend(c.get(x, ()))
        return seen

    out = [{"fra": a, "til": b, "type": "byggjer_paa"}
           for a in sorted(lvl1) for b in sorted(c[a]) if b not in reach(a, b)]
    out += [{"fra": e["fra"], "til": e["til"], "type": "forvekslast_med"} for e in edges
            if e["type"] == "forvekslast_med" and e["fra"] in lvl1 and e["til"] in lvl1]
    return out


def bygg(kart):
    """Return the dist model (a dict) for a map that passed lint."""
    kode, pre = kart.kode, f"{kart.kode}/"
    nodes, edges, seen = [], [], set()

    def edge(fra, til, typ):
        # forvekslast_med is symmetric: A-B and B-A are the same edge
        key = (frozenset((fra, til)) if typ == "forvekslast_med" else (fra, til), typ)
        if key not in seen:
            seen.add(key)
            edges.append({"fra": fra, "til": til, "type": typ})

    for km in kart.meta["kompetansemaal"]:
        nodes.append(clean({"id": pre + km["id"], "type": "kompetansemaal", "namn": km["id"],
                            "tekst": km["tekst"], "verb": km.get("verb"), "klynge": km["klynge"],
                            "udir_kode": km.get("udir_kode")}))
    for _, klynge, n in kart.nodes():
        head = {"id": pre + n["id"], "type": n["type"], "namn": n["namn"], "klynge": klynge}
        rest = {k: v for k, v in n.items() if k not in head and k not in EDGE_FIELDS}
        rest["km"] = [pre + k for k in n.get("km") or []]
        nodes.append(clean({**head, **rest}))
        for fld in EDGE_FIELDS:
            for target in n.get(fld) or []:
                edge(pre + n["id"], pre + target, fld)
        for k in n.get("km") or []:
            edge(pre + n["id"], pre + k, "dekkjer")

    mark_implied(edges)
    meta = kart.meta
    klyngjer = [{"id": d["klynge"], "namn": d.get("namn") or d["klynge"]}
                for rel, d in kart.files
                if not rel.endswith("/meta.yaml") and isinstance(d, dict) and d.get("klynge")]
    loeyper = [clean({"id": r["id"], "namn": r["namn"], "skildring": r.get("skildring"),
                      "maalgruppe": r.get("maalgruppe"), "nodar": [pre + n for n in r["nodar"]]})
               for r in kart.loeyper]
    dist = clean({"format": "fagkart/1", "kode": kart.kode, "laereplan": meta["laereplan"], "namn": meta["namn"],
                  "versjon": meta["versjon"], "forkunnskapsfag": meta.get("forkunnskapsfag"),
                  "kjerneelement": meta["kjerneelement"], "klyngjer": klyngjer, "nodar": nodes, "kantar": edges, "loeyper": loeyper,
                  "oversiktskantar": overview_edges(nodes, edges) if any(n.get("nivaa") == 1 for n in nodes) else None})
    jsonschema.Draft202012Validator(load_schema("fagkart")).validate(dist)
    return dist


def main(argv=None, root=ROOT):
    argv = sys.argv[1:] if argv is None else argv
    codes = lint.select_codes(argv, root)
    if not codes:
        print("Fann ingen kart (kart/<KODE>/meta.yaml).")
        return 0
    failed = False
    for kode in codes:
        if not (Path(root) / "kart" / kode / "meta.yaml").is_file():
            print(f"FEIL   kart/{kode}/meta.yaml  fila finst ikkje")
            failed = True
            continue
        kart = load_kart(kode, root)
        if lint.report(kode, lint.lint_kart(kart)):
            print(f"{kode}: byggjer ikkje på grunn av feil")
            failed = True
            continue
        dist = bygg(kart)
        out = Path(root) / "dist" / f"{kode}.json"
        out.parent.mkdir(exist_ok=True)
        out.write_text(json.dumps(dist, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{out.relative_to(root).as_posix()}: {len(dist['nodar'])} nodar, {len(dist['kantar'])} kantar")
        if kart.endringar_file:  # the version log, compared with the tagged build of the version before
            log = endringar.skriv(kode, root)
            print(f"{log.relative_to(root).as_posix()}: {len(kart.endringar)} {'versjon' if len(kart.endringar) == 1 else 'versjonar'}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
