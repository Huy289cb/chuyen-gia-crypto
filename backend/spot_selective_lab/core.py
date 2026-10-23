"""Observe/prepare/select/revalidate without any exchange or provider capability.

The reused planner describes a SOL fee/filter scenario, not current exchange
rules or a profitable strategy. A BUY here is an offline selection only.
"""
from __future__ import annotations

from dataclasses import dataclass
from collections import OrderedDict
from decimal import Decimal, localcontext
import hashlib
import json
from typing import Any, Mapping

from spot_aggressive_v3.account import ResearchAccount
from spot_backtest.account import exact

SCHEMA = "spot-selective-lab-v1"
DECISION_DEADLINE_US = 15_000_000
MAX_SIGNAL_AGE_US = 20 * 60_000_000
MAX_QUOTE_AGE_US = 60_000_000
REASONS = frozenset({"RECOVERY_CONFIRMED", "CONTEXT_WEAK", "COST_TOO_HIGH",
                     "WAIT_FOR_CONFIRMATION", "NO_CLEAR_ADVANTAGE"})


def serial(value: Any) -> Any:
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError("non-finite Decimal")
        return format(value, "f")
    if isinstance(value, Mapping):
        if any(not isinstance(k, str) for k in value):
            raise ValueError("JSON keys must be strings")
        return {k: serial(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serial(v) for v in value]
    if value is None or type(value) in (str, int, bool):
        return value
    raise ValueError("exact JSON values required; floats are not accepted")


def canonical(value: Any) -> str:
    return json.dumps(serial(value), sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def timestamp(value: Any) -> int:
    if type(value) is not int or value < 0:
        raise ValueError("nonnegative integer microsecond timestamp required")
    return value


@dataclass(frozen=True)
class Evidence:
    evidence_id: str
    available_us: int
    values: Mapping[str, Any]


@dataclass(frozen=True)
class Proposal:
    candidate_id: str
    mechanism_id: str
    episode_id: str
    symbol: str
    signal_us: int
    reference: Decimal
    stop: Decimal
    hurdle: Decimal
    target: Decimal | None
    evidence: tuple[Evidence, ...]


class SelectionLab:
    """Registry permits new mechanisms; first feasibility adapter is SOL only.

    Registry hashes identify reviewed generator versions. RESEARCH_ONLY is
    explicit even when a technical plan is feasible. No buy/sell method is used.
    """
    def __init__(self, account: ResearchAccount, registry: Mapping[str, str]):
        if account.initial_cash != Decimal("15"):
            raise ValueError("this research branch starts at exactly 15 USDT")
        if not registry or any(not isinstance(k, str) or not k or
                               not isinstance(v, str) or len(v) != 64 or
                               any(c not in "0123456789abcdef" for c in v)
                               for k, v in registry.items()):
            raise ValueError("registry needs mechanism IDs and source SHA256s")
        self.account = account
        self.registry = dict(registry)
        # Hashes are integrity fingerprints, not authentication. Only packets
        # prepared by this instance can be reviewed; persisted ones are history.
        self._issued_hashes: OrderedDict[str, None] = OrderedDict()

    def state(self, headroom: Decimal, position_open: bool) -> dict[str, Any]:
        if type(position_open) is not bool:
            raise ValueError("position_open must be bool")
        return serial({"cash": self.account.cash, "inventory_sol": self.account.inventory,
                       "initial_cash": self.account.initial_cash,
                       "daily_headroom": exact(headroom), "position_open": position_open,
                       "slip": self.account.slip, "buy_fee": self.account.buy_fee,
                       "sell_fee": self.account.sell_fee,
                       "min_notional": self.account.min_notional,
                       "partial_fraction": self.account.partial_fraction})

    def packet(self, proposals: list[Proposal], *, as_of_us: int, quote: Mapping[str, Any],
               headroom: Decimal, position_open: bool = False) -> dict[str, Any]:
        now = timestamp(as_of_us)
        q = serial(quote)
        if set(q) != {"symbol", "reference", "available_us", "snapshot_id"}:
            raise ValueError("explicit quote identity and cutoff required")
        at = timestamp(q["available_us"])
        price = exact(q["reference"])
        if q["symbol"] != "SOLUSDT" or not isinstance(q["snapshot_id"], str) or not q["snapshot_id"]:
            raise ValueError("first adapter requires SOLUSDT quote identity")
        if price <= 0 or not 0 <= now - at <= MAX_QUOTE_AGE_US:
            raise ValueError("quote is incomplete, future-dated or stale")
        state = self.state(headroom, position_open)
        if self.account.partial_fraction != 1:
            raise ValueError("this lab has not validated partial-fill feasibility")
        admitted, rejected, seen_ids, seen_episodes = [], [], set(), set()
        for p in sorted(proposals, key=lambda p: (-timestamp(p.signal_us), p.candidate_id)):
            codes = []
            if not all(isinstance(v, str) and v for v in
                       (p.candidate_id, p.mechanism_id, p.episode_id, p.symbol)):
                raise ValueError("candidate identity must be nonempty strings")
            identity = (p.symbol, p.episode_id)
            if p.candidate_id in seen_ids or identity in seen_episodes:
                codes.append("DUPLICATE_ID_OR_EPISODE")
            seen_ids.add(p.candidate_id)
            seen_episodes.add(identity)
            if p.mechanism_id not in self.registry:
                codes.append("UNREGISTERED_MECHANISM")
            if p.symbol != "SOLUSDT":
                codes.append("UNSUPPORTED_SYMBOL")
            if not 0 <= now - p.signal_us <= MAX_SIGNAL_AGE_US:
                codes.append("STALE_OR_FUTURE_SIGNAL")
            if at < p.signal_us:
                codes.append("QUOTE_PRECEDES_SIGNAL")
            if position_open or self.account.inventory >= Decimal(".001"):
                codes.append("POSITION_OCCUPIED")
            if not p.evidence:
                codes.append("MISSING_EVIDENCE")
            ids = set()
            evidence = []
            for item in p.evidence:
                cutoff = timestamp(item.available_us)
                if (not isinstance(item.evidence_id, str) or not item.evidence_id or
                        item.evidence_id in ids or cutoff > p.signal_us):
                    codes.append("INVALID_OR_FUTURE_EVIDENCE")
                ids.add(item.evidence_id)
                evidence.append({"evidence_id": item.evidence_id,
                                 "available_us": cutoff, "values": serial(item.values)})
            plan = None
            if not codes:
                with localcontext() as ctx:
                    ctx.prec = 50
                    risk = min(Decimal("1.50"), self.account.nav(price) / 10)
                plan = self.account.plan_entry(price, p.stop, p.target, risk, headroom, p.hurdle)
                if plan["eligible"] is not True:
                    codes.extend(plan["reasons"])
            if codes:
                rejected.append({"candidate_id": p.candidate_id, "mechanism_id": p.mechanism_id,
                                 "episode_id": p.episode_id, "symbol": p.symbol,
                                 "reasons": sorted(set(codes))})
                continue
            admitted.append(serial({"candidate_id": p.candidate_id, "mechanism_id": p.mechanism_id,
                                    "source_sha256": self.registry[p.mechanism_id],
                                    "source_status": "RESEARCH_ONLY", "episode_id": p.episode_id,
                                    "symbol": p.symbol, "signal_us": p.signal_us,
                                    "signal_reference": p.reference, "evidence": evidence,
                                    "plan": plan}))
        batch_key = sorted({(p.symbol, p.episode_id) for p in proposals})
        result = {"schema_version": SCHEMA, "mode": "OFFLINE_SELECTION_ONLY",
                  "as_of_us": now, "response_deadline_us": now + DECISION_DEADLINE_US,
                  "registry": self.registry, "account_state": state, "quote": q,
                  "opportunity_batch_id": digest(batch_key), "candidates": admitted,
                  "rejected": rejected, "request_model": bool(admitted),
                  "profitability": "NOT_MEASURED", "live_authorization": False,
                  "ranking": "chronological_stable_order_not_expected_return"}
        result = serial(result)
        if len(canonical(result).encode()) > 64_000:
            raise ValueError("packet exceeds offline size limit")
        result["packet_hash"] = digest(result)
        self._issued_hashes[result["packet_hash"]] = None
        if len(self._issued_hashes) > 128:
            self._issued_hashes.popitem(last=False)
        return result

    def select(self, packet: Mapping[str, Any], reply: Mapping[str, Any] | None, *,
               received_at_us: int, quote: Mapping[str, Any], headroom: Decimal,
               position_open: bool = False) -> dict[str, Any]:
        """Strict choice contract and independent present-state revalidation.

        Returns a record, never an order intent. Malformed replies become system
        WAIT, distinct from an explicit model WAIT. Confidence and sizing fields
        are rejected. Changes in the quote/account require a new preparation.
        """
        def wait(reason):
            return {"mode": "OFFLINE_SELECTION_ONLY", "decision": "WAIT",
                    "origin": "SYSTEM", "reason": reason, "candidate_id": None,
                    "execution_permitted": False, "profitability": "NOT_MEASURED"}
        try:
            now = timestamp(received_at_us)
            body = {k: v for k, v in packet.items() if k != "packet_hash"}
            if digest(body) != packet["packet_hash"]:
                return wait("PACKET_CHANGED")
            if packet["packet_hash"] not in self._issued_hashes:
                return wait("PACKET_NOT_PREPARED_BY_THIS_INSTANCE")
            if packet["schema_version"] != SCHEMA or packet["registry"] != self.registry:
                return wait("SOURCE_OR_SCHEMA_CHANGED")
            if not packet["as_of_us"] <= now <= packet["response_deadline_us"]:
                return wait("STALE_OR_FUTURE_RESPONSE")
            if serial(quote) != packet["quote"] or self.state(headroom, position_open) != packet["account_state"]:
                return wait("QUOTE_OR_ACCOUNT_CHANGED")
            if not 0 <= now - timestamp(packet["quote"]["available_us"]) <= MAX_QUOTE_AGE_US:
                return wait("QUOTE_EXPIRED_DURING_REVIEW")
            if not packet["candidates"]:
                return wait("NO_FEASIBLE_CANDIDATE")
            if not isinstance(reply, Mapping):
                return wait("MISSING_MODEL_RESPONSE")
            expected = {"schema_version", "packet_hash", "decision", "candidate_id",
                        "reason_codes", "evidence_ids"}
            if set(reply) != expected or reply["schema_version"] != SCHEMA or reply["packet_hash"] != packet["packet_hash"]:
                return wait("INVALID_RESPONSE_SCHEMA_OR_PACKET")
            action = reply["decision"]
            if action not in ("BUY", "WAIT", "VETO"):
                return wait("INVALID_DECISION")
            reasons, evidence_ids = reply["reason_codes"], reply["evidence_ids"]
            if (type(reasons) is not list or not reasons or len(reasons) > 5 or
                    any(type(v) is not str or v not in REASONS for v in reasons) or
                    type(evidence_ids) is not list or len(evidence_ids) > 20 or
                    any(type(v) is not str for v in evidence_ids)):
                return wait("INVALID_REASONS_OR_EVIDENCE")
            selected = None
            if action in ("BUY", "VETO"):
                selected = next((c for c in packet["candidates"] if c["candidate_id"] == reply["candidate_id"]), None)
                if selected is None or not evidence_ids:
                    return wait("UNKNOWN_CANDIDATE_OR_MISSING_EVIDENCE")
                if now - selected["signal_us"] > MAX_SIGNAL_AGE_US:
                    return wait("SIGNAL_EXPIRED_DURING_REVIEW")
                known = {e["evidence_id"] for e in selected["evidence"]}
            else:
                if reply["candidate_id"] is not None:
                    return wait("WAIT_HAS_CANDIDATE")
                known = {e["evidence_id"] for c in packet["candidates"] for e in c["evidence"]}
            if not set(evidence_ids) <= known:
                return wait("UNKNOWN_EVIDENCE")
            if action == "BUY":
                p = selected["plan"]
                renewed = self.account.plan_entry(p["ref_price"], p["stop"], p["target"],
                                                 p["risk_limit"], headroom, p["hurdle_price"])
                if renewed["eligible"] is not True or serial(renewed) != p:
                    return wait("PLAN_NO_LONGER_FEASIBLE")
            return {"mode": "OFFLINE_SELECTION_ONLY", "decision": action,
                    "origin": "MODEL_RESPONSE_FIXTURE", "reason_codes": reasons,
                    "candidate_id": reply["candidate_id"], "evidence_ids": evidence_ids,
                    "execution_permitted": False, "profitability": "NOT_MEASURED"}
        except (ValueError, TypeError, KeyError, ArithmeticError):
            return wait("MALFORMED_PACKET_OR_RESPONSE")
