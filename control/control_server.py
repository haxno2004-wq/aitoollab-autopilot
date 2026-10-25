"""Empire Control Server — review, approve, launch.

A local-only (127.0.0.1) control plane for the 5 autonomous systems:

  py -3 control/control_server.py     → open the printed URL in your browser

Endpoints:
  GET  /            → control-panel.html (pre-flight review UI)
  GET  /api/status  → per-idea files, health, key status, launch history
  GET  /api/file    → whitelisted file preview (review before run)
  POST /api/keys    → save API keys into <idea>/.env or root .env (never logged)
  POST /api/launch  → run systems today — requires {"approved": true}

Safety:
  * binds to loopback only
  * launch is refused unless explicitly approved in the request body
  * key values are written to .env files and never echoed back or logged
  * /api/file serves a whitelist (README/config.example.env/docs), never .env
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import trading  # noqa: E402
import trading_agent  # noqa: E402
PANEL = Path(__file__).resolve().parent / "control-panel.html"
STATE = REPO / "state"
LAUNCHES_DIR = REPO / "control" / "launches"
LAUNCHES_FILE = REPO / "control" / "launches.json"

IDEAS = [
    {"id": "idea-1", "dir": "idea-1-redbubble", "name": "POD designs (Redbubble/Gumroad)"},
    {"id": "idea-2", "dir": "idea-2-pinterest", "name": "Pinterest pin factory"},
    {"id": "idea-3", "dir": "idea-3-digital-products", "name": "Digital product factory"},
    {"id": "idea-4", "dir": "idea-4-youtube", "name": "YouTube Shorts channel"},
    {"id": "idea-5", "dir": "idea-5-prompt-marketplace", "name": "Prompt pack marketplace"},
    {"id": "idea-6", "dir": "idea-6-tools-site", "name": "Free-tool microsite (SEO/AdSense)"},
    {"id": "idea-8", "dir": "idea-8-reddit-engine", "name": "Reddit reply-pack (read-only)"},
]

# Key manifest: which env keys each idea needs. `any` = at least one of the
# group must be set for *quality* live output (pipelines degrade gracefully
# without them). Values are never returned by the API — only set/unset flags.
KEY_MANIFEST = {
    "_root": {
        "name": "Shared operations (all ideas)",
        "groups": [
            {"label": "Earnings → Google Sheets", "keys": [
                ("GOOGLE_SERVICE_ACCOUNT_JSON", "service-account JSON path", "https://docs/api-setup-guides.md#6-google-sheets-earnings-log"),
                ("SHEETS_EARNINGS_ID", "spreadsheet ID from its URL", None)]},
            {"label": "Failure alerts → Telegram", "keys": [
                ("TELEGRAM_BOT_TOKEN", "from @BotFather", "https://docs/api-setup-guides.md#7-telegram-alerts"),
                ("TELEGRAM_CHAT_ID", "your chat id (message @userinfobot)", None)]},
            {"label": "AI research keys (portfolio advisor + signals — any ONE)", "keys": [
                ("GEMINI_API_KEY", "aistudio.google.com/apikey (free tier)", None),
                ("GROQ_API_KEY", "console.groq.com/keys (free tier)", None),
                ("OPENROUTER_API_KEY", "openrouter.ai/keys (free models)", None)]},
            {"label": "AngelOne SmartAPI (quotes/signals mode — no auto-orders)", "keys": [
                ("ANGELONE_API_KEY", "smartapi.angelone.in → API keys (rotate any key pasted in chat!)", None),
                ("ANGELONE_CLIENT_CODE", "your Angel broking client ID", None),
                ("ANGELONE_PIN", "SmartAPI login PIN — stored locally only", None),
                ("ANGELONE_TOTP_SECRET", "from SmartAPI TOTP setup (optional)", None)]},
        ],
    },
}
LLM_GROUP = {"label": "LLM brain (any ONE is enough; free tiers)", "keys": [
    ("GEMINI_API_KEY", "https://aistudio.google.com/apikey", "free tier"),
    ("OPENROUTER_API_KEY", "https://openrouter.ai/keys", "free models"),
    ("GROQ_API_KEY", "https://console.groq.com/keys", "free tier"),
]}

TA_ADV_GROUP = {"label": "AI advisor (free-LLM second opinion vetoing risky buys)", "keys": [
    ("GEMINI_API_KEY", "https://aistudio.google.com/apikey", "optional"),
    ("OPENROUTER_API_KEY", "openrouter.ai/keys", "optional"),
    ("GROQ_API_KEY", "console.groq.com/keys", "optional"),
    ("ADVISOR", "0 disables the advisor (default: on when any key above is set)", "optional")]}
TA_LIVE_GROUP = {"label": "CoinDCX live trading (trade-only key, withdrawals OFF, IP whitelist)", "keys": [
    ("COINDCX_API_KEY", "coindcx.com → API dashboard → create key with TRADE permission only", "live"),
    ("COINDCX_API_SECRET", "shown once at key creation; stored in trading-agent/.env (gitignored)", "live"),
    ("LIVE_MODE", "1 = request live trading (bot still refuses until its readiness gate passes)", "gate"),
    ("LIVE_OVERRIDE", "forces past a failing gate — only after you read every line, at your own risk", "danger")]}
TA_SET_GROUP = {"label": "Bot settings (take effect on the bot's next cycle — no restart)", "keys": [
    ("TRADING_CAPITAL", "INR at risk (default 500)", "0"),
    ("TRADE_PAIR", "default BTCINR", "0"),
    ("POLL_MINUTES", "cycle interval minutes (default 15)", "0"),
    ("MAX_TRADES_PER_DAY", "default 3", "0"),
    ("COOLDOWN_MINUTES", "minutes between trades (default 240)", "0")]}

KEY_MANIFEST.update({
    "trading-agent": {"groups": [TA_LIVE_GROUP, TA_ADV_GROUP, TA_SET_GROUP]},
    "idea-1": {"groups": [LLM_GROUP, {"label": "Publishing (optional — else manual upload pack)", "keys": [
        ("GUMROAD_ACCESS_TOKEN", "https://gumroad.com/settings/advanced", "optional")]}]},
    "idea-2": {"groups": [
        LLM_GROUP,
        {"label": "Pinterest (REQUIRED for live pins — Standard access gated)", "keys": [
            ("PINTEREST_ACCESS_TOKEN", "via pinterest_client.py exchange", None),
            ("PINTEREST_BOARD_ID", "board to pin into", None),
            ("PINTEREST_CLIENT_ID", "App ID from developers.pinterest.com/apps", None),
            ("PINTEREST_CLIENT_SECRET", "App secret key (same page, shown once)", None)]},
        {"label": "Amazon Associates", "keys": [
            ("AMAZON_ASSOCIATES_TAG", "yourtag-20", None)]},
    ]},
    "idea-3": {"groups": [LLM_GROUP, {"label": "Publishing (optional)", "keys": [
        ("GUMROAD_ACCESS_TOKEN", "https://gumroad.com/settings/advanced", "optional")]}]},
    "idea-4": {"groups": [
        LLM_GROUP,
        {"label": "Video (REQUIRED for live upload)", "keys": [
            ("YOUTUBE_CLIENT_SECRETS", "OAuth desktop client JSON path", None),
            ("YOUTUBE_REFRESH_TOKEN", "via upload.py auth", None),
            ("PEXELS_API_KEY", "https://www.pexels.com/api/", "free 200/hr")]},
    ]},
    "idea-5": {"groups": [LLM_GROUP, {"label": "Publishing (optional)", "keys": [
        ("GUMROAD_ACCESS_TOKEN", "https://gumroad.com/settings/advanced", "optional")]}]},
    "idea-6": {"groups": [LLM_GROUP, {"label": "Monetization (all optional)", "keys": [
        ("IDEA6_SITE_URL", "live URL after first deploy", "set post-deploy"),
        ("IDEA6_ADSENSE_CLIENT", "ca-pub-… after AdSense approval", "optional"),
        ("IDEA6_ADSENSE_SLOT", "ad slot id", "optional")]}]},
    "idea-8": {"groups": [LLM_GROUP, {"label": "Artifact URLs to share (set when live)", "keys": [
        ("REDDIT_SUBS", "subs to scan (empty = default list)", "optional"),
        ("IDEA6_SITE_URL", "tools site URL after deploy", "shared with idea-6"),
        ("IDEA6_EXTENSIONS_URL", "Chrome Web Store URL after publish", "set post-CWS"),
        ("IDEA3_STORE_URL", "Gumroad storefront after payout setup", "optional")]}]},
})

KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
ALLOWED_FILE_SUFFIXES = {".md", ".py", ".txt", ".csv", ".json", ".example.env", ".yml", ".yaml"}
_env_cache: dict[str, set[str]] = {}


def parse_env_keys(path: Path) -> set[str]:
    """Key names defined in an env file (values never leave this function)."""
    keys: set[str] = set()
    if not path.is_file():
        return keys
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k = line.split("=", 1)[0].strip()
            if KEY_RE.match(k):
                keys.add(k)
    return keys


def set_env_values(path: Path, values: dict[str, str]) -> int:
    """Merge KEY=VALUE pairs into an env file, preserving comments/order."""
    existing = path.read_text(encoding="utf-8") if path.is_file() else \
        "# Written by the Empire Control Panel\n"
    lines = existing.splitlines()
    for key, value in values.items():
        if not KEY_RE.match(key):
            raise ValueError(f"bad key name: {key}")
        clean = " ".join(str(value).strip().splitlines()).strip()
        pat = re.compile(rf"^{re.escape(key)}=.*$")
        repl = f"{key}={clean}"
        for i, line in enumerate(lines):
            if pat.match(line.strip()) and not line.lstrip().startswith("#"):
                lines[i] = repl
                break
        else:
            lines.append(repl)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    _env_cache.pop(str(path), None)
    return len(values)


def load_launches() -> dict:
    if LAUNCHES_FILE.is_file():
        try:
            return json.loads(LAUNCHES_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"launches": []}


def save_launches(data: dict) -> None:
    LAUNCHES_DIR.mkdir(parents=True, exist_ok=True)
    LAUNCHES_FILE.write_text(json.dumps(data, indent=1), encoding="utf-8")


class Launcher:
    """Runs approved pipelines as subprocesses; tracks results in launches.json."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
    def start(self, mode: str, ideas: list[str]) -> dict:
        launch_id = time.strftime("%Y%m%d-%H%M%S")
        jobs: dict[str, dict] = {}
        proc_map: dict[str, subprocess.Popen] = {}
        log_fh_map: dict[str, object] = {}
        ffmpeg = bool(shutil.which("ffmpeg"))
        for idea in IDEAS:
            iid = idea["id"]
            if iid not in ideas:
                continue
            cmd = [sys.executable, "run_pipeline.py"]
            job: dict = {"status": "running"}
            if mode == "dry_run":
                cmd.append("--dry-run")
            if iid == "idea-4":
                if mode == "dry_run":
                    cmd.append("--no-upload")
                elif not ffmpeg:
                    jobs[iid] = {"status": "skipped",
                                 "reason": "ffmpeg not installed on this machine "
                                           "(CI runs idea-4; install ffmpeg to run locally)"}
                    continue
                else:
                    env_keys = (parse_env_keys(Path(idea["dir"]) / ".env")
                                | parse_env_keys(REPO / ".env"))
                    if "YOUTUBE_REFRESH_TOKEN" not in env_keys:
                        cmd.append("--no-upload")
                        job["note"] = ("live render; upload skipped "
                                       "(no YouTube refresh token)")
            log_path = LAUNCHES_DIR / launch_id / f"{iid}.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)
            log_fh = log_path.open("wb")
            proc = subprocess.Popen(
                cmd, cwd=REPO / idea["dir"], stdout=log_fh, stderr=subprocess.STDOUT,
                env={**os.environ, "DRY_RUN": "true" if mode == "dry_run" else "false"})
            job["pid"] = proc.pid
            job["log"] = str(log_path.relative_to(REPO))
            jobs[iid] = job
            proc_map[iid], log_fh_map[iid] = proc, log_fh
        record = {"id": launch_id,
                  "ts": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
                  "mode": mode,
                  "jobs": {k: {kk: vv for kk, vv in v.items()
                               if not kk.startswith("_")} for k, v in jobs.items()}}
        with self.lock:
            data = load_launches()
            data["launches"].insert(0, record)
            data["launches"] = data["launches"][:20]
            save_launches(data)
        procs: list[tuple[str, subprocess.Popen, object, str]] = []
        for iid, job in jobs.items():
            if "pid" in job:
                procs.append((iid, proc_map[iid], log_fh_map[iid], launch_id))
        for iid, proc, fh, lid in procs:
            threading.Thread(target=self._reap, args=(iid, proc, fh, lid),
                             daemon=True).start()
        return record

    def _reap(self, iid: str, proc: subprocess.Popen, fh, launch_id: str) -> None:
        code = proc.wait()
        fh.close()
        with self.lock:
            data = load_launches()
            for rec in data["launches"]:
                if rec["id"] == launch_id and iid in rec["jobs"]:
                    rec["jobs"][iid]["status"] = "done" if code == 0 else "failed"
                    rec["jobs"][iid]["exit"] = code
                    rec["jobs"][iid].pop("pid", None)
            save_launches(data)


