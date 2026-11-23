// Dip Catcher: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.
//
// Idea (written fresh for this contest, no house baseline logic, and a
// different family from the 60-bar breakout bot of submit #1):
//   * BTC's dev window drifts up in bursts with shallow pullbacks between
//     them, so this bot buys the pullback, not the burst: it enters only
//     when the close prints at least 60 bps BELOW the 90-bar mean close.
//     A dip that deep is rare enough (3 fills on the whole dev window)
//     that the 26 bps round-trip cost stays small next to the move back.
//   * Once in, it does not chase the mean and does not trail: it waits
//     for the bounce to pay exactly 100 bps over the entry close, or cuts
//     the trade at 120 bps under it. One fixed target, one fixed stop,
//     no second-guessing while the position is open.
//   * Size is the whole cash balance on a confirmed dip (one position,
//     long only), because a dip this selective deserves full size, and a
//     half-size entry would leave most of the bounce on the table.
//   * At most one fresh entry per 10 bars after a sell, so a flat stretch
//     cannot re-enter on the same dip twice in a row.
//   * Deterministic: bigint math on raw price units only, no clock, no
//     randomness, no network. Two runs produce byte-identical action logs.

import { BPS, runBars, type BarsState, type BuyInput, type SellInput } from "./vendor/makefun-bars.ts";

const MARKET = "CBBTC";

// Bars averaged for the mean close the dip is measured against.
const MEAN_BARS = 90;
// Entry: close this far below the mean close, in basis points.
const DIP_BPS = 60n;
// Exit: take profit this far above the entry close, in basis points.
const TARGET_BPS = 100n;
// Exit: cut the trade this far below the entry close, in basis points.
const CUT_BPS = 120n;
// Bars to wait after a sell before a fresh dip may be bought.
const REST_BARS = 10;
// Max slippage vs the latest close, in basis points (fills move ~13 bps).
const SLIP_BPS = 100;

const SCALE = BigInt(BPS);

// Rolling mean of the last MEAN_BARS closes, kept as a running sum so the
// average costs O(1) per bar instead of re-scanning the window.
class MeanTracker {
  private window: bigint[] = [];
  private total = 0n;

  push(price: bigint): void {
    this.window.push(price);
    this.total += price;
    if (this.window.length > MEAN_BARS) {
      this.total -= this.window.shift()!;
    }
  }

  get ready(): boolean {
    return this.window.length >= MEAN_BARS;
  }

  get mean(): bigint {
    return this.total / BigInt(this.window.length);
  }
}

function belowMeanBy(mean: bigint, price: bigint, bps: bigint): boolean {
  // price <= mean * (1 - bps/10000), in integers, no floats.
  return price * SCALE <= mean * (SCALE - bps);
}

function aboveBy(anchor: bigint, price: bigint, bps: bigint): boolean {
  return price * SCALE >= anchor * (SCALE + bps);
}

function belowBy(anchor: bigint, price: bigint, bps: bigint): boolean {
  return price * SCALE <= anchor * (SCALE - bps);
}

class DipCatcher {
  private mean = new MeanTracker();
  private boughtAt: bigint | null = null;
  private soldSeq = -1e9;

  decide(state: BarsState): Array<BuyInput | SellInput> {
    if (state.warmingUp) return [];
    const now = state.close(MARKET);
    if (now === null) return [];
    this.mean.push(now);

    const held = state.positions.get(MARKET);
    if (held !== undefined && held.qty > 0n) {
      const anchor = this.boughtAt ?? now;
      if (aboveBy(anchor, now, TARGET_BPS) || belowBy(anchor, now, CUT_BPS)) {
        this.soldSeq = state.seq;
        this.boughtAt = null;
        return [{ side: "sell", symbol: MARKET, qty: held.qty, max_slippage_bps: SLIP_BPS }];
      }
      return [];
    }

    // Flat: only a dip below the mean may trigger an entry.
    if (!this.mean.ready) return [];
    if (state.seq - this.soldSeq < REST_BARS) return [];
    if (!belowMeanBy(this.mean.mean, now, DIP_BPS)) return [];
    let spend = state.cash;
    const room = state.weightRoom(MARKET);
    if (room < spend) spend = room;
    if (spend <= 0n) return [];
    this.boughtAt = now;
    return [{ side: "buy", symbol: MARKET, notional_quote_units: spend, max_slippage_bps: SLIP_BPS }];
  }
}

const catcher = new DipCatcher();
await runBars({ onBatch: (state) => catcher.decide(state) });
