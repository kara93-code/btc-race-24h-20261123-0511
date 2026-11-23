// Breakout Rider: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// Idea (written fresh for this contest, no house baseline logic):
//   * The dev window's gains come in a few sustained bursts, not in minute
//     noise, so the bot waits for a burst it can name: the close prints a
//     fresh 60-bar high AND is at least 30 bps above the close 60 bars ago.
//     Either condition alone fires constantly on flat bars; together they
//     fire only when price is both breaking out and actually moving.
//   * Once in, the bot rides the burst with two exits and nothing else:
//     a 200 bps trailing stop under the highest close since entry, and a
//     100 bps hard stop under the entry close. No re-entry within 30 bars
//     of a sell, so a choppy top cannot whipsaw it back in at once.
//   * Size is the whole cash balance on a confirmed burst (one position,
//     long only), because a half-size entry on the rare real burst leaves
//     most of the move on the table while the round-trip cost (~26 bps)
//     is the same either way.
//   * Deterministic: bigint math on raw price units only, no clock, no
//     randomness, no network. Two runs produce byte-identical action logs.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const SYMBOL = "CBBTC";

// Lookback for the breakout high and for the momentum check (bars).
const LOOKBACK = 60;
// Minimum 60-bar rise, in basis points, for a breakout to count.
const MIN_RISE_BPS = 30n;
// Trailing stop under the highest close since entry, in basis points.
const TRAIL_BPS = 200n;
// Hard stop under the entry close, in basis points.
const STOP_BPS = 100n;
// Bars to wait after a sell before a fresh entry may fire.
const COOLDOWN_BARS = 30;
// Max slippage vs the latest close, in basis points (fills move ~13 bps).
const MAX_SLIP_BPS = 100;

const BP = BigInt(BPS);

class Rider {
  private closes: bigint[] = [];
  private entryClose: bigint | null = null;
  private peakClose: bigint | null = null;
  private lastSellSeq = -1e9;

  onBatch(state: BarsState): Array<BuyInput | SellInput> {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    this.closes.push(close);
    const holding = state.positions.get(SYMBOL);
    if (holding !== undefined && holding.qty > 0n) {
      if (this.entryClose === null || this.peakClose === null) {
        // Position arrived without a recorded entry (should not happen);
        // anchor the stops to the first close seen held.
        this.entryClose = close;
        this.peakClose = close;
      }
      if (close > this.peakClose) this.peakClose = close;
      const trailLine = (this.peakClose * (BP - TRAIL_BPS)) / BP;
      const stopLine = (this.entryClose * (BP - STOP_BPS)) / BP;
      if (close <= trailLine || close <= stopLine) {
        this.lastSellSeq = state.seq;
        this.entryClose = null;
        this.peakClose = null;
        return [{ side: "sell", symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIP_BPS }];
      }
      return [];
    }
    // Flat: look for a confirmed burst.
    if (this.closes.length <= LOOKBACK) return [];
    if (state.seq - this.lastSellSeq < COOLDOWN_BARS) return [];
    const window = this.closes.slice(-LOOKBACK - 1, -1);
    let highest = window[0];
    for (const c of window) if (c > highest) highest = c;
    if (close <= highest) return [];
    const sixtyAgo = this.closes[this.closes.length - LOOKBACK - 1];
    if (close * BP < sixtyAgo * (BP + MIN_RISE_BPS)) return [];
    let spend = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (room < spend) spend = room;
    if (spend <= 0n) return [];
    this.entryClose = close;
    this.peakClose = close;
    return [{ side: "buy", symbol: SYMBOL, notional_quote_units: spend, max_slippage_bps: MAX_SLIP_BPS }];
  }
}

const rider = new Rider();
await runBars({ onBatch: (state) => rider.onBatch(state) });
