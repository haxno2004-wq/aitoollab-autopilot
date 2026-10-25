"""Autopilot — the unattended watchdog that keeps the empire self-running.

Design contract (deliberately conservative):
  * Runs standalone (Task-Scheduler friendly, survives panel being closed).
  * TELEGRAM-ONLY reporting, event-driven: it stays silent unless something
    REAL happens — a fill, the bot dying/reviving, a live-mode flip, a
    readiness-gate change, a failing income system, a sale, or a big
    portfolio move. Plus one short daily digest. No spam.
  * It never places, modifies or cancels any order and never flips live
    mode. It READS state and TALKS on Telegram. That's it.
  * State for de-duplication lives in control/autopilot_state.json.

Usage:
  python autopilot.py --once   # single check (also used by the panel test)
  python autopilot.py          # forever, every AUTOPILOT_MINUTES (default 10)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "trading-agent"))

STATE = HERE / "autopilot_state.json"
REFRESH_TTL = 240         # seconds between full snapshot refreshes
DIGEST_HOUR = 8           # local hour (24h) for the daily digest
PORTFOLIO_MOVE_PCT = 3.0  # only alert on moves bigger than this

STATE_DEFAULT = {"last_cycle": 0, "cycles": 0, "alerts_sent": 0,
                 "last_digest_day": "", "started": ""}

_snaps: dict[str, tuple[float, dict]] = {}


def _snap(key: str, fn, ttl: float = REFRESH_TTL):
    hit = _snaps.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        val = fn()
    except Exception as e:                                  # noqa: BLE001
        val = {"error": str(e)[:160]}
    _snaps[key] = (time.time(), val)
    return val


def _load_state() -> dict:
    if STATE.is_file():
        try:
            return {**STATE_DEFAULT, **json.loads(STATE.read_text(encoding="utf-8"))}
        except Exception:
            pass
    return dict(STATE_DEFAULT)


def _save_state(st: dict) -> None:
    STATE.write_text(json.dumps(st, indent=1, default=str), encoding="utf-8")


def status_line(st: dict) -> dict:
    """For the panel: is the watchdog itself alive, what did it last see."""
    out = {"available": True, "cycles": st.get("cycles", 0),
           "alerts_sent": st.get("alerts_sent", 0),
           "telegram": ({True: "working", False: "broken", None: "off"}
                        .get(st.get("tg_ok"), "unknown"))}
    if st.get("last_cycle"):
        age = round((time.time() - st["last_cycle"]) / 60, 0)
        out["last_cycle_minutes_ago"] = age
        out["alive"] = age < 3 * 60
    else:
        out["last_cycle_minutes_ago"] = None
        out["alive"] = False
    if st.get("digest_last"):
        out["digest_last"] = st["digest_last"]
    return out


def _alert(notify, st: dict, text: str) -> None:
    ok = bool(notify.send("🛰 autopilot · " + text))
    if ok:
        st["alerts_sent"] = st.get("alerts_sent", 0) + 1


def run_cycle(force: bool = False) -> dict:
    st = _load_state()
    if force or not st.get("started"):
        st["started"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
    st["cycles"] = st.get("cycles", 0) + 1
    st["last_cycle"] = time.time()

    import notify as tg           # trading-agent/notify.py — same shared keys
    import trading_agent          # panel monitor (read-only)
    import trading as portfolio   # AngelOne/NSE portfolio snapshot

    events: list[str] = []
    ta = _snap("ta", trading_agent.snapshot)
    pf = _snap("pf", lambda: portfolio.snapshot(), 600)

    # --- 0. telegram itself working? ------------------------------------------------
    try:
        tg_state = tg.verify()
    except Exception:
        tg_state = None
    if tg_state is False and st.get("tg_ok") is not False:
        events.append("⚠️ TELEGRAM not delivering — bot token rejected (401). "
                      "+ rotate TELEGRAM_BOT_TOKEN in the panel's Credentials tab")
    st["tg_ok"] = tg_state

    # --- 1. trading bot heartbeat ------------------------------------------------
    loop = (ta or {}).get("loop") or {}
    was = st.get("bot_alive")
    if not (ta or {}).get("available"):
        pass                                    # bot not started yet — don't nag
    elif loop.get("alive") is False and was is not False:
        events.append("⛔ trading bot loop DOWN (no log write >1h) — check trading-agent/logs/paper.log")
    elif loop.get("alive") is True and was is False:
        events.append("🟢 trading bot loop back ALIVE")
    st["bot_alive"] = loop.get("alive")

    # --- 2. mode flips (paper/live) ----------------------------------------------
    mode = "live" if (ta or {}).get("live_mode") else "paper"
    if st.get("mode") and st["mode"] != mode:
        events.append(f"⚙️ trading mode switched {st['mode'].upper()} → {mode.upper()}"
                      + (" (real orders!" if mode == "live" else " (back to safety)"))
    st["mode"] = mode

    # --- 3. fills -----------------------------------------------------------------
    fills = (ta or {}).get("fills") or []
    last_seen = st.get("last_fill_count", 0)
    nowe = len((ta or {}).get("fills", []))
    if st.get("last_fill_count") is not None and nowe > last_seen:
        for f in fills[-(nowe - last_seen):]:
            side = f.get("side", "?")
            events.append(
                f"💼 {side.upper()} {f.get('pair','?')} qty {f.get('qty')} @ ₹{f.get('price')} "
                f"(pnl ₹{f.get('pnl_inr', '—')}) · mode {mode}")
    st["last_fill_count"] = nowe if (ta or {}).get("available") else 0

    # --- 4. portfolio: big move or advisor verdict change ---------------------------
    pl = (pf or {}).get("pl") or 0
    invested = (pf or {}).get("invested") or 0
    pct = (100 * pl / invested) if invested else 0
    prev_pct = st.get("pf_pct")
    if prev_pct is not None and abs(pct - prev_pct) >= PORTFOLIO_MOVE_PCT:
        events.append(f"∑ portfolio moved {round(pct,1)}% (was {round(prev_pct,1)}%) "
                      f"P/L ₹{pl}")
    st["pf_pct"] = pct
    st["pf_pl"] = pl

    # --- 5. income systems failing / selling ---------------------------------------
    try:
        rev = _snap("rev", lambda: __import__("control_server").build_revenue(), 900)
    except Exception:
        rev = None
    if rev:
        sales = (rev.get("gumroad") or {}).get("sales", 0)
        if st.get("sales") is not None and sales > st["sales"]:
            events.append(f"💸 GUMROAD SALE! total sales {sales} · "
                          f"lifetime ${(rev.get('gumroad') or {}).get('revenue_usd', 0):.2f}")
        st["sales"] = sales
        pins = (rev.get("pinterest") or {}).get("failed", 0)
        if pins > (st.get("pins_failed", 0) or 0):
            events.append(f"⚠️ Pinterest pipeline failures: {pins}")
        st["pins_failed"] = pins

    # --- 6. readiness gate flips -----------------------------------------------------
    gw = "PASS" if (ta or {}).get("readiness", {}).get("ready") else "FAIL"
    if st.get("gate") and st["gate"] != gw:
        events.append(f"🚦 go-live readiness gate: {gw} "
                      f"({(ta or {}).get('readiness', {}).get('verdict', '')[:80]})")
    st["gate"] = gw

    # --- 7. daily digest (quiet) -------------------------------------------------------
    today = time.strftime("%Y-%m-%d")
    hour = time.localtime().tm_hour
    if st.get("last_digest_day") != today and hour >= DIGEST_HOUR:
        eq = (ta or {}).get("equity_now", "—")
        days = (ta or {}).get("evidence_days", 0)
        events.append(
            f"📋 daily digest: bot ₹{eq} ({days}d evidence) · portfolio P/L ₹{pl} "
            f"({round(pct,1)}%) · sales {st.get('sales', 0)} · autopilot cycles {st['cycles']}")
        st["last_digest_day"] = today
        st["digest_last"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())

    # push events
    for e in events[:6]:
        _alert(tg, st, e)

    if events:                                   # keep a small local log too
        logp = HERE / "autopilot.log"
        try:
            with open(logp, "a", encoding="utf-8") as h:
                h.write(f"[{time.strftime('%Y-%m-%d %H:%M')}] " + " | ".join(events[:6]) + "\n")
        except OSError:
            pass
    _save_state(st)
    return {"events": events, "state": status_line(st)}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="run one check and exit")
    ap.add_argument("--minutes", type=int, default=int(os.getenv("AUTOPILOT_MINUTES") or 10),
                    help="cycle interval")
    args = ap.parse_args()
    while True:
        try:
            r = run_cycle()
            if r["events"]:
                print(r["events"][-1], flush=True)
            else:
                print("…quiet", flush=True)
        except Exception as e:                       # noqa: BLE001
            print("autopilot error:", type(e).__name__, str(e)[:200], flush=True)
        if args.once:
            return 0
        time.sleep(max(2, args.minutes) * 60)


if __name__ == "__main__":
    sys.exit(main())
