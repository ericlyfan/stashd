// Position accounting for portfolio holdings. Lots (dated buys/sells) are the
// source of truth when present; a holding with no lots falls back to its stored
// shares/buyPrice as a single undated opening lot.
//
// Method: **average cost.** A buy adds shares and cost (incl. fee); a sell
// realizes qty × (price − running average cost) − fee and reduces the open cost
// basis proportionally, leaving the average cost of the remaining shares
// unchanged. This is the common, easy-to-explain convention for a personal
// tracker (FIFO would need per-lot bookkeeping and only matters for tax lots).

import { Holding, HoldingLot } from '@stashd/shared';

export interface Position {
  openShares: number; // net shares currently held
  costBasis: number; // cost of the open shares (avgCost × openShares)
  avgCost: number; // per-share average cost of the open position
  realizedGain: number; // gains locked in by past sells
  lotCount: number; // how many lots backed this (0 = legacy shares/buyPrice)
  invalid: boolean; // true when a sell oversold the shares held (clamped, not thrown)
}

// Chronologically fold a holding's lots into its current position. Lots are
// sorted by trade date (then insertion order) so sells resolve against the
// average cost as it stood at that point.
//
// The write paths (lot create/update/delete) reject an oversell before it can
// be stored, so a valid history never oversells here. But a database that
// reached an inconsistent state some other way (a hand edit, an older bug)
// must NOT make this throw — derivePosition is on every portfolio read
// (GET /holdings, /holdings/health, the chat get_portfolio tool), and a throw
// would hard-fail all of them permanently. So an oversell is CLAMPED (realize
// only the shares actually held, flatten the position) and flagged via
// `invalid`, rather than rejected.
export function derivePosition(holding: Holding, lots: HoldingLot[]): Position {
  if (lots.length === 0) {
    const openShares = holding.shares;
    const costBasis = holding.shares * holding.buyPrice;
    return {
      openShares,
      costBasis,
      avgCost: openShares > 0 ? costBasis / openShares : holding.buyPrice,
      realizedGain: 0,
      lotCount: 0,
      invalid: false,
    };
  }

  const ordered = [...lots].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );

  let shares = 0;
  let costBasis = 0;
  let realizedGain = 0;
  let invalid = false;

  for (const lot of ordered) {
    const fee = lot.fee ?? 0;
    if (lot.type === 'buy') {
      shares += lot.shares;
      costBasis += lot.shares * lot.price + fee;
    } else {
      const avgCost = shares > 0 ? costBasis / shares : 0;
      // Oversell → clamp: realize only the shares actually held and flatten the
      // position (never go negative). Flag it so callers can surface the bad
      // history rather than trusting the numbers.
      const sold = lot.shares > shares + 1e-9 ? shares : lot.shares;
      if (lot.shares > shares + 1e-9) invalid = true;
      realizedGain += sold * (lot.price - avgCost) - fee;
      shares -= sold;
      costBasis -= sold * avgCost;
      if (shares <= 1e-9) {
        shares = 0;
        costBasis = 0;
      }
    }
  }

  return {
    openShares: shares,
    costBasis,
    avgCost: shares > 0 ? costBasis / shares : 0,
    realizedGain,
    lotCount: lots.length,
    invalid,
  };
}
