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
}

// Chronologically fold a holding's lots into its current position. Lots are
// sorted by trade date (then insertion order) so sells resolve against the
// average cost as it stood at that point. Oversells are invalid state and are
// rejected instead of being folded into a misleading position.
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
    };
  }

  const ordered = [...lots].sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );

  let shares = 0;
  let costBasis = 0;
  let realizedGain = 0;

  for (const lot of ordered) {
    const fee = lot.fee ?? 0;
    if (lot.type === 'buy') {
      shares += lot.shares;
      costBasis += lot.shares * lot.price + fee;
    } else {
      const avgCost = shares > 0 ? costBasis / shares : 0;
      if (lot.shares > shares + 1e-9) {
        throw new Error(`Cannot sell ${lot.shares} shares on ${lot.date}; only ${+shares.toFixed(8)} shares are available`);
      }
      realizedGain += lot.shares * (lot.price - avgCost) - fee;
      shares -= lot.shares;
      costBasis -= lot.shares * avgCost;
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
  };
}
