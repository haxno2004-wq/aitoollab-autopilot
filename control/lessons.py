"""Trading curriculum — a free, day-by-day lesson ready for the dashboard.

`today()` returns the lesson for the current day: fundamentals → technicals →
risk management → execution → earning mechanics, one lesson per day, cycling.
No network, no LLM, no key — the content below is the course.
"""
from __future__ import annotations

import time

START = 1759000000  # epoch seconds of course "day 0"; safe fixed anchor

LESSONS: list[dict] = [
    # ---- week 1: fundamentals ----
    {"day": 1, "track": "Fundamentals", "title": "What a market actually is",
     "body": "A market is a match between buyers and sellers. Price isn't 'value' — it is where the last trade happened. Every candle you'll ever trade is just thousands of these matches compressed.",
     "action": "Today: open any chart and ask of each candle — who was forced to buy, and who was forced to sell?"},
    {"day": 2, "track": "Fundamentals", "title": "Order books & bid/ask spread",
     "body": "Bid = what buyers say they'll pay; ask = what sellers demand. The gap is the spread — your single most underrated cost. Thin books = wide spreads = expensive trades.",
     "action": "Open an order book (any exchange). Watch price magnet toward the bigger side."},
    {"day": 3, "track": "Fundamentals", "title": "Market orders vs limit orders",
     "body": "Market orders buy certainty (you fill, at any price). Limit orders buy price (you choose, maybe never fill). Long-term you'll want limits; today understand both.",
     "action": "Paper-log both types on one asset; note the fill difference."},
    {"day": 4, "track": "Fundamentals", "title": "Liquidity & slippage",
     "body": "Liquidity = how much you can trade before moving the price. Slippage is the cost of wading into a thin market. Small accounts ignore it; growing accounts pay for ignoring it.",
     "action": "Compare the spread on a large-cap coin vs an illiquid alt. Write the difference down."},
    {"day": 5, "track": "Fundamentals", "title": "How exchanges, brokers & fees work",
     "body": "Every trade pays: commission (broker) + spread (market) + taxes/stamps (government). In India equities add STT and crypto adds the 1% TDS — fees decide which strategies are even possible.",
     "action": "Compute the round-trip cost of a ₹500 trade on your exchanges (taker fee × 2 + TDS)."},
    {"day": 6, "track": "Fundamentals", "title": "Long, short & flat — the three postures",
     "body": "Flat is a position. Not being in the market is often the highest-conviction trade in it. You only get paid after the trade is closed.",
     "action": "Screenshot your current portfolio and label each position: long / short / flat-and-why."},
    {"day": 7, "track": "Fundamentals", "title": "REVIEW — fundamentals week",
     "body": "Return to this week's notes. If you can explain spread, slippage, fee-stack and postures to a friend in 3 sentences each, that compounding has started.",
     "action": "Quiz yourself from memory, then check against the week's notes."},

    # ---- week 2: reading charts ----
    {"day": 8, "track": "Charts", "title": "Candles tell one story: who won",
     "body": "Big body = one side dominated; long wick = exhaustion or trap; doji = balance. Pattern names matter less than the question wait, who got trapped here?",
     "action": "Mark 3 wick-heavy candles on any chart and explain who got trapped."},
    {"day": 9, "track": "Charts", "title": "Support & resistance are memory, not magic",
     "body": "A level is where a crowd emotionally bought or sold. The more times a level is touched and holds, the weaker the crowd left behind it often is.",
     "action": "Draw S/R on your own asset; count previous touches."},
    {"day": 10, "track": "Charts", "title": "Trend is the slope of footsteps",
     "body": "Higher highs and higher lows = uptrend. Uptrends are bought on pullbacks; downtrends are sold on bounces. Fighting slope with hope is how accounts die.",
     "action": "Label current trend on BTC, NIFTY, EURUSD — one word each."},
    {"day": 11, "track": "Charts", "title": "Volume = oxygen of a move",
     "body": "Price without volume is a rumour. Breakouts on dead volume sting back; breakouts on heavy volume are the market voting with real money.",
     "action": "Find one breakout with weak volume on your watchlist. Watch what happened."},
    {"day": 12, "track": "Charts", "title": "Moving averages: the trend, smoothed",
     "body": "SMA50/EMA200 are trend-filters, not signals: below them, discipline; above, patience. Our own watchlist already refuses 'AVOID' under SMA50 — now you know why.",
     "action": "Add SMA50 to a chart. Count how often downtrend entries got punished."},
    {"day": 13, "track": "Charts", "title": "RSI and what 'overbought' actually means",
     "body": "RSI>70 doesn't mean sell — it means momentum is high and late. In trends RSI stays pinned; in ranges it oscillates. Context first, number second.",
     "action": "Find a stock with RSI 85 in an uptrend that kept rising."},
    {"day": 14, "track": "Charts", "title": "REVIEW — chart week",
     "body": "Revisit each day's chart homework. Trend, S/R, volume, SMA50, RSI — five tools, one habit: annotate before you act.",
     "action": "Write your own 5-line checklist from memory."},

    # ---- week 3: risk ----
    {"day": 15, "track": "Risk", "title": "Position sizing is the real strategy",
     "body": "Risking 2% per trade means 50 losses in a row to be wiped. Risking 20% means five. Most beginners 'lose to the market'; they actually lose to size.",
     "action": "Compute: ₹500 capital, 2% risk, ₹10 stop distance → how many units? (1)"},
    {"day": 16, "track": "Risk", "title": "Stop-loss: pre-committing to being wrong",
     "body": "A stop isn't a defeat, it's the price of the information that your thesis failed. Place it with the entry, never after — emotional stops drift.",
     "action": "For each open position, write its stop and the rupee loss if it hits. Sleep on that number."},
    {"day": 17, "track": "Risk", "title": "Risk-reward ratios",
     "body": "A 1:2 RR wins with a 40% win rate. Beginners chase win-rate; professionals chase expectancy. Track (win% × avg win) − (loss% × avg loss).",
     "action": "Compute the expectancy of your last 10 trades (any mode: paper included)."},
    {"day": 18, "track": "Risk", "title": "Drawdown psychology",
     "body": "A 20% drawdown needs 25% to recover; a 50% drawdown needs 100%. Drawdowns are where revenge trades are born. Pre-plan: losing X in a day halts trading (our bot does exactly this).",
     "action": "Fix your daily-loss halt number today. Write it where you can see it."},
    {"day": 19, "track": "Risk", "title": "Concentration vs diversification",
     "body": "One stock 100% is a lottery ticket — you already know this from your AngelOne holdings. 5–10 uncorrelated positions beat 1 hero position on every risk metric.",
     "action": "Rank your holdings by concentration. Plan the rebalance, don't panic-sell."},
    {"day": 20, "track": "Risk", "title": "Averaging down: math vs story",
     "body": "Averaging down is fine when the thesis is intact and it's planned; it's gambling when used to 'make the red become green'. Rule: never average into a broken story.",
     "action": "Pick one holding: is the thesis intact, or are you only defending the price you paid?"},
    {"day": 21, "track": "Risk", "title": "REVIEW — risk week",
     "body": "Risk is the only lever you fully control: size, stop, total exposure. You can have a mediocre strategy and survive with great risk control — not the reverse.",
     "action": "Draft your one-page personal risk policy."},

    # ---- week 4: execution & systems ----
    {"day": 22, "track": "Systems", "title": "Why rules beat feelings",
     "body": "A strategy you can write in 10 lines can survive you. Feelings can't be backtested; rules can. The bot's every refusal is a rule protecting future-you.",
     "action": "Write our bot's rules from memory: trend filter, RSI, cooldown, daily halt."},
    {"day": 23, "track": "Systems", "title": "Backtesting honestly",
     "body": "Any good result looks great with the right survivor-bias. Ask: fees included? taxes? realistic fills? ny stop gap? Honest tests are boring — boring is the point.",
     "action": "Re-read backtest.py's fee model. Which costs does it include which bullet-point results skip?"},
    {"day": 24, "track": "Systems", "title": "Paper → small live → scale",
     "body": "Paper proves logic; small live proves you. The gate between paper and live isn't a formality — it's the whole career plan.",
     "action": "Note today's bot paper-equity and the weeks of evidence so far."},
    {"day": 25, "track": "Systems", "title": "Journaling: the edge you can't see anywhere else",
     "body": "The pattern is almost never 'I need a better indicator'. It's 'I risked too much when bored'. A journal catches the second kind.",
     "action": "Log tonight's single best and worst decision from the bot's decision log."},
    {"day": 26, "track": "Systems", "title": "Automating yourself away",
     "body": "The goal was never to watch charts for money. The workflow is: rules → automation → monitoring — and you only intervene when the metrics break their promise.",
     "action": "Confirm the autopilot (Telegram watchdog) is running: you will hear nothing until something real happens."},
    {"day": 27, "track": "Systems", "title": "Scams, leverage & the 90% trap",
     "body": "High leverage isn't efficiency — it's moving your stop to zero-distance. Guaranteed-return schemes are the fee paid to people who learned this the hard way.",
     "action": "Compute liquidation price for 10× leverage on your capital. Realize how close 'fine' is."},
    {"day": 28, "track": "Systems", "title": "News, narratives & timeframes",
     "body": "Every headline is certain in a 1-minute chart and noise in a daily one. Trade the timeframe you can monitor, not the one the story is on.",
     "action": "Take today's biggest crypto headline; look at it on the daily. Still a big deal?"},
    {"day": 29, "track": "Systems", "title": "Your plan on one page",
     "body": "Now synthesise: instruments (NSE / forex / crypto), timeframes, entry rule, exit rule, stop rule, size rule, halt rule — a career plan on one page you can read in 60 seconds.",
     "action": "Write it. If it doesn't fit one page, it doesn't fit your head."},
    {"day": 30, "track": "Systems", "title": "GRADUATION — run the loop, not the screen",
     "body": "From here your job is to be the regulator, not the trader: review the journal weekly, keep the risk policy current, and grow only the capital — never the exceptions.",
     "action": "Schedule a weekly 15-minute review with yourself. That is the entire operating manual."},
]


def _now() -> float:
    return time.time()


def today() -> dict:
    idx = int((_now() - START) // 86400)
    lesson = LESSONS[idx % len(LESSONS)]
    out = dict(lesson)
    out["lesson_no"] = idx % len(LESSONS) + 1
    out["cycle"] = idx // len(LESSONS) + 1
    out["total"] = len(LESSONS)
    out["ts"] = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())
    return out


def all_tracks() -> dict:
    idx = int((_now() - START) // 86400)
    return {"lessons": LESSONS, "current": idx % len(LESSONS) + 1,
            "cycle": idx // len(LESSONS) + 1}


if __name__ == "__main__":
    import json
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    print(json.dumps(today(), indent=2, default=str))
