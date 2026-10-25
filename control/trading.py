"""Trading signals module — technical analysis on Indian equities.

Data path: Yahoo Finance chart API (no key, no dependency). This gives
daily candles for any .NS/.BSE symbol, enough for SMA/RSI/momentum signals.

AngelOne SmartAPI note (verified 2026): the api_key alone cannot fetch
anything — generateSession needs CLIENT CODE + TOTP PIN too, and since
Apr-2026 all API orders must come from a whitelisted static IP. So live
broker integration stays dormant; signals here are computed from public
market data instead. No orders are ever placed by this module.

Signal rules (transparent, rule-based — not a guarantee):
  BUY   : uptrend (price > SMA20 > SMA50) with RSI14 < 65, or RSI14 < 30 (oversold)
  AVOID : price < SMA50 (downtrend) or RSI14 > 70 (overbought)
  HOLD  : everything else
"""
from __future__ import annotations

import json
import os
import re
import time
import urllib.request
from pathlib import Path

STATE = Path(__file__).resolve().parent.parent / "state"
REPO = Path(__file__).resolve().parent.parent
UA = {"User-Agent": "Mozilla/5.0 (empire-monitor)"}
_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = 300  # 5 min


def _yahoo_chart(symbol: str) -> dict:
    """Daily candles for symbol (e.g. 'RELIANCE.NS'). 6 months."""
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
           f"?range=6mo&interval=1d")
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def _series(symbol: str) -> list[float]:
    data = _yahoo_chart(symbol)
    res = data["chart"]["result"][0]
    return [c for c in (res["indicators"]["quote"][0].get("close") or [])
            if c is not None]


def _sma(closes: list[float], n: int) -> float | None:
    if len(closes) < n:
        return None
    return sum(closes[-n:]) / n


def _rsi(closes: list[float], n: int = 14) -> float | None:
    if len(closes) < n + 1:
        return None
    gains = losses = 0.0
    for a, b in zip(closes[-(n + 1):-1], closes[-n:]):
        diff = b - a
        if diff > 0:
            gains += diff
        else:
            losses -= diff
    if losses == 0:
        return 100.0
    rs = (gains / n) / (losses / n)
    return 100 - (100 / (1 + rs))


def _signal(symbol: str) -> dict:
    try:
        closes = _series(symbol)
        if len(closes) < 50:
            return {"symbol": symbol, "signal": "NO DATA", "err": "not enough history"}
        price = closes[-1]
        sma20, sma50 = _sma(closes, 20), _sma(closes, 50)
        rsi = _rsi(closes)
        mom5 = (price / closes[-6] - 1) * 100 if len(closes) > 6 else 0
        if price > sma20 > sma50 and rsi < 65:
            sig = "BUY"
            why = f"uptrend (>{sma20:.0f}>{sma50:.0f}), RSI {rsi:.0f} not overbought"
        elif rsi is not None and rsi < 30:
            sig = "BUY"
            why = f"oversold (RSI {rsi:.0f}) — mean-reversion setup"
        elif rsi is not None and rsi > 70:
            sig = "AVOID"
            why = f"overbought (RSI {rsi:.0f}) — wait for pullback"
        elif sma50 and price < sma50:
            sig = "AVOID"
            why = f"below SMA50 ({sma50:.0f}) — downtrend"
        else:
            sig = "HOLD"
            why = f"RSI {rsi:.0f}, between SMAs — no edge"
        return {"symbol": symbol, "price": round(price, 2), "rsi": round(rsi, 1),
                "sma20": round(sma20, 2), "sma50": round(sma50, 2),
                "mom5d": round(mom5, 1), "signal": sig, "why": why}
    except Exception as err:  # noqa: BLE001
        return {"symbol": symbol, "signal": "NO DATA", "err": str(err)[:120]}


DEFAULT_WATCHLIST = ["RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
                     "TATAMOTORS.NS", "ITC.NS", "SBIN.NS"]


