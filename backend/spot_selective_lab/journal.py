"""Durable pre-review claims and append-only choices; no provider/broker client.

An unfinished claim survives a crash and is not retried automatically.
Provider billing reconciliation is not implemented by this offline module.
"""
from pathlib import Path
import json
import sqlite3

from .core import canonical, timestamp


class SelectionJournal:
    def __init__(self, path: Path):
        self.db = sqlite3.connect(path)
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS review_claims (
            run_id TEXT NOT NULL, batch_id TEXT NOT NULL, packet_hash TEXT NOT NULL,
            PRIMARY KEY (run_id, batch_id));
          CREATE TABLE IF NOT EXISTS episode_claims (
            run_id TEXT NOT NULL, symbol TEXT NOT NULL, episode_id TEXT NOT NULL,
            batch_id TEXT NOT NULL, PRIMARY KEY (run_id, symbol, episode_id));
          CREATE TABLE IF NOT EXISTS selections (
            run_id TEXT NOT NULL, batch_id TEXT NOT NULL, packet_hash TEXT NOT NULL,
            received_at_us INTEGER NOT NULL, record TEXT NOT NULL,
            PRIMARY KEY (run_id, batch_id));
        """)

    @staticmethod
    def _run(run_id):
        if not isinstance(run_id, str) or not run_id:
            raise ValueError("explicit run identity required")

    def unreviewed(self, run_id, proposals):
        self._run(run_id)
        claimed = set(self.db.execute("SELECT symbol,episode_id FROM episode_claims WHERE run_id=?", (run_id,)))
        return [p for p in proposals if (p.symbol, p.episode_id) not in claimed]

    def claim(self, run_id, packet):
        """Claim episodes before review; overlapping batches are refused.

        Filter unreviewed() before building a later batch to retain new arrivals
        without reviewing old episodes again.
        """
        self._run(run_id)
        batch = packet["opportunity_batch_id"]
        episodes = sorted({(c["symbol"], c["episode_id"])
                           for c in packet["candidates"] + packet["rejected"]})
        if not episodes:
            return {"claimed": False, "reason": "EMPTY_BATCH"}
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            old = self.db.execute("SELECT packet_hash FROM review_claims WHERE run_id=? AND batch_id=?",
                                  (run_id, batch)).fetchone()
            if old:
                return {"claimed": False, "reason": "BATCH_ALREADY_CLAIMED"}
            for symbol, episode in episodes:
                if self.db.execute("SELECT 1 FROM episode_claims WHERE run_id=? AND symbol=? AND episode_id=?",
                                   (run_id, symbol, episode)).fetchone():
                    return {"claimed": False, "reason": "EPISODE_ALREADY_CLAIMED"}
            self.db.execute("INSERT INTO review_claims VALUES (?,?,?)", (run_id, batch, packet["packet_hash"]))
            self.db.executemany("INSERT INTO episode_claims VALUES (?,?,?,?)",
                                [(run_id, symbol, episode, batch) for symbol, episode in episodes])
        return {"claimed": True, "reason": "CLAIMED_OFFLINE_REVIEW"}

    def record(self, run_id, packet, reply, result, received_at_us):
        self._run(run_id)
        timestamp(received_at_us)
        claimed = self.db.execute("SELECT packet_hash FROM review_claims WHERE run_id=? AND batch_id=?",
                                  (run_id, packet["opportunity_batch_id"])).fetchone()
        if not claimed or claimed[0] != packet["packet_hash"]:
            raise ValueError("matching durable claim required before recording a review")
        if result.get("execution_permitted") is not False:
            raise ValueError("journal accepts offline records only")
        record = canonical({"packet": packet, "reply": reply, "result": result,
                            "received_at_us": received_at_us})
        with self.db:
            cursor = self.db.execute("INSERT OR IGNORE INTO selections VALUES (?, ?, ?, ?, ?)",
                                     (run_id, packet["opportunity_batch_id"], packet["packet_hash"],
                                      received_at_us, record))
            row = self.db.execute("SELECT record FROM selections WHERE run_id=? AND batch_id=?",
                                  (run_id, packet["opportunity_batch_id"])).fetchone()
        return {"inserted": cursor.rowcount == 1, "saved_record": json.loads(row[0]),
                "execution_permitted": False, "is_historical_record_only": cursor.rowcount != 1}

    def close(self):
        self.db.close()
