"""Version log of a map: what is new, changed and deleted since the version before (docs/FORMAT.md, "Endringar").

Reads kart/<KODE>/endringar.yaml, compares the built dist/<KODE>.json with the one at the git tag <KODE>-<previous version>
and writes dist/<KODE>.endringar.json. Without that tag (or without an older entry) a version has only its summary.
Usage: python3 scripts/endringar.py [KODE ...]"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

import lint
from fagkart import ROOT, load_kart

FORMAT = "fagkart-endringar/1"
# The fields of a node whose change counts as "endra", in output order. A missing field counts as empty.
FIELDS = ["namn", "tekst_laerar", "tekst_elev", "doeme", "misoppfatning", "nivaa", "verbnivaa", "forkjennskap", "km", "klynge"]


def _empty(v):
    return v is None or v == "" or v == [] or v == {}


def _live(dist):
    """{id: node} of the nodes that are in the map (not utgaatt), in file order. Competence goals count as nodes."""
    return {n["id"]: n for n in (dist or {}).get("nodar") or [] if not n.get("utgaatt")}


def _edge_key(e):
    # forvekslast_med is symmetric: A-B and B-A are the same edge
    return (tuple(sorted((e["fra"], e["til"]))) if e["type"] == "forvekslast_med" else (e["fra"], e["til"]), e["type"])


def diff(old, new):
    """What differs between two built maps (dist dicts): {nye, endra, sletta, kantar: {nye, fjerna}}.
    nye: {id, namn, tema}; endra: {id, namn, felt}; sletta: {id, namn} (utgaatt or gone); kantar: {fra, til, type} between
    nodes that are in the map on both sides. Everything else in the files (rom, loeyper, ...) is ignored."""
    a, b = _live(old), _live(new)
    nye = [{"id": i, "namn": n["namn"], "tema": n.get("klynge") or ""} for i, n in b.items() if i not in a]
    sletta = [{"id": i, "namn": n["namn"]} for i, n in a.items() if i not in b]
    endra = []
    for i, n in b.items():
        if i in a:
            felt = [f for f in FIELDS if (None if _empty(a[i].get(f)) else a[i].get(f)) != (None if _empty(n.get(f)) else n.get(f))]
            if felt:
                endra.append({"id": i, "namn": n["namn"], "felt": felt})
    both = a.keys() & b.keys()

    def edges(dist):
        return {_edge_key(e): {"fra": e["fra"], "til": e["til"], "type": e["type"]}
                for e in (dist or {}).get("kantar") or [] if e["fra"] in both and e["til"] in both}

    ea, eb = edges(old), edges(new)
    order = lambda e: (e["fra"], e["til"], e["type"])  # noqa: E731
    return {"nye": nye, "endra": endra, "sletta": sletta,
            "kantar": {"nye": sorted((v for k, v in eb.items() if k not in ea), key=order),
                       "fjerna": sorted((v for k, v in ea.items() if k not in eb), key=order)}}


def git_dist(kode, versjon, root):
    """dist/<KODE>.json as it was at the tag <KODE>-<versjon>, or None when there is no such tag (or no git)."""
    try:
        r = subprocess.run(["git", "show", f"{kode}-{versjon}:dist/{kode}.json"], cwd=root, capture_output=True, check=False)
        return json.loads(r.stdout.decode("utf-8")) if r.returncode == 0 else None
    except (OSError, ValueError):
        return None


def _iso(d):
    return d.isoformat() if isinstance(d, (datetime.date, datetime.datetime)) else str(d)


def utrekna(kode, root, entries, hent=git_dist, kjende=None):
    """The versions of endringar.yaml (newest first) as dist entries. The newest is compared with dist/<KODE>.json, an older
    one with the tag of its own version; the one before is the next entry. `hent(kode, versjon, root)` fetches a tagged dist.
    `kjende` ({versjon: entry}, the computed entries of the log built before) fills in a version whose tags are missing."""
    kjende = kjende or {}
    root = Path(root)
    current = json.loads((root / "dist" / f"{kode}.json").read_text(encoding="utf-8"))
    out = []
    for i, e in enumerate(entries):
        row = {"versjon": str(e["versjon"]), "dato": _iso(e["dato"]), "samandrag": e["samandrag"]}
        if e.get("etter_innspel") is not None:
            row["etter_innspel"] = e["etter_innspel"]
        row["utrekna"] = False
        before = entries[i + 1]["versjon"] if i + 1 < len(entries) else None
        if before is not None:  # the oldest version has nothing to compare with: its summary is all there is
            new = current if i == 0 else hent(kode, e["versjon"], root)
            old = hent(kode, before, root)
            missing = [f"{kode}-{v}" for v, d in ((e["versjon"], new), (before, old)) if d is None]
            if missing and row["versjon"] in kjende:  # a copy without the tags (the open repo): the lists of the build before
                row.update({k: kjende[row["versjon"]][k] for k in ("utrekna", "nye", "endra", "sletta", "kantar")})
            elif missing:
                print(f"{kode}: taggen {' og '.join(missing)} finst ikkje, versjon {e['versjon']} har berre samandrag", file=sys.stderr)
            else:
                row.update(utrekna=True, **diff(old, new))
        out.append(row)
    return out


def skriv(kode, root=ROOT, hent=git_dist):
    """Write dist/<KODE>.endringar.json (needs dist/<KODE>.json and kart/<KODE>/endringar.yaml). Returns the file's path, or None."""
    kart = load_kart(kode, root)
    if not kart.endringar_file:
        return None
    out = Path(root) / "dist" / f"{kode}.endringar.json"
    try:
        kjende = {v["versjon"]: v for v in json.loads(out.read_text(encoding="utf-8"))["versjonar"] if v.get("utrekna")}
    except (OSError, ValueError, KeyError, TypeError):
        kjende = {}
    doc = {"format": FORMAT, "kart": kode, "versjonar": utrekna(kode, root, kart.endringar, hent, kjende)}
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


def short(i, kode):
    return i[len(kode) + 1:] if i.startswith(kode + "/") else i


def main(argv=None, root=ROOT):
    argv = sys.argv[1:] if argv is None else argv
    codes = lint.select_codes(argv, root)
    for kode in codes:
        if not (Path(root) / "kart" / kode / "meta.yaml").is_file():
            print(f"FEIL   kart/{kode}/meta.yaml  fila finst ikkje")
            return 1
        kart = load_kart(kode, root)
        if not kart.endringar_file:
            print(f"{kode}: ingen kart/{kode}/endringar.yaml")
            continue
        if lint.report(kode, lint.lint_kart(kart)):
            return 1
        if not (Path(root) / "dist" / f"{kode}.json").is_file():
            print(f"FEIL   dist/{kode}.json  fila finst ikkje (køyr scripts/bygg.py først)")
            return 1
        out = skriv(kode, root)
        print(f"{out.relative_to(root).as_posix()}")
        for v in json.loads(out.read_text(encoding="utf-8"))["versjonar"]:
            if not v["utrekna"]:
                print(f"  {v['versjon']} ({v['dato']}): berre samandrag")
                continue
            k = v["kantar"]
            print(f"  {v['versjon']} ({v['dato']}): {len(v['nye'])} nye, {len(v['endra'])} endra, {len(v['sletta'])} sletta, "
                  f"{len(k['nye'])} nye piler, {len(k['fjerna'])} fjerna")
            for label, rows in (("Nytt", v["nye"]), ("Sletta", v["sletta"])):
                for n in rows:
                    print(f"    {label}: {short(n['id'], kode)} ({n['namn']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