def _portfolio() -> dict:
    pf = STATE / "portfolio.json"
    if not pf.is_file():
        return {"holdings": [], "watchlist": DEFAULT_WATCHLIST}
    try:
        data = json.loads(pf.read_text(encoding="utf-8"))
        data.setdefault("watchlist", DEFAULT_WATCHLIST)
        return data
    except Exception:  # noqa: BLE001
        return {"holdings": [], "watchlist": DEFAULT_WATCHLIST}


def save_portfolio(payload: dict) -> dict:
    """Merge holdings [{symbol, qty, buy_price}] and watchlist symbols."""
    data = _portfolio()
    holdings = {}
    for h in data.get("holdings", []):
        holdings[h["symbol"]] = h
    for h in payload.get("holdings", []):
        sym = str(h.get("symbol", "")).upper().strip()
        if not sym:
            continue
        if ".NS" not in sym and ".BO" not in sym:
            sym += ".NS"
        if h.get("qty") and float(h["qty"]) > 0:
            holdings[sym] = {"symbol": sym, "qty": float(h["qty"]),
                             "buy_price": float(h.get("buy_price") or 0)}
        else:
            holdings.pop(sym, None)  # sold / removed
    data["holdings"] = list(holdings.values())
    if isinstance(payload.get("watchlist"), list):
        wl = []
        for s in payload["watchlist"]:
            s = str(s).upper().strip()
            if s:
                wl.append(s if (".NS" in s or ".BO" in s) else s + ".NS")
        data["watchlist"] = list(dict.fromkeys(wl))[:15]
    STATE.mkdir(parents=True, exist_ok=True)
    (STATE / "portfolio.json").write_text(json.dumps(data, indent=1), encoding="utf-8")
    return data


# --- AngelOne SmartAPI live holdings (read-only; never places orders) -------

_ANGEL_KEYS = ("ANGELONE_API_KEY", "ANGELONE_CLIENT_CODE",
               "ANGELONE_PIN", "ANGELONE_TOTP_SECRET")
_angel_cache: dict[str, tuple[float, dict]] = {}
_ANGEL_TTL = 600  # 10 min — holdings don't change that fast


def _load_angel_env() -> dict[str, str]:
    """Read ANGELONE_* from root/.env (values never logged)."""
    out: dict[str, str] = {}
    envp = REPO / ".env"
    if not envp.is_file():
        return out
    for line in envp.read_text(encoding="utf-8", errors="replace").splitlines():
        m = re.match(r"^(ANGELONE_[A-Z_]+)=(.*)$", line.strip())
        if m and m.group(2).strip():
            out[m.group(1)] = m.group(2).strip()
    return out


def angel_ready() -> bool:
    env = _load_angel_env()
    return all(env.get(k) for k in _ANGEL_KEYS[:3])


