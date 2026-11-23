# Dip Catcher — btc-race-24h-20261123-0511 (submit #2)

Long-only cbBTC/USDC bot for the make.fun 24h BTC race
(`agent-fun/bars-replay/v1`, `main.ts`, Node 22, stdlib only).

Strategy: buy the dip, not the burst — enter only when the close prints
at least 60 bps below the 90-bar mean close, with the full cash balance.
Exit at a fixed +100 bps profit target over the entry close, or cut at a
fixed −120 bps stop. No trailing stop, no re-entry within 10 bars of a
sell. Three selective fills on the whole dev window, each exit decided
before the position is opened.

Local grade on the dev window (kit grader, process driver, Node 22):

```
net PnL +$18.71, 6 trades (3 round trips), max drawdown 0.59%
net PnL at 2x fees +$16.28 — still profitable with doubled costs
two grade-local runs byte-identical (same result_sha256)
```

It replaces submit #1 ("Breakout Rider", 1 trade, +$29.50, drawdown
1.98%, ruled not prize-eligible for identical behaviour): this bot's
action log is entirely different — 3 entries at different bars,
different drawdown, different PnL.

Verify with the kit grader:

```
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process --worktree
```