launcher = Launcher()


def build_status() -> dict:
    ffmpeg = bool(shutil.which("ffmpeg"))
    piper = bool(shutil.which("piper"))
    root_keys = parse_env_keys(REPO / ".env")
    ideas_out = []
    for idea in IDEAS:
        d = REPO / idea["dir"]
        files = []
        for f in sorted(d.iterdir()):
            if f.is_file() and f.suffix in ALLOWED_FILE_SUFFIXES or \
               f.name in ("config.example.env", "workflow.json", "error-workflow.json",
                          "product_seeds.csv", "requirements.txt"):
                files.append({"name": f.name, "size": f.stat().st_size})
        health = {}
        hp = STATE / idea["id"] / "health.json"
        if hp.is_file():
            try:
                health = json.loads(hp.read_text(encoding="utf-8"))
            except Exception:
                health = {"ok": None, "stage": "unreadable"}
        env_keys = parse_env_keys(d / ".env") | root_keys
        keys = []
        for grp in KEY_MANIFEST[idea["id"]]["groups"]:
            keys.append({"label": grp["label"], "keys": [
                {"name": k, "hint": hint, "note": note, "set": k in env_keys}
                for (k, hint, note) in grp["keys"]]})
        llm_any = bool(env_keys & {"GEMINI_API_KEY", "OPENROUTER_API_KEY", "GROQ_API_KEY"})
        ideas_out.append({**idea, "files": files, "health": health,
                          "env_exists": (d / ".env").is_file(), "keys": keys,
                          "llm_ready": llm_any})
    root_groups = [{"label": g["label"], "keys": [
        {"name": k, "hint": hint, "note": note, "set": k in root_keys}
        for (k, hint, note) in g["keys"]]} for g in KEY_MANIFEST["_root"]["groups"]]
    ta_keys = parse_env_keys(REPO / "trading-agent" / ".env") | root_keys
    ta_groups = [{"label": g["label"], "keys": [
        {"name": k, "hint": hint, "note": note, "set": k in ta_keys}
        for (k, hint, note) in g["keys"]]} for g in KEY_MANIFEST["trading-agent"]["groups"]]
    try:
        import trading_agent as _ta
        ta_note = _ta.snapshot().get("readiness", {}).get("verdict", "")
    except Exception:
        ta_note = ""
    return {"ideas": ideas_out,
            "root": {"keys": root_groups, "env_exists": (REPO / ".env").is_file()},
            "trading_agent": {"keys": ta_groups,
                              "env_exists": (REPO / "trading-agent" / ".env").is_file(),
                              "ready_note": ta_note},
            "tools": {"ffmpeg": ffmpeg, "piper": piper},
            "launches": load_launches()["launches"][:5]}