def angel_holdings(force: bool = False) -> dict:
    """Live holdings via SmartAPI generateSession + getHolding.

    Read-only (no order endpoints are ever called). Returns a status dict:
      {available: bool, holdings: [...], error?: str}
    Session tokens live in memory only and are never written to disk.
    """
    cached = _angel_cache.get("v")
    if not force and cached and time.time() - cached[0] < _ANGEL_TTL:
        return cached[1]

    env = _load_angel_env()
    missing = [k for k in _ANGEL_KEYS[:3] if not env.get(k)]
    if missing:
        return {"available": False, "holdings": [],
                "error": "missing keys: " + ", ".join(missing)}
    try:
        from SmartApi import SmartConnect  # type: ignore  # smartapi-python
        import pyotp  # type: ignore
    except ImportError as err:
        return {"available": False, "holdings": [],
                "error": f"smartapi-python not installed ({err})"}

    try:
        sc = SmartConnect(api_key=env["ANGELONE_API_KEY"])
        totp = (pyotp.TOTP(env["ANGELONE_TOTP_SECRET"]).now()
                if env.get("ANGELONE_TOTP_SECRET") else env["ANGELONE_PIN"])
        session = sc.generateSession(env["ANGELONE_CLIENT_CODE"],
                                     env["ANGELONE_PIN"], totp)
        if (session or {}).get("status") is not True:
            msg = str((session or {}).get("message") or "login refused")[:140]
            return {"available": False, "holdings": [], "error": msg}
        try:
            resp = sc.holding()  # SmartAPI 1.5.x method for the holdings book
            if (resp or {}).get("status") is not True:
                return {"available": False, "holdings": [],
                        "error": str(resp.get("message") or "holding fetch refused")[:140]}
            rows = resp.get("data") or []
            holdings = []
            for h in rows:
                try:
                    # total qty = normal + T1 (unsettled) + collateral
                    qty = (float(h.get("quantity") or 0)
                           + float(h.get("t1quantity") or 0)
                           + float(h.get("collateralquantity") or 0))
                    if qty <= 0:
                        continue
                    avg = float(h.get("averageprice") or 0)
                    ltp = float(h.get("ltp") or 0)
                    pnl = (float(h.get("profitandloss") or 0)
                           or round((ltp - avg) * qty, 2))
                    holdings.append({
                        "symbol": (h.get("tradingsymbol") or "?").split("-")[0],
                        "qty": qty, "buy_price": round(avg, 2), "current": round(ltp, 2),
                        "pl": round(pnl, 2), "source": "angelone",
                    })
                except Exception:  # noqa: BLE001
                    continue
            out = {"available": True, "holdings": holdings,
                   "note": "read-only via SmartAPI holding()"}
        finally:
            try:
                sc.terminateSession(env["ANGELONE_CLIENT_CODE"])
            except Exception:  # noqa: BLE001
                pass  # best-effort logout; token dies with the process anyway
    except Exception as err:  # noqa: BLE001
        msg = str(err)
        # Never leak credentials in errors; common causes get friendly hints.
        if "IP" in msg or "whitelist" in msg.lower():
            msg = "refused: static IP not whitelisted for this API key"
        return {"available": False, "holdings": [], "error": msg[:160]}

    _angel_cache["v"] = (time.time(), out)
    return out


def snapshot() -> dict:
    """Portfolio valuation + watchlist signals (cached 5 min)."""
    cached = _CACHE.get("v")
    if cached and time.time() - cached[0] < _TTL:
        return cached[1]
    data = _portfolio()
    holdings = []
    invested = value = 0.0

    # Live broker holdings take priority when credentials are configured;
    # manually-entered holdings still merge in for anything AngelOne doesn't
    # return (sold-out positions, other brokers, manual watch entries).
    angel = angel_holdings()
    angel_syms = {h["symbol"] for h in angel.get("holdings", [])}
    for h in angel.get("holdings", []):
        invested += h["buy_price"] * h["qty"]
        value += h["current"] * h["qty"]
        holdings.append({**h, "signal": "—", "why": "live from AngelOne"})
    for h in data["holdings"]:
        base = h["symbol"].split(".")[0]
        if base in angel_syms:
            continue  # broker already reports this one — no double count
        sig = _signal(h["symbol"])
        cur = (sig.get("price") or 0) * h["qty"]
        invested += h["buy_price"] * h["qty"]
        value += cur
        holdings.append({**h, "current": round(cur, 2),
                         "pl": round(cur - h["buy_price"] * h["qty"], 2),
                         "signal": sig.get("signal", "—"),
                         "why": sig.get("why", "")})
    watch = [_signal(s) for s in data["watchlist"]]
    if angel.get("available"):
        broker_note = f"AngelOne live holdings: {len(angel['holdings'])} (read-only)"
    elif angel.get("error"):
        broker_note = f"AngelOne: {angel['error']}"
    else:
        broker_note = "AngelOne: not configured (add keys in Shared keys)"
    out = {"holdings": holdings, "watchlist": watch,
           "invested": round(invested, 2), "value": round(value, 2),
           "pl": round(value - invested, 2),
           "data_source": "Yahoo Finance daily candles (public, no key)",
           "broker_integration": broker_note,
           "disclaimer": "Rule-based educational signals, not financial advice.",
           "ts": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}
    _CACHE["v"] = (time.time(), out)
    return out
