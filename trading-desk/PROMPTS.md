# פרומפטים מוכנים — העתק-הדבק ל-Claude Code (אחרי שהחיבור חי)

## חלק 2 — שיחות ראשונות עם הגרף

```
What is on my chart right now? List every indicator and its current value.
```

```
Add RSI(2) and Bollinger Bands (20, 2) to the chart, then tell me what they say about SPY on the daily.
```

```
Scroll the chart to March 2020 and walk me through what my current setup would have signalled during the crash.
```

## חלק 3 — פורט אסטרטגיה מ-Python ל-Pine v6

```
Port my Python RSI(2) mean-reversion backtest to a Pine v6 strategy():
- entry: RSI(2) < 10 while close > 200-SMA
- exit: RSI(2) > 65
- 0.05% commission per side, 100% of equity per trade
Match my Python timing exactly (signal on close, fill same bar), compile it,
fix any errors, and save it as "RSI(2)<10 above 200SMA [audit port]".
```

## חלק 4 — ביקורת בקטסט (שני מנועים בלתי-תלויים)

```
Here is my Python backtest (attached). Port it to Pine faithfully, run it in the
Strategy Tester over the same window, and reconcile every number: win rate,
profit factor, trade count, net profit. If anything differs by more than
rounding, find out why before I trust either engine.
```

## חלק 5 — מסחר נייר ב-Bar Replay

```
Start a bar replay on SPY daily from June 2019. Trade my saved RSI(2) strategy
forward for 18 months, log every trade with entry, exit and R, then compare the
replay results to the Strategy Tester backtest over the same window.
```

## חלק 6 — שאלה ראשונה לברוקר (קריאה בלבד)

```
Show my holdings and flag anything more than 5% off its 50-day.
```

## חלק 7 — Crons לסוכן Hermes (אם בחרת בענן)

**תדריך בוקר (כל יום מסחר):**

```
Every weekday 8:45am IST: pull overnight moves on my watchlist + portfolio via
Kite, check macro calendar, and send me a 10-line Telegram brief with anything
that breaches my written exit rules.
```

**בדיקת בריאות שבועית:**

```
Every Friday 6pm: re-run my strategy health check — win rate, PF, drawdown vs
the backtest baseline — and message me only if something drifted more than 20%.
```

**ביקורת עצמית (שיפור מיומנויות):**

```
Every Sunday: review this week's briefs and alerts. What did I flag that I
should not have? What did I miss? Update your brief-writing skill accordingly
and show me the diff.
```