_revenue_cache: dict[str, tuple[float, dict]] = {}
_REVENUE_TTL = 120  # seconds


def build_revenue() -> dict:
    """Live earnings snapshot: Gumroad sales + Pinterest queue state.

    Gumroad: aggregated from the products API (sales_usd_cents, sales_count).
    Pinterest: affiliate pipeline state (queued/published pins); revenue shows
    as $0 until an Associates tag is set and pins are actually posted.
    """
    now = time.time()
    cached = _revenue_cache.get("v")
    if cached and now - cached[0] < _REVENUE_TTL:
        return cached[1]

    tok = None
    sys.path.insert(0, str(REPO / "shared-utils"))
    try:
        from empire_shared.config import cfg as _cfg
        from empire_shared.config import _load_dotenv
        _load_dotenv(REPO / "idea-1-redbubble" / ".env")  # token lives here
        tok = _cfg.gumroad_access_token or os.environ.get("GUMROAD_ACCESS_TOKEN")
    except Exception:
        tok = None
    g = {"products": 0, "sales": 0, "revenue_usd": 0.0,
         "available": bool(tok), "top": []}
    if tok:
        try:
            req = urllib.request.Request(
                f"https://api.gumroad.com/v2/products?access_token={tok}")
            data = json.load(urllib.request.urlopen(req, timeout=20))
            rows = []
            for p in data.get("products", []):
                g["products"] += 1
                g["sales"] += int(p.get("sales_count") or 0)
                g["revenue_usd"] += float(p.get("sales_usd_cents") or 0) / 100
                if int(p.get("sales_count") or 0):
                    rows.append((p["name"][:40], int(p["sales_count"]),
                                 float(p.get("sales_usd_cents") or 0) / 100))
            g["top"] = sorted(rows, key=lambda r: -r[1])[:5]
        except Exception as err:  # noqa: BLE001
            g["error"] = str(err)[:160]
            g["available"] = False

    # Pinterest pipeline state (queue.json lives in state/idea-2)
    qf = STATE / "idea-2" / "queue.json"
    pins = {"queued": 0, "published": 0, "failed": 0, "revenue_usd": 0.0,
            "available": qf.is_file()}
    if qf.is_file():
        try:
            q = json.loads(qf.read_text(encoding="utf-8"))
            pins["queued"] = sum(1 for x in q if x.get("status") == "queued")
            pins["published"] = sum(1 for x in q if x.get("status") == "published")
            pins["failed"] = sum(1 for x in q if x.get("status") == "failed")
        except Exception:  # noqa: BLE001
            pins["available"] = False

    snap = {"gumroad": g, "pinterest": pins,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}
    _revenue_cache["v"] = (now, snap)
    return snap


