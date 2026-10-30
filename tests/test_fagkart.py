import contextlib
import io
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import jsonschema
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import bygg  # noqa: E402
import endringar  # noqa: E402
import lint  # noqa: E402
from fagkart import load_kart, load_schema  # noqa: E402

KART = "kart/TEST01"


class MapTest(unittest.TestCase):
    """Each test gets a fresh copy of the valid fixture tree to mutate."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        shutil.copytree(HERE / "fixtures", self.root, dirs_exist_ok=True)

    def edit(self, name, fn):
        path = self.root / KART / name
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        fn(data)
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def node(self, data, node_id):
        return next(n for n in data["nodar"] if n["id"] == node_id)

    def edit_node(self, name, node_id, fn):
        self.edit(name, lambda d: fn(self.node(d, node_id)))

    def findings(self):
        return lint.lint_kart(load_kart("TEST01", self.root))

    def assertFires(self, level, *needles):
        found = [f for f in self.findings() if f.level == level]
        text = [f"{f.subject}: {f.msg}" for f in found]
        for needle in needles:
            self.assertTrue(any(needle in t for t in text), f"{needle!r} not in {text}")
        return found

    def assertQuiet(self):
        self.assertEqual(self.findings(), [])


class TestValid(MapTest):
    def test_valid_map_has_no_findings(self):
        self.assertQuiet()

    def test_whitespace_differences_in_km_text_are_ignored(self):
        self.edit("meta.yaml", lambda d: d["kompetansemaal"][0].update(
            tekst="berekne  og tolke gjennomsnitt\n og varians i eit  datasett"))
        self.assertQuiet()

    def test_build_validates_and_counts(self):
        dist = bygg.bygg(load_kart("TEST01", self.root))
        jsonschema.Draft202012Validator(load_schema("fagkart")).validate(dist)
        self.assertEqual(len(dist["nodar"]), 11)  # 2 km + 9 nodes
        # 7 byggjer_paa-ish inline edges + 1 symmetric + 9 dekkjer (varians covers two km)
        self.assertEqual(len(dist["kantar"]), 18)
        by_type = {}
        for e in dist["kantar"]:
            by_type[e["type"]] = by_type.get(e["type"], 0) + 1
        self.assertEqual(by_type, {"byggjer_paa": 6, "brukar": 1, "doeme_paa": 1,
                                   "forvekslast_med": 1, "representerast_som": 1, "dekkjer": 8})

    def test_build_ids_prefix_and_kompetansemaal_nodes(self):
        dist = bygg.bygg(load_kart("TEST01", self.root))
        ids = {n["id"] for n in dist["nodar"]}
        self.assertTrue(all(i.startswith("TEST01/") for i in ids))
        km = next(n for n in dist["nodar"] if n["id"] == "TEST01/km01")
        self.assertEqual((km["type"], km["namn"], km["klynge"]), ("kompetansemaal", "km01", "beskrivande"))
        self.assertEqual(km["verb"], ["berekne", "tolke"])
        self.assertIn("TEST01/km01", next(n for n in dist["nodar"] if n["id"] == "TEST01/snitt")["km"])
        for e in dist["kantar"]:
            self.assertIn(e["fra"], ids)
            self.assertIn(e["til"], ids)

    def test_build_klynge_and_omitted_empty_fields(self):
        dist = bygg.bygg(load_kart("TEST01", self.root))
        nodes = {n["id"]: n for n in dist["nodar"]}
        self.assertEqual(nodes["TEST01/tal"]["klynge"], "forkunnskap")
        self.assertEqual(nodes["TEST01/graf"]["klynge"], "modell")
        self.assertNotIn("udir_kode", nodes["TEST01/km01"])
        self.assertNotIn("km", nodes["TEST01/tal"])
        self.assertNotIn("byggjer_paa", nodes["TEST01/snitt"])  # edges live in kantar
        for n in dist["nodar"]:
            for k, v in n.items():
                self.assertNotIn(v, (None, "", [], {}), f"{n['id']}.{k} is empty")

    def test_symmetric_edge_is_deduped_even_when_declared_twice(self):
        dist = bygg.bygg(load_kart("TEST01", self.root))
        pair = [e for e in dist["kantar"] if e["type"] == "forvekslast_med"]
        self.assertEqual(len(pair), 1)

    def test_loeyper_fixture_is_valid_and_built_with_prefixed_ids(self):
        kart = load_kart("TEST01", self.root)
        self.assertEqual([r["id"] for r in kart.loeyper], ["repetisjon"])
        self.assertNotIn("loeyper.yaml", [rel.rsplit("/", 1)[-1] for rel, _ in kart.files])  # not a cluster file
        self.assertNotIn("repetisjon", [k for _, k, _ in kart.nodes()])
        dist = bygg.bygg(kart)
        self.assertEqual(dist["loeyper"], [{
            "id": "repetisjon", "namn": "Repetisjon til prøve",
            "skildring": "Kjernen i faget i den rekkjefølgja det løner seg å ta henne att.",
            "maalgruppe": ["1P", "1T"], "nodar": ["TEST01/tal", "TEST01/snitt", "TEST01/varians"]}])
        self.assertEqual(len(dist["nodar"]), 11)  # the file is not read as a cluster

    def test_build_writes_kode_from_the_folder_not_from_laereplan(self):
        dist = bygg.bygg(load_kart("TEST01", self.root))
        self.assertEqual((dist["kode"], dist["laereplan"], dist["format"]), ("TEST01", "TEST01", "fagkart/1"))
        self.edit("meta.yaml", lambda d: d.update(laereplan="MAT99-01"))
        dist = bygg.bygg(load_kart("TEST01", self.root))
        jsonschema.Draft202012Validator(load_schema("fagkart")).validate(dist)
        self.assertEqual((dist["kode"], dist["laereplan"]), ("TEST01", "MAT99-01"))
        self.assertTrue(all(n["id"].startswith("TEST01/") for n in dist["nodar"]))  # prefix = the map code

    def test_map_without_loeyper_has_no_loeyper_key(self):
        (self.root / KART / "loeyper.yaml").unlink()
        kart = load_kart("TEST01", self.root)
        self.assertEqual(kart.loeyper, [])
        self.assertNotIn("loeyper", bygg.bygg(kart))
        self.assertEqual(self.findings(), [])

    def test_optional_loeyper_fields_may_be_left_out(self):
        self.edit("loeyper.yaml", lambda d: [r.pop(k) for r in d["loeyper"] for k in ("skildring", "maalgruppe")])
        self.assertQuiet()
        self.assertEqual(set(bygg.bygg(load_kart("TEST01", self.root))["loeyper"][0]), {"id", "namn", "nodar"})

    def test_main_builds_dist_and_lint_main_reports_summary(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(lint.main(["TEST01"], self.root), 0)
            self.assertEqual(bygg.main([], self.root), 0)
        self.assertIn("TEST01: 0 feil, 0 åtvaringar", buf.getvalue())
        dist = json.loads((self.root / "dist" / "TEST01.json").read_text(encoding="utf-8"))
        self.assertEqual(dist["format"], "fagkart/1")

    def test_no_maps_found(self):
        empty = self.root / "tom"
        (empty / "kart" / "X").mkdir(parents=True)
        for main in (lint.main, bygg.main):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                self.assertEqual(main([], empty), 0)
            self.assertIn("Fann ingen kart", buf.getvalue())


class TestErrors(MapTest):
    def test_1_unknown_field(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(byggjer_pa=["tal"]))
        self.assertFires("FEIL", "snitt: ukjend felt «byggjer_pa»")

    def test_1_invalid_id(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(id="Snitt_1"))
        self.assertFires("FEIL", "id: ugyldig verdi «Snitt_1»")

    def test_1_invalid_km_id_and_enum(self):
        self.edit("meta.yaml", lambda d: d["kompetansemaal"][0].update(id="km1"))
        self.assertFires("FEIL", "ugyldig verdi «km1»")
        self.setUp()
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(verbnivaa="meistre"))
        self.assertFires("FEIL", "verbnivaa: ugyldig verdi «meistre»")

    def test_1_missing_required_field_and_bad_forkunnskap_value(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.pop("namn"))
        self.assertFires("FEIL", "manglar felt «namn»")
        self.setUp()
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n["forkunnskap"].update({"1P": "kanskje"}))
        self.assertFires("FEIL", "forkunnskap.1P: ugyldig verdi «kanskje»")

    def test_1_broken_yaml(self):
        (self.root / KART / "beskrivande.yaml").write_text("klynge: [oops\n", encoding="utf-8")
        found = self.assertFires("FEIL", "klarte ikkje lese fila")
        self.assertEqual(found[0].file, "kart/TEST01/beskrivande.yaml")

    def test_2_duplicate_node_id_across_files(self):
        dup = self.node(yaml.safe_load((self.root / KART / "modell.yaml").read_text(encoding="utf-8")), "graf")
        self.edit("beskrivande.yaml", lambda d: d["nodar"].append(dict(dup, id="snitt")))
        self.assertFires("FEIL", "snitt: ID finst fleire gonger")

    def test_2_node_id_colliding_with_km_id(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(id="km01"))
        self.assertFires("FEIL", "km01: ID finst fleire gonger")

    def test_3_unknown_km(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(km=["km01", "km09"]))
        self.assertFires("FEIL", "snitt: km peikar på ukjend kompetansemål «km09»")

    def test_3_unknown_edge_target(self):
        self.edit_node("beskrivande.yaml", "varians", lambda n: n.update(byggjer_paa=["snitt", "kvadratt"]))
        found = self.assertFires("FEIL", "varians: byggjer_paa peikar på ukjend node «kvadratt»")
        self.assertEqual(found[0].file, "kart/TEST01/beskrivande.yaml")

    def test_3_each_edge_field_is_checked(self):
        for fld in lint.EDGE_FIELDS:
            with self.subTest(fld):
                self.setUp()
                self.edit_node("beskrivande.yaml", "median", lambda n: n.update({fld: ["finst-ikkje"]}))
                self.assertFires("FEIL", f"{fld} peikar på ukjend node «finst-ikkje»")

    def test_4_cycle_reports_path(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(byggjer_paa=["tal", "varians"]))
        self.assertFires("FEIL", "sirkel i byggjer_paa: snitt → varians → snitt")

    def test_4_self_edge(self):
        for fld in ("doeme_paa", "byggjer_paa"):
            with self.subTest(fld):
                self.setUp()
                self.edit_node("modell.yaml", "graf", lambda n: n.update({fld: ["graf"]}))
                self.assertFires("FEIL", f"graf: {fld} peikar på noden sjølv")

    def test_5_km_without_nodes(self):
        def add_km(d):
            d["kompetansemaal"].append({"id": "km03", "tekst": "tolke grafar", "klynge": "modell"})
        self.edit("meta.yaml", add_km)
        with (self.root / "kjelder" / "TEST01.md").open("a", encoding="utf-8") as f:
            f.write("- km03: tolke grafar\n")
        found = self.assertFires("FEIL", "km03: ingen nodar")
        self.assertEqual(found[0].file, "kart/TEST01/meta.yaml")

    def test_6_internal_node_missing_required_fields(self):
        for fld in ("km", "verbnivaa", "tekst_laerar", "tekst_elev"):
            with self.subTest(fld):
                self.setUp()
                self.edit_node("beskrivande.yaml", "median", lambda n: n.pop(fld))
                self.assertFires("FEIL", f"median: manglar {fld}")

    def test_6_does_not_apply_to_forkunnskap_nodes(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.pop("tekst_laerar"))
        self.assertQuiet()

    def test_10_forkjennskap_missing_subject(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(forkjennskap={"1P": "nei"}))
        self.assertFires("FEIL", "snitt: forkjennskap manglar verdi for 1T")

    def test_10_forkjennskap_once_used_required_everywhere(self):
        self.edit_node("beskrivande.yaml", "snitt", lambda n: n.update(forkjennskap={"1P": "nei", "1T": "ja"}))
        self.assertFires("ÅTVARING", "median: manglar forkjennskap")

    def test_10_forkjennskap_not_on_forkunnskap_nodes(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.update(forkjennskap={"1P": "ja", "1T": "ja"}))
        self.assertFires("FEIL", "tal: forkjennskap er berre for nodar i faget")

    def test_quasi_math_outside_latex_is_error(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.update(doeme="x² + 1"))
        self.assertFires("FEIL", "tal: kvasimatte i doeme")

    def test_greek_letter_outside_latex_is_error(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.update(doeme="samanlikn med α"))
        self.assertFires("FEIL", "tal: kvasimatte i doeme")

    def test_latex_and_code_are_quiet(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.update(doeme="$x^2 \\cdot 2 \\le 3$ og `=A1·2`"))
        self.assertQuiet()

    def test_unbalanced_dollar_is_error(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n.update(doeme="$x^2 + 1"))
        self.assertFires("FEIL", "tal: ubalansert $ i doeme")

    def test_7_forkunnskap_missing_subject(self):
        self.edit_node("forkunnskap.yaml", "tal", lambda n: n["forkunnskap"].pop("1T"))
        self.assertFires("FEIL", "tal: forkunnskap manglar verdi for 1T")

    def test_8_forkunnskap_node_nobody_builds_on(self):
        def unlink(n):
            n["byggjer_paa"] = [x for x in n["byggjer_paa"] if x != "tal"]
        self.edit_node("beskrivande.yaml", "snitt", unlink)
        self.edit_node("beskrivande.yaml", "median", unlink)
        self.edit_node("modell.yaml", "lineaer", unlink)
        self.assertFires("FEIL", "tal: ingen node byggjer på denne forkunnskapsnoden")

    def test_8_only_byggjer_paa_counts(self):
        self.edit_node("beskrivande.yaml", "varians", lambda n: n.update(byggjer_paa=["snitt"], brukar=["brok"]))
        self.assertFires("FEIL", "brok: ingen node byggjer på")

    def test_9_km_text_differs_from_source(self):
        self.edit("meta.yaml", lambda d: d["kompetansemaal"][1].update(
            tekst="bruke lineære modellar til å beskrive samanhengar"))
        found = self.assertFires("FEIL", "km02: teksten er ikkje ordrett", "første skilnad ved teikn 30")
        self.assertIn("«beskrive samanhengar»", found[0].msg)
        self.assertIn("«skildre samanhengar»", found[0].msg)

    def test_9_km_missing_from_source(self):
        (self.root / "kjelder" / "TEST01.md").write_text("- km01: berekne og tolke gjennomsnitt og varians i eit datasett\n",
                                                         encoding="utf-8")
        self.assertFires("FEIL", "km02: finst ikkje i kjelder/TEST01.md")

    def test_9_kjelder_file_missing(self):
        (self.root / "kjelder" / "TEST01.md").unlink()
        found = self.assertFires("FEIL", "fila manglar")
        self.assertEqual(found[0].file, "kjelder/TEST01.md")

    def test_errors_stop_build(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.pop("tekst_elev"))
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(bygg.main([], self.root), 1)
        self.assertFalse((self.root / "dist" / "TEST01.json").exists())
        self.assertIn("FEIL   kart/TEST01/beskrivande.yaml  median: manglar tekst_elev", buf.getvalue())
        self.assertIn("TEST01: 1 feil, 0 åtvaringar", buf.getvalue())


class TestLoeyper(MapTest):
    def route(self, **changes):
        self.edit("loeyper.yaml", lambda d: d["loeyper"][0].update(changes))

    def test_schema_errors(self):
        self.edit("loeyper.yaml", lambda d: d["loeyper"][0].update(ukjent=1, id="Stor_Bokstav"))
        self.assertFires("FEIL", "ukjend felt «ukjent»", "ugyldig verdi «Stor_Bokstav»")
        self.edit("loeyper.yaml", lambda d: d["loeyper"][0].pop("namn"))
        self.assertFires("FEIL", "manglar felt «namn»")

    def test_broken_yaml_and_wrong_top_level(self):
        (self.root / KART / "loeyper.yaml").write_text("loeyper: [\n", encoding="utf-8")
        found = self.assertFires("FEIL", "klarte ikkje lese fila")
        self.assertEqual(found[0].file, "kart/TEST01/loeyper.yaml")
        (self.root / KART / "loeyper.yaml").write_text("- ikkje eit kart\n", encoding="utf-8")
        self.assertFires("FEIL", "feil type")

    def test_duplicate_route_id(self):
        self.edit("loeyper.yaml", lambda d: d["loeyper"].append({**d["loeyper"][0], "namn": "Ei til"}))
        self.assertFires("FEIL", "repetisjon: løype-ID finst 2 gonger")

    def test_unknown_node(self):
        self.route(nodar=["tal", "finst-ikkje"])
        self.assertFires("FEIL", "repetisjon: peikar på nodar som ikkje finst i kartet: «finst-ikkje»")

    def test_kompetansemaal_is_not_a_route_node(self):
        self.route(nodar=["tal", "km01"])
        self.assertFires("FEIL", "«km01»")

    def test_same_node_twice(self):
        self.route(nodar=["tal", "snitt", "tal"])
        self.assertFires("FEIL", "repetisjon: same node fleire gonger: «tal»")

    def test_fewer_than_two_nodes(self):
        self.route(nodar=["tal"])
        self.assertFires("FEIL", "repetisjon: løypa har 1 node (minst 2)")
        self.route(nodar=[])
        self.assertFires("FEIL", "repetisjon: løypa har 0 nodar (minst 2)")

    def test_maalgruppe_must_be_a_forkunnskapsfag(self):
        self.route(maalgruppe=["1P", "R1"])
        self.assertFires("FEIL", "repetisjon: maalgruppe med fag som ikkje står i forkunnskapsfag: «R1»")

    def test_errors_in_loeyper_stop_the_build(self):
        self.route(nodar=["tal", "finst-ikkje"])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(bygg.main([], self.root), 1)
        self.assertFalse((self.root / "dist" / "TEST01.json").exists())

    def test_warning_node_before_what_it_builds_on(self):
        self.route(nodar=["snitt", "tal"])  # direct
        found = self.assertFires("ÅTVARING", "repetisjon: «snitt» står før «tal», som han byggjer på")
        self.assertEqual([f.level for f in self.findings()], ["ÅTVARING"])
        self.assertEqual(found[0].file, "kart/TEST01/loeyper.yaml")

    def test_warning_node_before_what_it_builds_on_through_a_chain(self):
        self.route(nodar=["varians", "tal"])  # varians -> snitt -> tal
        self.assertFires("ÅTVARING", "«varians» står før «tal»")

    def test_the_other_order_and_unrelated_nodes_are_quiet(self):
        self.route(nodar=["tal", "snitt", "varians", "graf", "median"])
        self.assertQuiet()

    def test_warning_expired_node(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(utgaatt=True))
        self.route(nodar=["tal", "median"])
        self.assertFires("ÅTVARING", "repetisjon: inneheld utgåtte nodar: «median»")


class TestEndringar(MapTest):
    """endringar.yaml (docs/FORMAT.md § Endringar): lint, the diff of two builds and dist/<KODE>.endringar.json."""

    @staticmethod
    def mk(i, namn="N", klynge="a", **rest):
        return {"id": f"X/{i}", "type": "omgrep", "namn": namn, "klynge": klynge, **rest}

    @staticmethod
    def dist(nodes, edges=(), **top):
        return {"format": "fagkart/1", "nodar": list(nodes), "kantar": list(edges), **top}

    def write(self, entries):
        (self.root / KART / "endringar.yaml").write_text(yaml.safe_dump({"endringar": entries}, allow_unicode=True, sort_keys=False), encoding="utf-8")

    def two_versions(self):
        self.write([{"versjon": "1.0", "dato": "2026-10-29", "samandrag": "Ny."}, {"versjon": "0.9", "dato": "2026-10-18", "samandrag": "Første."}])

    def build(self):
        buf = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(err):
            code = bygg.main([], self.root)
        self.assertEqual(code, 0, buf.getvalue())
        return err.getvalue()

    def log(self):
        return json.loads((self.root / "dist" / "TEST01.endringar.json").read_text(encoding="utf-8"))

    # --- diff: a pure function of two dist dicts
    def test_diff_of_equal_builds_is_empty(self):
        d = self.dist([self.mk("a")], [{"fra": "X/a", "til": "X/a", "type": "brukar"}])
        self.assertEqual(endringar.diff(d, d), {"nye": [], "endra": [], "sletta": [], "kantar": {"nye": [], "fjerna": []}})

    def test_diff_new_and_deleted_nodes(self):
        old = self.dist([self.mk("a", "A"), self.mk("gone", "Borte"), self.mk("old", "Utgått")])
        new = self.dist([self.mk("a", "A"), self.mk("ny", "Ny", klynge="b"), self.mk("old", "Utgått", utgaatt=True)])
        r = endringar.diff(old, new)
        self.assertEqual(r["nye"], [{"id": "X/ny", "namn": "Ny", "tema": "b"}])
        self.assertEqual(r["sletta"], [{"id": "X/gone", "namn": "Borte"}, {"id": "X/old", "namn": "Utgått"}])  # gone from the file, and utgaatt
        self.assertEqual(r["endra"], [])

    def test_diff_a_new_node_that_is_already_utgaatt_is_nothing(self):
        r = endringar.diff(self.dist([]), self.dist([self.mk("x", utgaatt=True)]))
        self.assertEqual((r["nye"], r["sletta"]), ([], []))

    def test_diff_competence_goals_are_nodes_too(self):
        km = {"id": "X/km01", "type": "kompetansemaal", "namn": "km01", "klynge": "a"}
        r = endringar.diff(self.dist([]), self.dist([km]))
        self.assertEqual(r["nye"], [{"id": "X/km01", "namn": "km01", "tema": "a"}])

    def test_diff_changed_fields_in_order_and_a_missing_field_is_empty(self):
        old = self.dist([self.mk("a", tekst_elev="Før.", doeme="D", forkjennskap={"1P": "nei"}, km=["X/km01"]), self.mk("b", tekst_elev="Lik.")])
        new = self.dist([self.mk("a", namn="A2", tekst_elev="Etter.", doeme="", forkjennskap={"1P": "ja"}, km=["X/km01"], nivaa=2), self.mk("b", tekst_elev="Lik.", doeme=None)])
        r = endringar.diff(old, new)
        self.assertEqual(r["endra"], [{"id": "X/a", "namn": "A2", "felt": ["namn", "tekst_elev", "doeme", "nivaa", "forkjennskap"]}])  # b: None and absent are the same

    def test_diff_edges_new_and_removed_only_between_nodes_on_both_sides(self):
        e = lambda f, t, ty="byggjer_paa": {"fra": f"X/{f}", "til": f"X/{t}", "type": ty}  # noqa: E731
        old = self.dist([self.mk(i) for i in "abcd"], [e("a", "b"), e("a", "c"), e("c", "d"), e("b", "a", "forvekslast_med")])
        new = self.dist([self.mk(i) for i in "abce"], [e("a", "b"), e("b", "c"), e("c", "e"), e("a", "b", "dekkjer"), e("a", "b", "forvekslast_med")])
        r = endringar.diff(old, new)
        # c -> d is gone with d (d is deleted), c -> e is not listed (e is new); the symmetric pair a-b is the same edge whichever way it is written
        self.assertEqual(r["kantar"], {"nye": [e("a", "b", "dekkjer"), e("b", "c")], "fjerna": [e("a", "c")]})

    def test_diff_ignores_rom_loeyper_and_other_top_level_fields(self):
        old = self.dist([self.mk("a")], rom=[{"id": "r"}], loeyper=[{"id": "l"}], versjon="1", oversiktskantar=[])
        new = self.dist([self.mk("a")], versjon="2", klyngjer=[{"id": "a"}])  # also a build from before `rom` and `kode` existed
        self.assertEqual(endringar.diff(old, new), {"nye": [], "endra": [], "sletta": [], "kantar": {"nye": [], "fjerna": []}})

    # --- lint
    def test_the_fixture_log_is_valid_and_not_a_cluster_file(self):
        kart = load_kart("TEST01", self.root)
        self.assertEqual([e["versjon"] for e in kart.endringar], ["1.0"])
        self.assertNotIn("endringar.yaml", [rel.rsplit("/", 1)[-1] for rel, _ in kart.files])
        self.assertQuiet()

    def test_the_log_is_optional(self):
        (self.root / KART / "endringar.yaml").unlink()
        self.assertQuiet()
        self.assertEqual(self.build(), "")
        self.assertFalse((self.root / "dist" / "TEST01.endringar.json").exists())

    def test_top_version_must_equal_meta(self):
        self.write([{"versjon": "2.0", "dato": "2026-10-29", "samandrag": "x"}, {"versjon": "1.0", "dato": "2026-10-18", "samandrag": "y"}])
        self.assertFires("FEIL", "øvste versjon i endringar.yaml (2.0) er ikkje lik versjon i meta.yaml (1.0)")
        self.write([{"versjon": "1.0", "dato": "2026-10-29", "samandrag": "x"}, {"versjon": "0.9", "dato": "2026-10-18", "samandrag": "y"}])
        self.assertQuiet()  # older versions may be anything

    def test_versions_are_unique(self):
        self.write([{"versjon": "1.0", "dato": "2026-10-29", "samandrag": "x"}, {"versjon": "1.0", "dato": "2026-10-18", "samandrag": "y"}])
        self.assertFires("FEIL", "1.0: versjonen finst 2 gonger")

    def test_bad_dates(self):
        for bad, needle in [("2026-13-45", "dato «2026-13-45» er ikkje ei gyldig dato"), ("29.10.2026", "dato: ugyldig verdi «29.10.2026»"), (5, "dato: feil type")]:
            self.write([{"versjon": "1.0", "dato": bad, "samandrag": "x"}])
            self.assertFires("FEIL", needle)
        (self.root / KART / "endringar.yaml").write_text('endringar:\n  - {versjon: "1.0", dato: 2026-10-29, samandrag: x}\n', encoding="utf-8")
        self.assertQuiet()  # a YAML date is fine

    def test_schema_and_broken_yaml(self):
        self.write([{"versjon": "1.0", "dato": "2026-10-29", "samandrag": "x", "ukjent": 1, "etter_innspel": -1}])
        self.assertFires("FEIL", "ukjend felt «ukjent»")
        self.write([{"versjon": "1.0", "dato": "2026-10-29"}])
        self.assertFires("FEIL", "manglar felt «samandrag»")
        (self.root / KART / "endringar.yaml").write_text("endringar: [\n", encoding="utf-8")
        found = self.assertFires("FEIL", "klarte ikkje lese fila")
        self.assertEqual(found[0].file, "kart/TEST01/endringar.yaml")

    # --- build
    def test_build_without_a_tag_writes_only_the_summary(self):
        err = self.build()
        self.assertEqual(err, "")  # the only version has nothing before it: no complaint
        self.assertEqual(self.log(), {"format": "fagkart-endringar/1", "kart": "TEST01", "versjonar": [
            {"versjon": "1.0", "dato": "2026-10-29", "samandrag": "Første versjon av testkartet.", "etter_innspel": 0, "utrekna": False}]})

    def test_missing_tag_gives_one_line_on_stderr_and_exit_code_zero(self):
        self.two_versions()
        err = self.build()  # self.root is no git repository
        self.assertEqual(err.count("\n"), 1)
        self.assertIn("TEST01: taggen TEST01-0.9 finst ikkje, versjon 1.0 har berre samandrag", err)
        v = self.log()["versjonar"]
        self.assertEqual([(x["versjon"], x["utrekna"], x["dato"]) for x in v], [("1.0", False, "2026-10-29"), ("0.9", False, "2026-10-18")])
        self.assertNotIn("nye", v[0])

    def test_missing_tag_keeps_the_lists_of_the_build_before(self):
        # a copy without the tags (the open repo) keeps what the build before had computed
        self.two_versions()
        self.build()
        log = self.root / "dist" / "TEST01.endringar.json"
        doc = json.loads(log.read_text(encoding="utf-8"))
        doc["versjonar"][0].update(utrekna=True, nye=["TEST01/a"], endra=[], sletta=[], kantar={"nye": [], "fjerna": []})
        log.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(self.build(), "")
        v = self.log()["versjonar"][0]
        self.assertEqual((v["utrekna"], v["nye"], v["samandrag"]), (True, ["TEST01/a"], doc["versjonar"][0]["samandrag"]))

    def test_build_compares_with_the_tagged_build(self):
        if shutil.which("git") is None:
            self.skipTest("no git")
        self.two_versions()
        self.build()
        git = lambda *a: subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=self.root, check=True, capture_output=True)  # noqa: E731
        git("init", "-q")
        git("add", "-A")
        git("commit", "-qm", "0.9")
        git("tag", "TEST01-0.9")
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(tekst_elev="Ny forklaring av medianen.", byggjer_paa=["tal", "brok"]))
        self.edit("beskrivande.yaml", lambda d: d["nodar"].append({**self.node(d, "median"), "id": "kvartil", "namn": "Kvartil"}))
        self.assertEqual(self.build(), "")
        v = self.log()["versjonar"]
        self.assertEqual(v[0]["utrekna"], True)
        self.assertEqual(v[0]["nye"], [{"id": "TEST01/kvartil", "namn": "Kvartil", "tema": "beskrivande"}])
        self.assertEqual(v[0]["endra"], [{"id": "TEST01/median", "namn": "Median", "felt": ["tekst_elev"]}])
        self.assertEqual(v[0]["sletta"], [])
        # the edges of the new node are not listed (it did not exist before), only the new one between two old nodes
        self.assertEqual(v[0]["kantar"], {"nye": [{"fra": "TEST01/median", "til": "TEST01/brok", "type": "byggjer_paa"}], "fjerna": []})
        self.assertEqual((v[1]["versjon"], v[1]["utrekna"]), ("0.9", False))  # the oldest has nothing before it
        # the command line lists them
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(endringar.main(["TEST01"], self.root), 0)
        self.assertIn("Nytt: kvartil (Kvartil)", buf.getvalue())

    def test_older_versions_come_from_their_own_tags(self):
        self.write([{"versjon": "3", "dato": "2026-10-29", "samandrag": "c"}, {"versjon": "2", "dato": "2026-10-20", "samandrag": "b"}, {"versjon": "1", "dato": "2026-10-10", "samandrag": "a"}])
        self.edit("meta.yaml", lambda d: d.update(versjon="3"))
        self.build()
        tags = {"1": self.dist([self.mk("a")]), "2": self.dist([self.mk("a"), self.mk("b")])}
        asked = []

        def hent(kode, versjon, root):
            asked.append(versjon)
            return tags.get(versjon)

        endringar.skriv("TEST01", self.root, hent)
        v = self.log()["versjonar"]
        self.assertEqual([x["utrekna"] for x in v], [True, True, False])
        self.assertEqual([n["id"] for n in v[1]["nye"]], ["X/b"])  # 2 against 1
        self.assertEqual(sorted(asked), ["1", "2", "2"])  # the newest is read from dist/, not from a tag

    def test_lint_error_stops_the_command_line(self):
        self.write([{"versjon": "9", "dato": "2026-10-29", "samandrag": "x"}])
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(endringar.main(["TEST01"], self.root), 1)
        self.assertIn("øvste versjon", buf.getvalue())


class TestOverlegg(unittest.TestCase):
    """schema/overlegg.schema.json: `type` and `oppdatert` are optional, so old files stay valid."""

    BASE = {"format": "fagkart-overlegg/1", "kart": "TEST01", "kartversjon": "1.0", "namn": "Mi eigenvurdering",
            "skala": ["ikkje", "delvis", "heilt"], "merke": {"TEST01/snitt": "heilt"}}

    def errors(self, **extra):
        v = jsonschema.Draft202012Validator(load_schema("overlegg"))
        return [e.message for e in v.iter_errors({**self.BASE, **extra})]

    def test_old_file_without_type_and_oppdatert_is_valid(self):
        self.assertEqual(self.errors(), [])

    def test_each_type_and_timestamp_form_is_valid(self):
        for t in ("eigenvurdering", "dekning", "notat"):
            self.assertEqual(self.errors(type=t), [], t)
        for ts in ("2026-10-23T14:02:00+02:00", "2026-10-23T12:02:00Z", "2026-10-23T12:02:00.123Z", "2026-10-23T14:02+02:00"):
            self.assertEqual(self.errors(oppdatert=ts), [], ts)

    def test_unknown_type_and_bad_timestamp_are_rejected(self):
        self.assertTrue(self.errors(type="loeype-framdrift"))
        for ts in ("2026-10-23", "23.10.2026 14:02", "2026-10-23T14:02:00", 1761220920):
            self.assertTrue(self.errors(oppdatert=ts), ts)

    def test_skala_namn_names_the_values(self):
        self.assertEqual(self.errors(type="dekning", skala=["del1", "del2"], skala_namn={"del1": "Del 1 (utan hjelpemiddel)", "del2": "Del 2"}), [])
        self.assertTrue(self.errors(skala_namn={"del1": ""}))
        self.assertTrue(self.errors(skala_namn=["Del 1"]))

    def test_the_markering_fixtures_of_the_viewer_are_valid(self):
        files = sorted((HERE.parent / "viewer" / "fixtures" / "overlegg").glob("*.json"))
        self.assertTrue(files)
        v = jsonschema.Draft202012Validator(load_schema("overlegg"))
        for f in files:
            self.assertEqual([e.message for e in v.iter_errors(json.loads(f.read_text(encoding="utf-8")))], [], f.name)


class TestWarnings(MapTest):
    def test_few_nodes_for_km(self):
        self.edit_node("modell.yaml", "graf", lambda n: n.update(km=["km01"]))
        self.edit_node("beskrivande.yaml", "varians", lambda n: n.update(km=["km01"]))
        self.assertFires("ÅTVARING", "km02: berre 2 nodar")
        self.edit_node("modell.yaml", "stigingstal", lambda n: n.update(km=["km01"]))
        self.assertFires("ÅTVARING", "km02: berre 1 node")

    def test_missing_doeme_or_misoppfatning(self):
        for fld in ("doeme", "misoppfatning"):
            with self.subTest(fld):
                self.setUp()
                self.edit_node("beskrivande.yaml", "median", lambda n: n.pop(fld))
                self.assertFires("ÅTVARING", f"median: manglar {fld}")

    def test_tekst_elev_length(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(tekst_elev="a" * 300))
        self.assertQuiet()
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(tekst_elev="a" * 301))
        self.assertFires("ÅTVARING", "median: tekst_elev er 301 teikn")

    def test_bokmaal_words(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(
            tekst_elev="Dette er ikke noe å bekymre seg for, hvis du er trygg.", misoppfatning="Jeg vet hva det er."))
        self.assertFires("ÅTVARING", "median: bokmålsord i tekst_elev: hvis, ikke",
                         "median: bokmålsord i misoppfatning: hva, jeg")

    def test_bokmaal_tar_siden_trekning(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(tekst_elev="Siden du tar ei trekning."))
        self.assertFires("ÅTVARING", "median: bokmålsord i tekst_elev: siden, tar, trekning")

    def test_bokmaal_matches_whole_words_only(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.update(tekst_elev="Hvorfor og nokon og ikkje."))
        self.assertQuiet()

    def test_output_line_format(self):
        self.edit_node("beskrivande.yaml", "median", lambda n: n.pop("doeme"))
        buf = []
        lint.report("TEST01", self.findings(), buf.append)
        self.assertEqual(buf, ["ÅTVARING  kart/TEST01/beskrivande.yaml  median: manglar doeme",
                               "TEST01: 0 feil, 1 åtvaring"])


class TestGjennomgangFunn(MapTest):
    """Found by a review of the scripts: an impossible unquoted date must not crash."""

    def test_impossible_date_in_endringar_is_a_lint_error_not_a_crash(self):
        path = self.root / KART / "endringar.yaml"
        path.write_text(path.read_text(encoding="utf-8").replace("dato: 20", "dato: 2026-13-45  # ", 1), encoding="utf-8")
        found = self.assertFires("FEIL", "klarte ikkje lese fila")
        self.assertEqual(found[0].file, "kart/TEST01/endringar.yaml")


if __name__ == "__main__":
    unittest.main()
