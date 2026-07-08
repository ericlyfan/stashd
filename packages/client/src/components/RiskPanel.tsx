import { AlertTriangle, HeartPulse, Info, Scale } from 'lucide-react';
import { PortfolioHealth } from '@stashd/shared';
import { gainClass, signedPct } from '../lib/gains';

// The portfolio's risk & health read: headline risk stats (1y vs SPY), the
// warnings the numbers justify (correlation / concentration / FX / sector),
// heuristic rebalancing hints, and a compact per-holding risk table. All
// advisory — thresholds are opinions and the panel says so.

const fmt2 = (v?: number) => (v === undefined ? '—' : v.toFixed(2));
const fmtPct = (v?: number) => (v === undefined ? '—' : `${(v * 100).toFixed(1)}%`);

export default function RiskPanel({ health }: { health: PortfolioHealth }) {
  const p = health.portfolio;
  const strongPairs = health.correlations.filter(c => c.rho >= 0.7);

  return (
    <div className="breakdown breakdown-panel risk-panel">
      <div className="breakdown-tabs">
        <div className="risk-title">
          <HeartPulse size={13} />
          Risk &amp; health
        </div>
        <span className="discover-note">1y daily closes · vs {health.benchmark} · heuristic</span>
      </div>

      <div className="risk-stats">
        <div className="risk-stat">
          <div className="rs-num">{fmtPct(p.volatility)}</div>
          <div className="rs-lbl">Volatility (ann.)</div>
        </div>
        <div className="risk-stat">
          <div className="rs-num">{fmt2(p.beta)}</div>
          <div className="rs-lbl">Beta vs {health.benchmark}</div>
        </div>
        <div className="risk-stat">
          <div className="rs-num">{fmt2(p.sharpe)}</div>
          <div className="rs-lbl">Sharpe (rf 0)</div>
        </div>
        <div className="risk-stat">
          <div className={`rs-num ${gainClass(p.maxDrawdown)}`}>{fmtPct(p.maxDrawdown)}</div>
          <div className="rs-lbl">Max drawdown</div>
        </div>
        <div className="risk-stat">
          <div className={`rs-num ${gainClass(p.return1y)}`}>{p.return1y !== undefined ? signedPct(p.return1y) : '—'}</div>
          <div className="rs-lbl">1y return</div>
        </div>
      </div>

      {(health.warnings.length > 0 || health.suggestions.length > 0) && (
        <div className="risk-notes">
          {health.warnings.map((w, i) => (
            <div key={`w${i}`} className={`risk-note risk-note-${w.severity}`}>
              {w.severity === 'warn' ? <AlertTriangle size={13} /> : <Info size={13} />}
              <span>{w.message}</span>
            </div>
          ))}
          {health.suggestions.map((s, i) => (
            <div key={`s${i}`} className="risk-note risk-note-suggest">
              <Scale size={13} />
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}
      {health.warnings.length === 0 && (
        <div className="risk-allclear">No concentration or correlation warnings at the current weights.</div>
      )}

      <div className="li-table-wrap risk-table">
        <table className="li-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="num-col">Weight</th>
              <th className="num-col">Volatility</th>
              <th className="num-col">Beta</th>
              <th className="num-col">Max DD</th>
              <th className="num-col">1y return</th>
            </tr>
          </thead>
          <tbody>
            {health.holdings.map(h => (
              <tr key={h.symbol} className="risk-row">
                <td><span className="h-ticker">{h.symbol}</span></td>
                <td className="num-col">{h.weight !== undefined ? `${(h.weight * 100).toFixed(1)}%` : '—'}</td>
                <td className="num-col">{fmtPct(h.volatility)}</td>
                <td className="num-col">{fmt2(h.beta)}</td>
                <td className={`num-col ${gainClass(h.maxDrawdown)}`}>{fmtPct(h.maxDrawdown)}</td>
                <td className={`num-col ${gainClass(h.return1y)}`}>{h.return1y !== undefined ? signedPct(h.return1y) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {strongPairs.length > 0 && (
        <div className="risk-corrs">
          <span className="risk-corrs-lbl">Most correlated:</span>
          {strongPairs.slice(0, 4).map(c => (
            <span key={`${c.a}${c.b}`} className={`risk-corr${c.rho >= 0.85 ? ' hot' : ''}`}>
              {c.a} ↔ {c.b} <b>ρ {c.rho.toFixed(2)}</b>
            </span>
          ))}
        </div>
      )}

      <p className="signal-disclaimer">
        Stats assume today’s weights held all year; thresholds are guidelines, not advice.
      </p>
    </div>
  );
}
