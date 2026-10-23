"""Adversarial offline selection contract, chronology and restart checks."""
from dataclasses import replace
from decimal import Decimal as D
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from spot_aggressive_v3.account import ResearchAccount
from spot_selective_lab.core import (
    Evidence, Proposal, SelectionLab, SCHEMA, MAX_SIGNAL_AGE_US,
    MAX_QUOTE_AGE_US, DECISION_DEADLINE_US, digest,
)
from spot_selective_lab.journal import SelectionJournal

NOW = 1_700_000_000_000_000  # injected synthetic clock, not market observation


class SelectionContractTests(unittest.TestCase):
    def setUp(self):
        self.account = ResearchAccount()
        self.lab = SelectionLab(self.account, {"fixture_a": "a" * 64, "fixture_b": "b" * 64})
        self.quote = {"symbol": "SOLUSDT", "reference": "100", "available_us": NOW,
                      "snapshot_id": "SYNTHETIC_QUOTE"}
        self.proposal = Proposal("a", "fixture_a", "wave-a", "SOLUSDT", NOW,
                                 D("100"), D("98"), D("110"), None,
                                 (Evidence("e-a", NOW, {"rsi14": "45"}),))

    def packet(self, proposals=None, **changes):
        args = dict(as_of_us=NOW, quote=self.quote, headroom=D("1.5"))
        args.update(changes)
        return self.lab.packet([self.proposal] if proposals is None else proposals, **args)

    def response(self, packet, **changes):
        args = dict(schema_version=SCHEMA, packet_hash=packet["packet_hash"],
                    decision="BUY", candidate_id="a", reason_codes=["RECOVERY_CONFIRMED"],
                    evidence_ids=["e-a"])
        args.update(changes)
        return args

    def select(self, packet, response=None, **changes):
        args = dict(received_at_us=NOW, quote=self.quote, headroom=D("1.5"))
        args.update(changes)
        return self.lab.select(packet, self.response(packet) if response is None else response, **args)

    def test_multiple_mechanisms_single_choice_no_ledger_mutation(self):
        b = replace(self.proposal, candidate_id="b", mechanism_id="fixture_b", episode_id="wave-b",
                    evidence=(Evidence("e-b", NOW, {"rsi14": "44"}),))
        p = self.packet([self.proposal, b])
        r = self.select(p, self.response(p, candidate_id="b", evidence_ids=["e-b"]))
        self.assertEqual(r["decision"], "BUY")
        self.assertFalse(r["execution_permitted"])
        self.assertEqual(len(p["candidates"]), 2)
        self.assertEqual(self.account.events, [])
        self.assertEqual((self.account.cash, self.account.inventory), (D("15"), D("0")))
        self.assertEqual(p["profitability"], "NOT_MEASURED")

    def test_model_wait_and_veto_are_distinct_from_system_wait(self):
        p = self.packet()
        for action, candidate, evidence in (("WAIT", None, []), ("VETO", "a", ["e-a"])):
            r = self.select(p, self.response(p, decision=action, candidate_id=candidate,
                                            evidence_ids=evidence, reason_codes=["NO_CLEAR_ADVANTAGE"]))
            self.assertEqual((r["decision"], r["origin"]), (action, "MODEL_RESPONSE_FIXTURE"))
        r = self.lab.select(p, None, received_at_us=NOW, quote=self.quote, headroom=D("1.5"))
        self.assertEqual((r["decision"], r["origin"]), ("WAIT", "SYSTEM"))

    def test_model_cannot_change_size_stop_or_claim_confidence(self):
        p = self.packet()
        for extra in ({"quantity": "100"}, {"stop": "1"}, {"confidence": ".99"},
                      {"leverage": 10}, {"command": "place_order"}):
            r = self.select(p, self.response(p, **extra))
            self.assertEqual(r["reason"], "INVALID_RESPONSE_SCHEMA_OR_PACKET")
        self.assertEqual(self.account.events, [])

    def test_invalid_identity_evidence_and_types_are_rejected(self):
        p = self.packet()
        for change in ({"candidate_id": "missing"}, {"evidence_ids": ["e-other"]},
                       {"evidence_ids": []}, {"decision": "SELL"},
                       {"reason_codes": ["FREE_FORM_INSTRUCTION"]}, {"reason_codes": "BUY"},
                       {"packet_hash": "c" * 64}, {"schema_version": "other"}):
            self.assertEqual(self.select(p, self.response(p, **change))["origin"], "SYSTEM")

    def test_future_stale_unregistered_unsupported_and_duplicate_proposals(self):
        for bad, expected in (
            (replace(self.proposal, signal_us=NOW+1), "STALE_OR_FUTURE_SIGNAL"),
            (replace(self.proposal, signal_us=NOW-MAX_SIGNAL_AGE_US-1), "STALE_OR_FUTURE_SIGNAL"),
            (replace(self.proposal, mechanism_id="missing"), "UNREGISTERED_MECHANISM"),
            (replace(self.proposal, symbol="BTCUSDT"), "UNSUPPORTED_SYMBOL"),
            (replace(self.proposal, evidence=(Evidence("e", NOW+1, {}),)), "INVALID_OR_FUTURE_EVIDENCE"),
            (replace(self.proposal, evidence=()), "MISSING_EVIDENCE"),
        ):
            p = self.packet([bad])
            self.assertFalse(p["request_model"])
            self.assertIn(expected, p["rejected"][0]["reasons"])
        p = self.packet([self.proposal, replace(self.proposal, candidate_id="duplicate")])
        self.assertEqual(len(p["candidates"]), 1)
        self.assertIn("DUPLICATE_ID_OR_EPISODE", p["rejected"][0]["reasons"])

    def test_cost_rejected_candidate_cannot_be_selected(self):
        weak = replace(self.proposal, candidate_id="weak", stop=D("99.9"), hurdle=D("102"))
        p = self.packet([weak])
        self.assertFalse(p["request_model"])
        self.assertTrue(p["rejected"])
        self.assertEqual(self.select(p, self.response(p, candidate_id="weak"))["reason"], "NO_FEASIBLE_CANDIDATE")

    def test_occupied_position_zero_headroom_and_partial_mode(self):
        for change in ({"position_open": True}, {"headroom": D("0")}):
            p = self.packet(**change)
            self.assertFalse(p["request_model"])
        self.account.inventory = D(".01")
        self.assertFalse(self.packet()["request_model"])
        self.account.inventory = D("0")
        self.account.partial_fraction = D(".5")
        with self.assertRaises(ValueError):
            self.packet()

    def test_packet_plan_mutation_and_state_changes_become_system_wait(self):
        for kind in ("cash", "headroom", "quote", "position", "plan"):
            self.setUp()
            p = self.packet()
            changes = {}
            if kind == "cash":
                self.account.cash -= D("1")
            elif kind == "headroom":
                changes["headroom"] = D("1")
            elif kind == "quote":
                changes["quote"] = {**self.quote, "reference": "101"}
            elif kind == "position":
                changes["position_open"] = True
            else:
                p["candidates"][0]["plan"]["quantity"] = "100"
            self.assertEqual(self.select(p, **changes)["origin"], "SYSTEM")

    def test_recomputed_hash_cannot_authorize_external_packet_or_provenance(self):
        p = self.packet()
        p["candidates"][0]["plan"]["quantity"] = "100"
        p["candidates"][0]["source_status"] = "VALIDATED"
        p["packet_hash"] = digest({k: v for k, v in p.items() if k != "packet_hash"})
        self.assertEqual(self.select(p)["reason"], "PACKET_NOT_PREPARED_BY_THIS_INSTANCE")

    def test_deadline_and_quote_expiry_during_review(self):
        p = self.packet()
        for at in (NOW-1, NOW+DECISION_DEADLINE_US+1):
            self.assertEqual(self.select(p, received_at_us=at)["reason"], "STALE_OR_FUTURE_RESPONSE")
        old_quote = {**self.quote, "available_us": NOW-MAX_QUOTE_AGE_US}
        old_signal = replace(self.proposal, signal_us=old_quote["available_us"],
                             evidence=(Evidence("e-a", old_quote["available_us"], {}),))
        p = self.packet([old_signal], quote=old_quote)
        self.assertEqual(self.select(p, quote=old_quote, received_at_us=NOW+1)["reason"], "QUOTE_EXPIRED_DURING_REVIEW")

    def test_exact_values_and_clock_types(self):
        for change in ({"as_of_us": True}, {"headroom": 1.5},
                       {"quote": {**self.quote, "reference": 100.0}},
                       {"quote": {**self.quote, "available_us": NOW+1}},
                       {"quote": {**self.quote, "available_us": NOW-MAX_QUOTE_AGE_US-1}}):
            with self.assertRaises(ValueError):
                self.packet(**change)

    def test_journal_restart_keeps_first_choice_and_marks_duplicate_historical(self):
        p = self.packet()
        reply = self.response(p)
        r = self.select(p, reply)
        with TemporaryDirectory() as directory:
            path = Path(directory)/"selection.sqlite"
            j = SelectionJournal(path)
            self.assertTrue(j.claim("test-run", p)["claimed"])
            self.assertTrue(j.record("test-run", p, reply, r, NOW)["inserted"])
            j.close()
            j = SelectionJournal(path)
            altered = self.response(p, decision="WAIT", candidate_id=None, evidence_ids=[])
            old = j.record("test-run", p, altered, self.select(p, altered), NOW+1)
            self.assertFalse(old["inserted"])
            self.assertTrue(old["is_historical_record_only"])
            self.assertFalse(old["execution_permitted"])
            self.assertEqual(old["saved_record"]["result"]["decision"], "BUY")
            self.assertEqual(j.db.execute("SELECT COUNT(*) FROM selections").fetchone()[0], 1)
            j.close()

    def test_overlapping_wave_cannot_review_old_episode_but_new_one_can(self):
        b = replace(self.proposal, candidate_id="b", episode_id="wave-b")
        with TemporaryDirectory() as directory:
            j = SelectionJournal(Path(directory)/"selection.sqlite")
            self.assertTrue(j.claim("run", self.packet())["claimed"])
            self.assertEqual(j.claim("run", self.packet([self.proposal, b]))["reason"], "EPISODE_ALREADY_CLAIMED")
            unseen = j.unreviewed("run", [self.proposal, b])
            self.assertEqual(unseen, [b])
            self.assertTrue(j.claim("run", self.packet(unseen))["claimed"])
            j.close()

    def test_claim_survives_crash_without_response_or_record(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)/"selection.sqlite"
            j = SelectionJournal(path)
            self.assertTrue(j.claim("run", self.packet())["claimed"])
            j.close()
            j = SelectionJournal(path)
            self.assertFalse(j.claim("run", self.packet())["claimed"])
            self.assertEqual(j.unreviewed("run", [self.proposal]), [])
            self.assertEqual(j.db.execute("SELECT COUNT(*) FROM selections").fetchone()[0], 0)
            j.close()

    def test_lab_initial_capital_is_explicit_and_review_requires_claim(self):
        with self.assertRaises(ValueError):
            SelectionLab(ResearchAccount(initial_cash=D("8")), {"fixture": "f"*64})
        with TemporaryDirectory() as directory:
            j = SelectionJournal(Path(directory)/"selection.sqlite")
            p = self.packet()
            with self.assertRaises(ValueError):
                j.record("run", p, self.response(p), self.select(p), NOW)
            j.close()