class Handler(BaseHTTPRequestHandler):
    server_version = "EmpireControl/1.0"

    def log_message(self, fmt, *args):  # quieter logs, still visible
        sys.stderr.write("[control] " + (fmt % args) + "\n")

    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code: int, obj) -> None:
        self._send(code, json.dumps(obj).encode("utf-8"), "application/json")

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PANEL.read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/api/status":
            self._json(200, build_status())
        elif self.path == "/api/revenue":
            self._json(200, build_revenue())
        elif self.path == "/api/trading":
            self._json(200, trading.snapshot())
        elif self.path == "/api/tradingagent":
            self._json(200, trading_agent.snapshot())
        elif self.path == "/api/autopilot":
            import autopilot
            try:
                self._json(200, autopilot.status_line(autopilot._load_state()))
            except Exception as err:  # noqa: BLE001
                self._json(200, {"available": False, "error": str(err)[:120]})
        elif self.path == "/api/lessons":
            import lessons
            self._json(200, lessons.today())
        elif self.path == "/api/lessons/all":
            import lessons
            self._json(200, lessons.all_tracks())
        elif self.path.split("?")[0] == "/api/advisor":
            import portfolio_advisor
            self._json(200, portfolio_advisor.review(force="refresh=1" in self.path))
        elif self.path.startswith("/api/file"):
            from urllib.parse import urlparse, parse_qs
            rel = parse_qs(urlparse(self.path).query).get("path", [""])[0]
            p = (REPO / rel).resolve()
            ok = (str(p).startswith(str(REPO)) and p.is_file()
                  and p.suffix in ALLOWED_FILE_SUFFIXES
                  and not p.name.endswith(".env")
                  and p.stat().st_size < 200_000)
            if not ok:
                self._json(403, {"error": "file not reviewable"})
                return
            self._json(200, {"path": rel,
                             "text": p.read_text(encoding="utf-8", errors="replace")})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 100_000:
            self._json(413, {"error": "body too large"})
            return
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            self._json(400, {"error": "bad json"})
            return
        if self.path == "/api/portfolio":
            try:
                data = trading.save_portfolio(body)
            except Exception as err:  # noqa: BLE001
                self._json(400, {"error": str(err)[:160]})
                return
            self._json(200, {"saved": len(data.get("holdings", [])),
                             "watchlist": len(data.get("watchlist", []))})
        elif self.path == "/api/keys":
            target = body.get("target", "")
            values = body.get("values", {})
            if target == "_root":
                path = REPO / ".env"
            elif target == "trading-agent":
                path = REPO / "trading-agent" / ".env"
            else:
                idea = next((i for i in IDEAS if i["id"] == target), None)
                if not idea:
                    self._json(400, {"error": "unknown target"})
                    return
                path = REPO / idea["dir"] / ".env"
            try:
                n = set_env_values(path, {str(k): str(v) for k, v in values.items()})
            except ValueError as err:
                self._json(400, {"error": str(err)})
                return
            self._json(200, {"saved": n, "target": target})
        elif self.path == "/api/launch":
            if body.get("approved") is not True:
                self._json(403, {"error": "launch refused — not explicitly approved"})
                return
            mode = body.get("mode", "dry_run")
            if mode not in ("dry_run", "live"):
                self._json(400, {"error": "mode must be dry_run|live"})
                return
            wanted = body.get("ideas") or [i["id"] for i in IDEAS]
            valid = [i for i in wanted if i in {x["id"] for x in IDEAS}]
            if not valid:
                self._json(400, {"error": "no valid ideas selected"})
                return
            rec = launcher.start(mode, valid)
            self._json(200, {"launched": rec["id"], "mode": mode, "jobs": rec["jobs"]})
        else:
            self._json(404, {"error": "not found"})


def main() -> int:
    # Windows consoles default to cp1252; keep our UTF-8 output safe.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    port = 8765
    for attempt in range(6):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError:
            port += 1
    else:
        print("no free port found", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{port}/"
    print(f"Empire Control Panel -> {url}  (Ctrl+C to stop)", flush=True)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
