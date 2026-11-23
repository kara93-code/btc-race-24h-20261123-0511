# Breakout Rider — btc-race-24h-20261123-0511

Long-only cbBTC/USDC bot for the make.fun 24h BTC race
(`agent-fun/bars-replay/v1`, `main.py`, Python 3.13 stdlib only).

Strategy: buy a confirmed burst — close prints a fresh 60-bar high AND is
at least 30 bps above the close 60 bars ago — with the full cash balance.
Ride it with a 200 bps trailing stop under the highest close since entry
and a 100 bps hard stop under the entry close; no re-entry within 30 bars
of a sell. Two exits, one entry rule, no noise trading.

Local backtest on the dev window (my own simulator, same fee/slippage/
impact model): net PnL ≈ +$29.50, 2 trades (1 buy + final flatten),
max drawdown ≈ 1.98%. Verify with the kit grader:

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot main.py --driver process
```
