"""Portfolio advisor — AI review of REAL broker holdings (read-only).

Feeds a compact summary of the AngelOne holdings (from control/trading.py's
read-only snapshot) to a free-tier LLM and returns, per stock:
  {symbol, verdict: hold|average|exit|recover, why}
plus an overall portfolio note. Hard rules, enforced after the model answers:
  * advisory only — this server NEVER places, modifies or cancels orders
  * verdicts outside the allowed set are coerced to "hold"
  * no API/key values are ever logged

Keys come from the root .env (GROQ_API_KEY | GEMINI_API_KEY |
OPENROUTER_API_KEY — any one). Without a key this module is a no-op and the
panel just shows the raw loss numbers.

  GET /api/advisor → {available, advice: [...], note, ts}
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
CACHE_TTL = 900.0
_cache: dict[str, tuple[float, dict]] = {}

_PROMPT = """You are the risk voice of an Indian retail investor's EQUITY portfolio
(NSE/BSE list, prices in INR). Data comes read-only from their AngelOne
broker account. The portfolio is currently in LOSS. For each stock decide
between:
  "average"  position size is sane, thesis intact, averaging down in SMALL
             steps is reasonable (only if the loss looks temporary/broad-market)
  "hold"     thesis intact, no action needed now
  "exit"     the stock is in a clear sustained downtrend or broke its story
  "recover"  wait for a bounce/analysis; do nothing mechanical
