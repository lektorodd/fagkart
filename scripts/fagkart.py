"""Shared loader for fagkart source maps (kart/<KODE>/*.yaml)."""
import json
from dataclasses import dataclass, field
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
LOEYPER_FILE = "loeyper.yaml"
ENDRINGAR_FILE = "endringar.yaml"
NON_CLUSTER = {"meta.yaml", LOEYPER_FILE, ENDRINGAR_FILE}  # files in a map folder that are not cluster files
# Inline edge fields on a node, in output order.
EDGE_FIELDS = ["byggjer_paa", "brukar", "doeme_paa", "forvekslast_med", "representerast_som"]


def load_schema(name):
    """Schemas always come from this repo, whatever root the maps are read from."""
    with open(ROOT / "schema" / f"{name}.schema.json", encoding="utf-8") as f:
        return json.load(f)


@dataclass
class Kart:
    kode: str
    root: Path
    meta: dict = field(default_factory=dict)
    files: list = field(default_factory=list)   # [(relpath, data)] for meta.yaml first, then clusters
    errors: list = field(default_factory=list)  # [(relpath, message)] for unreadable YAML
    loeyper: list = field(default_factory=list)  # routes from the optional loeyper.yaml ([] when absent or unreadable)
    loeyper_file: tuple = None                   # (relpath, data) of loeyper.yaml, None when the file is absent
    endringar: list = field(default_factory=list)  # versions from the optional endringar.yaml, newest first ([] when absent or unreadable)
    endringar_file: tuple = None                   # (relpath, data) of endringar.yaml, None when the file is absent

    def nodes(self):
        """Yield (relpath, klynge, node) for every authored node, in file order."""
        for rel, data in self.files:
            if rel.endswith("/meta.yaml") or not isinstance(data, dict):
                continue
            for node in data.get("nodar") or []:
                yield rel, data.get("klynge"), node


def kart_dirs(root=ROOT):
    """Codes of all maps under <root>/kart/ that have a meta.yaml."""
    base = Path(root) / "kart"
    return sorted(d.name for d in base.iterdir() if (d / "meta.yaml").is_file()) if base.is_dir() else []


def load_kart(kode, root=ROOT):
    root = Path(root)
    kart = Kart(kode, root)
    folder = root / "kart" / kode
    # meta.yaml first, then the cluster files; loeyper.yaml and endringar.yaml are not cluster files and are read on their own below
    paths = [folder / "meta.yaml"] + sorted(p for p in folder.glob("*.yaml") if p.name not in NON_CLUSTER)
    for path in paths:
        rel = path.relative_to(root).as_posix()
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, OSError) as e:
            kart.errors.append((rel, f"klarte ikkje lese fila: {e}".replace("\n", " ")))
            continue
        kart.files.append((rel, {} if data is None else data))
        if path.name == "meta.yaml" and isinstance(data, dict):
            kart.meta = data
    loeyper_path = folder / LOEYPER_FILE
    if loeyper_path.is_file():
        rel = loeyper_path.relative_to(root).as_posix()
        try:
            with open(loeyper_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, OSError) as e:
            kart.errors.append((rel, f"klarte ikkje lese fila: {e}".replace("\n", " ")))
        else:
            data = {} if data is None else data
            kart.loeyper_file = (rel, data)
            routes = data.get("loeyper") if isinstance(data, dict) else None
            kart.loeyper = [r for r in routes if isinstance(r, dict)] if isinstance(routes, list) else []
    endringar_path = folder / ENDRINGAR_FILE
    if endringar_path.is_file():
        rel = endringar_path.relative_to(root).as_posix()
        try:
            with open(endringar_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except (yaml.YAMLError, OSError, ValueError) as e:  # ValueError: an unquoted date that is no date (2026-13-45)
            kart.errors.append((rel, f"klarte ikkje lese fila: {e}".replace("\n", " ")))
        else:
            data = {} if data is None else data
            kart.endringar_file = (rel, data)
            entries = data.get("endringar") if isinstance(data, dict) else None
            kart.endringar = [r for r in entries if isinstance(r, dict)] if isinstance(entries, list) else []
    return kart
