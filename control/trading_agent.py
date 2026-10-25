"""Trading-agent monitor — reads the standalone paper-trading bot for the panel.

Source of truth: <repo>/trading-agent/ (`bot.py --loop` writing a SQLite paper
ledger and logs/paper.log). This module NEVER writes to those files and never
places orders: it is read-only telemetry for the Empire Control Panel.

  /api/tradingagent → snapshot() below

It also runs readiness.review() (the go-live gate used by the bot itself) so
the panel shows the same verdict the bot enforces.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TA_DIR = REPO / "trading-agent"
sys.path.insert(0, str(TA_DIR))

import readiness  # type: ignore  # noqa: E402
import notify as tg  # type: ignore  # noqa: E402

PRICE_TTL = 120
# net sell proceeds fraction for the mock-to-live mark: 1 − taker(0.17%) − TDS(1%)
SELL_NET_FRAC = 0.9883
_price_cache: dict[str, tuple[float, float]] = {}


def _live_price(pair: str = "BTCINR") -> float | None:
    """Bright price mark for the open position (CoinDCX public ticker, no key)."""
    hit = _price_cache.get(pair)
    if hit and time.time() - hit[0] < PRICE_TTL:
        return hit[1]
    api_pair = pair if "_" in pair else ("B-" + pair[:-3] + "_" + pair[-3:])
    try:
        req = urllib.request.Request("https://api.coindcx.com/exchange/v1/tickers")
        with urllib.request.urlopen(req, timeout=15) as r:
            rows = json.load(r)
    except Exception:
        return hit[1] if hit else None
    px = next((float(t["last_price"]) for t in rows
               if str(t.get("markets", t.get("market", ""))).upper() == api_pair), None)
    if px:
        _price_cache[pair] = (time.time(), px)
    return px


def _log_tail(path: Path, lines: int = 12) -> list[str]:
    if not path.is_file():
        return []
    blob = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return [l for l in blob[-lines:] if l.strip()][-lines:]


def _loop_alive() -> dict:
    """Liveness from the log heartbeat (portable; no process listing needed)."""
    logp = TA_DIR / "logs" / "paper.log"
    if logp.is_file():
        age = time.time() - logp.stat().st_mtime
        return {"alive": age < 3600, "last_write_age_minutes": round(age / 60)}
    return {"alive": False, "last_write_age_minutes": None}


def _summary_lines(path: Path, n: int = 5) -> list[str]:
    return _log_tail(path, n)


def snapshot() -> dict:
    db = TA_DIR / "paper.ledger.db"
    out: dict = {"available": db.is_file(),
                 "dir": "trading-agent", "notify": tg.enabled(),
                 "notify_ok": notify_state}
    if not db.is_file():
        out["note"] = ("paper ledger not found — run "
                       "trading-agent/run-paper.bat once to start the bot")
        return out
    conn = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        notify_state = tg.verify()          # True | False | None(unconfigured)
    except Exception:
        notify_state = None
    try:
        with conn:
            rows = [dict(r) for r in conn.execute("SELECT * FROM fills ORDER BY id")]
            held = next((r for r in reversed(rows) if r["side"] == "buy"), None)
            sells_after = conn.execute(
                "SELECT 1 FROM fills WHERE side='sell' AND id>? LIMIT 1",
                (held["id"],)).fetchone() if held else None
            open_pos = held if (held and not sells_after) else None
            state_stop = conn.execute(
                "SELECT value FROM state WHERE key='stop_price'").fetchone()
        st_days = 0.0
        if rows:
            st_days = (time.time() - min(r["ts"] for r in rows)) / 86400
        realized = sum(float(r["note"].split()[-1]) for r in rows
                       if r["side"] == "sell" and r["note"].startswith("pnl"))
        wins = [float(r["note"].split()[-1]) for r in rows
                if r["side"] == "sell" and r["note"].startswith("pnl")]
        entry_inr = None
        mark = None
        upl = None
        if open_pos:
            pair = open_pos["pair"]
            mark = _live_price(pair)
            entry_inr = open_pos["notional_inr"] - open_pos["fee_inr"]
            if mark:
                upl = round(open_pos["qty"] * mark * SELL_NET_FRAC - entry_inr, 2)
        last_banner = ""
        for l in _log_tail(TA_DIR / "logs" / "paper.log", 30):
            if l.startswith("trading-agent"):
                last_banner = l
        decisions = []
        for l in _log_tail(TA_DIR / "logs" / "paper.log", 40):
            if l.startswith("{"):
                try:
                    j = json.loads(l)
                    decisions.append({
                        "ts": j.get("ts"), "price": j.get("price"),
                        "signal": j.get("signal"), "reason": j.get("reason"),
                        "risk": j.get("risk"), "equity": j.get("equity"),
                        "executed": bool(j.get("executed"))})
                except Exception:
                    pass
        out.update({
            "parity": last_banner or "unknown", "exchange": _exchange_of(last_banner),
            "loop": _loop_alive(),
            "capital": float(os.getenv("TRADING_CAPITAL", "500")),
            "evidence_days": round(st_days, 1),
            "fills": rows[-8:],
            "fill_count": len(rows),
            "realized_pnl": round(realized, 2),
            "win_rate_pct": round(100 * sum(1 for w in wins if w > 0) / len(wins)) if wins else None,
            "open_position": dict(open_pos) if open_pos else None,
            "open_mark": None if mark is None else round(mark, 2),
            "open_unrealized": upl,
            "equity_now": round(500.0 + realized + (upl or 0), 2),
            "stop_price": state_stop["value"] if state_stop else None,
            "decisions": decisions[-6:],
            "readiness": readiness.review(),
            "summary_log": _summary_lines(TA_DIR / "logs" / "summary.log"),
        })
        out["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
        env = _ta_env()
        out["live_mode"] = env.get("LIVE_MODE") == "1"
        out["coindcx_keys"] = bool(env.get("COINDCX_API_KEY") and env.get("COINDCX_API_SECRET"))
        out["cap_set"] = bool(env.get("TRADING_CAPITAL"))
        cap = env.get("TRADING_CAPITAL")
        if cap:
            try:
                out["capital"] = float(cap)
                out["equity_now"] = round(float(cap) + realized + (upl or 0), 2)
            except ValueError:
                pass
        try:
            os.environ.setdefault("ADVISOR", "1")
            import advisor as _advisor  # type: ignore
            out["advisor"] = bool(_advisor.enabled())
        except Exception:
            out["advisor"] = False
        return out
    finally:
        conn.close()


def _exchange_of(banner: str) -> str:
    m = re.match(r"trading-agent (\w+) (\w+)", banner)
    if m:
        return f"{m.group(1)} ({m.group(2).lower()})"
    return "?"


def _ta_env() -> dict[str, str]:
    out: dict[str, str] = {}
    envp = TA_DIR / ".env"
    if envp.is_file():
        for line in envp.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^([A-Z][A-Z0-9_]+)=(.*)$", line.strip())
            if m and m.group(2).strip():
                out[m.group(1)] = m.group(2).strip()
    return out


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(json.dumps(snapshot(), indent=2, default=str))