Be honest and short. You cannot see charts — use price level vs buy price,
loss size and concentration. Never give guarantees; losses may deepen.
Also give one overall portfolio note (<=250 chars): concentration risk,
DCA plan, biggest losers to review first.
Answer STRICT JSON: {"stocks": [{"symbol": "...", "verdict": "hold|average|exit|recover", "why": "<=140 chars"}],
"note": "<=250 chars"}. Only stocks listed in the data."""


def _root_keys() -> dict[str, str]:
    out: dict[str, str] = {}
    envp = REPO / ".env"
    if envp.is_file():
        for line in envp.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"^([A-Z][A-Z0-9_]+)=(.*)$", line.strip())
            if m and m.group(2).strip():
                out[m.group(1)] = m.group(2).strip()
    return out


def _provider() -> tuple[str, str] | None:
    k = _root_keys()
    if k.get("GROQ_API_KEY"):
        return "groq", "GROQ_API_KEY"
    if k.get("GEMINI_API_KEY"):
        return "gemini", "GEMINI_API_KEY"
    if k.get("OPENROUTER_API_KEY"):
        return "openrouter", "OPENROUTER_API_KEY"
    return None


def _http_json(url: str, headers: dict, body: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) empire-advisor/1.0",
                                          **headers})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode())


def _groq_models(key: str) -> list[str]:
    req = urllib.request.Request("https://api.groq.com/openai/v1/models",
                                 headers={"Authorization": f"Bearer {key}",
                                          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) empire-advisor/1.0"})
    return [m["id"] for m in json.load(urllib.request.urlopen(req, timeout=20)).get("data", [])]


def _pick_model(models: list[str]) -> str:
    for pref in ("llama-3.3-70b-versatile", "moonshotai/kimi-k2-instruct-0905",
                 "qwen/qwen3-32b", "llama-3.1-8b-instant"):
        for m in models:
            if m.split("/")[0].startswith(pref.split("/")[0]) and pref.split("/")[-1] in m:
                return m
    for m in models:  # any instruct-y model free of vision/embed/guard
        if not any(x in m for x in ("whisper", "tts", "guard", "embed", "vision", "distil")):
            return m
    return models[0] if models else "llama-3.3-70b-versatile"


def _ask_groq(prompt: str, key: str) -> str:
    model = _root_keys().get("GROQ_MODEL") or _pick_model(_groq_models(key))
    js = _http_json("https://api.groq.com/openai/v1/chat/completions",
                    {"Authorization": f"Bearer {key}"},
                    {"model": model,
                     "messages": [{"role": "user", "content": prompt}],
                     "max_tokens": 700, "temperature": 0.2})
    return (js.get("choices") or [{}])[0].get("message", {}).get("content", "")


def _ask_gemini(prompt: str, key: str) -> str:
    js = _http_json(
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.0-flash:generateContent?key=" + key,
        {}, {"contents": [{"parts": [{"text": prompt}]}],
             "generationConfig": {"temperature": 0.2, "maxOutputTokens": 700}})
    return ((js.get("candidates") or [{}])[0].get("content", {})
            .get("parts", [{}])[0]).get("text", "")


def _ask_openrouter(prompt: str, key: str) -> str:
    js = _http_json("https://openrouter.ai/api/v1/chat/completions",
                    {"Authorization": f"Bearer {key}"},
                    {"model": "meta-llama/llama-3.3-70b-instruct:free",
                     "messages": [{"role": "user", "content": prompt}],
                     "max_tokens": 700, "temperature": 0.2})
    return (js.get("choices") or [{}])[0].get("message", {}).get("content", "")


def _verdict_ok(v: object) -> bool:
    v = str(v).strip().lower()
    return v in ("hold", "average", "exit", "recover")


def review(force: bool = False) -> dict:
    ts = time.time()
    if not force and _cache.get("v") and ts - _cache["v"][0] < CACHE_TTL:
        return _cache["v"][1]

    import trading  # noqa: E402
    angel = trading.angel_holdings(force=force)
    manual = trading.snapshot().get("holdings", [])
    rows = angel.get("holdings") or (manual if manual else [])
    if not rows:
        out = {"available": False,
               "reason": (angel.get("error") or
                          "no configured holdings yet — add stocks in the Portfolio section"),
               "advice": [], "note": ""}
        _cache["v"] = (ts, out)
        return out

    prov = _provider()
    if not prov:
        out = {"available": False,
               "reason": "no LLM key set (paste GEMINI_API_KEY / GROQ_API_KEY in the AI advisor card)",
               "advice": [], "note": ""}
        _cache["v"] = (ts, out)
        return out

    invested = sum(r["buy_price"] * r["qty"] for r in rows)
    value = sum(r["current"] * r["qty"] for r in rows)
    data_lines = "\n".join(
        f"{r['symbol']}: qty {r['qty']}, buy ₹{r['buy_price']}, now ₹{r['current']}, "
        f"P/L ₹{r['pl']} ({0 if r['buy_price'] == 0 else round((r['current'] - r['buy_price']) / r['buy_price'] * 100, 1)}%)"
        for r in rows[:25])
    prompt = (f"portfolio: invested ₹{invested:.0f}, current value ₹{value:.0f}, "
              f"total P/L ₹{value - invested:.2f}\n" + data_lines +
              "\n\n" + _PROMPT)

    try:
        if prov[0] == "groq":
            raw = _ask_groq(prompt, _root_keys()[prov[1]])
        elif prov[0] == "gemini":
            raw = _ask_gemini(prompt, _root_keys()[prov[1]])
        else:
            raw = _ask_openrouter(prompt, _root_keys()[prov[1]])
        m = raw.find("{")
        js = json.loads(raw[m: raw.rfind("}") + 1]) if m >= 0 else {}
        advice = []
        known = {r["symbol"] for r in rows}
        for s in (js.get("stocks") or [])[:15]:
            if str(s.get("symbol", "")).upper() not in {k.upper() for k in known}:
                continue
            advice.append({"symbol": str(s.get("symbol"))[:32],
                           "verdict": (str(s.get("verdict", "hold")).strip().lower()
                                       if _verdict_ok(s.get("verdict")) else "hold"),
                           "why": str(s.get("why", ""))[:140]})
        out = {"available": True, "provider": prov[0],
               "advice": advice, "note": str(js.get("note", ""))[:250],
               "invested": round(invested, 0), "pl": round(value - invested, 2),
               "ts": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}
    except Exception as err:  # noqa: BLE001
        out = {"available": False, "reason": f"AI call failed: {str(err)[:140]}",
               "advice": [], "note": ""}
    _cache["v"] = (ts, out)
    return out


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(json.dumps(review(force=True), indent=2, default=str))
