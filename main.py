"""Breakout Rider: a long-only cbBTC/USDC bot for agent-fun/bars-replay/v1.

Idea (written fresh for this contest, no house baseline logic):
  * The dev window's gains come in a few sustained bursts, not in minute
    noise, so the bot waits for a burst it can name: the close prints a
    fresh 60-bar high AND is at least 30 bps above the close 60 bars ago.
    Either condition alone fires constantly on flat bars; together they
    fire only when price is both breaking out and actually moving.
  * Once in, the bot rides the burst with two exits and nothing else:
    a 200 bps trailing stop under the highest close since entry, and a
    100 bps hard stop under the entry close. No re-entry within 30 bars
    of a sell, so a choppy top cannot whipsaw it back in at once.
  * Size is the whole cash balance on a confirmed burst (one position,
    long only), because a half-size entry on the rare real burst leaves
    most of the move on the table while the round-trip cost (~26 bps)
    is the same either way.
  * Deterministic: integer math on raw price units only, no clock, no
    randomness, no network. Two runs produce byte-identical action logs.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

SYMBOL = "CBBTC"

# Lookback for the breakout high and for the momentum check (bars).
LOOKBACK = 60
# Minimum 60-bar rise, in basis points, for a breakout to count.
MIN_RISE_BPS = 30
# Trailing stop under the highest close since entry, in basis points.
TRAIL_BPS = 200
# Hard stop under the entry close, in basis points.
STOP_BPS = 100
# Bars to wait after a sell before a fresh entry may fire.
COOLDOWN_BARS = 30
# Max slippage vs the latest close, in basis points (fills move ~13 bps).
MAX_SLIP_BPS = 100

BPS = 10_000


class Rider:
    """Keeps the close history and the state of the one open ride."""

    def __init__(self):
        self.closes = []
        self.entry_close = None
        self.peak_close = None
        self.last_sell_seq = -10 ** 9

    def on_batch(self, state, batch):
        if state.warming_up:
            return []
        close = state.close(SYMBOL)
        if close is None:
            return []
        self.closes.append(close)
        holding = state.positions.get(SYMBOL)
        if holding is not None and holding.qty > 0:
            if self.entry_close is None:
                # Position arrived without a recorded entry (should not
                # happen); anchor the stops to the first close seen held.
                self.entry_close = close
                self.peak_close = close
            if close > self.peak_close:
                self.peak_close = close
            trail_line = self.peak_close * (BPS - TRAIL_BPS) // BPS
            stop_line = self.entry_close * (BPS - STOP_BPS) // BPS
            if close <= trail_line or close <= stop_line:
                self.last_sell_seq = state.seq
                self.entry_close = None
                self.peak_close = None
                return [{
                    "side": "sell",
                    "symbol": SYMBOL,
                    "qty": holding.qty,
                    "max_slippage_bps": MAX_SLIP_BPS,
                }]
            return []
        # Flat: look for a confirmed burst.
        if len(self.closes) <= LOOKBACK:
            return []
        if state.seq - self.last_sell_seq < COOLDOWN_BARS:
            return []
        window = self.closes[-LOOKBACK - 1:-1]
        if close <= max(window):
            return []
        sixty_ago = self.closes[-LOOKBACK - 1]
        if close * BPS < sixty_ago * (BPS + MIN_RISE_BPS):
            return []
        spend = state.cash
        room = state.weight_room(SYMBOL)
        if room < spend:
            spend = room
        if spend <= 0:
            return []
        self.entry_close = close
        self.peak_close = close
        return [{
            "side": "buy",
            "symbol": SYMBOL,
            "notional_quote_units": spend,
            "max_slippage_bps": MAX_SLIP_BPS,
        }]


def main():
    rider = Rider()
    makefun_bars.run(rider.on_batch)


if __name__ == "__main__":
    main()
