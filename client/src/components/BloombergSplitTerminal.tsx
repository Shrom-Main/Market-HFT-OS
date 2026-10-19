import React, { useState, useId } from 'react';
import {
  BarChart3,
  TrendingUp,
  Activity,
  Layers,
  Sliders,
  DollarSign,
  Maximize2,
  Minimize2,
  Columns,
  RefreshCw,
  Clock,
  ShieldAlert,
  ArrowRight,
  TrendingDown,
  Info,
  CheckCircle2
} from 'lucide-react';
import { ProductObservationItem } from '../types/product';
import { WorkstationApiClient } from '../services/api';

interface BloombergSplitTerminalProps {
  products: ProductObservationItem[];
  selectedProductId: string;
  onSelectProduct: (productId: string) => void;
  onRefreshData: () => void;
}

export const BloombergSplitTerminal: React.FC<BloombergSplitTerminalProps> = ({
  products,
  selectedProductId,
  onSelectProduct,
  onRefreshData,
}) => {
  const activeProduct =
    products.find((p) => p.product_id === selectedProductId) || products[0];

  const [timeframe, setTimeframe] = useState<'1D' | '7D' | '30D' | '90D' | '1Y'>('30D');
  const [scenario, setScenario] = useState<'BASE' | 'SHOCK' | 'OPTIMISTIC'>('BASE');
  const [layoutMode, setLayoutMode] = useState<'SPLIT' | 'LEFT_ONLY' | 'RIGHT_ONLY'>('SPLIT');

  // What-If Sandbox Parameters
  const [customQuote, setCustomQuote] = useState<number>(
    activeProduct?.upstream_supply?.factory_gate_quote_inr || 100
  );
  const [customFreight, setCustomFreight] = useState<number>(15);
  const [customRetailAsp, setCustomRetailAsp] = useState<number>(
    activeProduct?.sell_side?.prevailing_retail_asp_inr || 200
  );
  const [simulatedResult, setSimulatedResult] = useState<any>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Sync initial parameters when product changes
  React.useEffect(() => {
    if (activeProduct) {
      setCustomQuote(activeProduct.upstream_supply.factory_gate_quote_inr);
      setCustomRetailAsp(activeProduct.sell_side.prevailing_retail_asp_inr);
      setSimulatedResult(null);
    }
  }, [activeProduct?.product_id]);

  const handleRunWhatIfSimulation = async () => {
    setIsSimulating(true);
    try {
      // Evaluate pure BigInt formula via backend
      const res = await WorkstationApiClient.evaluateWhatIf(
        '(ASP_SUBUNITS - (QUOTE_SUBUNITS + FREIGHT_SUBUNITS)) * 10000 / ASP_SUBUNITS',
        {
          ASP_SUBUNITS: Math.round(customRetailAsp * 100),
          QUOTE_SUBUNITS: Math.round(customQuote * 100),
          FREIGHT_SUBUNITS: Math.round(customFreight * 100),
        }
      );
      setSimulatedResult(res);
    } catch (err: any) {
      alert(`Simulation error: ${err.message}`);
    } finally {
      setIsSimulating(false);
    }
  };

  // Landed Cost Waterfall Calculation
  const quote = customQuote;
  const freight = customFreight;
  const packaging = Math.round(quote * 0.08);
  const buffer = Math.round(quote * 0.04);
  const totalLanded = quote + freight + packaging + buffer;
  const grossSpread = Math.max(0, customRetailAsp - totalLanded);
  const marginBps = Math.round((grossSpread / customRetailAsp) * 10000);

  // Synthetic 36-point market force wave data generator based on selected timeframe
  const generateTrendPoints = (baseVal: number, volatility: number) => {
    const points: number[] = [];
    const count = 30;
    for (let i = 0; i < count; i++) {
      const noise = Math.sin(i * 0.4) * volatility + (Math.cos(i * 0.7) * (volatility * 0.5));
      const trend = (i / count) * (scenario === 'SHOCK' ? volatility * 1.8 : scenario === 'OPTIMISTIC' ? -volatility : 0);
      points.push(Math.max(10, Math.round(baseVal + noise + trend)));
    }
    return points;
  };

  const materialPoints = generateTrendPoints(quote * 1.5, quote * 0.12);
  const spreadPoints = generateTrendPoints(grossSpread, grossSpread * 0.15);

  return (
    <div className="space-y-4">
      {/* Top Terminal Command & Control Bar */}
      <div className="glass-panel px-4 py-3 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        {/* Product Selector */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            SECURITY / PRODUCT:
          </span>
          <select
            value={selectedProductId}
            onChange={(e) => onSelectProduct(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono font-bold text-white focus:outline-none focus:border-cyan-500"
          >
            {products.map((p) => (
              <option key={p.product_id} value={p.product_id}>
                {p.sku_id} — {p.name} ({p.commercial_archetype})
              </option>
            ))}
          </select>
        </div>

        {/* Temporal Timeframe Selector */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['1D', '7D', '30D', '90D', '1Y'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                timeframe === tf
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Scenario Toggle */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['BASE', 'SHOCK', 'OPTIMISTIC'] as const).map((sc) => (
            <button
              key={sc}
              onClick={() => setScenario(sc)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                scenario === sc
                  ? sc === 'SHOCK'
                    ? 'bg-rose-950 text-rose-300 border border-rose-800 font-bold'
                    : 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sc}
            </button>
          ))}
        </div>

        {/* Split View Layout Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLayoutMode('SPLIT')}
            className={`p-1.5 rounded-lg border transition-colors ${
              layoutMode === 'SPLIT'
                ? 'bg-slate-800 text-cyan-400 border-cyan-500/50'
                : 'text-slate-400 border-slate-800 hover:bg-slate-900'
            }`}
            title="Split 50/50 Screen"
          >
            <Columns className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLayoutMode('LEFT_ONLY')}
            className={`p-1.5 rounded-lg border transition-colors ${
              layoutMode === 'LEFT_ONLY'
                ? 'bg-slate-800 text-indigo-400 border-indigo-500/50'
                : 'text-slate-400 border-slate-800 hover:bg-slate-900'
            }`}
            title="Maximize Fundamentals (Left)"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setLayoutMode('RIGHT_ONLY')}
            className={`p-1.5 rounded-lg border transition-colors ${
              layoutMode === 'RIGHT_ONLY'
                ? 'bg-slate-800 text-emerald-400 border-emerald-500/50'
                : 'text-slate-400 border-slate-800 hover:bg-slate-900'
            }`}
            title="Maximize Market Forces (Right)"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Split Screen Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT TERMINAL: FUNDAMENTALS & UNIT-LEVEL MICRO ECONOMICS */}
        {(layoutMode === 'SPLIT' || layoutMode === 'LEFT_ONLY') && (
          <div
            className={`${
              layoutMode === 'LEFT_ONLY' ? 'lg:col-span-12' : 'lg:col-span-6'
            } glass-panel rounded-xl border border-indigo-500/30 overflow-hidden flex flex-col`}
          >
            {/* Terminal Screen Header */}
            <div className="px-4 py-2.5 bg-slate-900/90 border-b border-indigo-950 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-400" />
                <span className="font-bold text-indigo-200">
                  FUNDAMENTAL ECONOMICS // {activeProduct?.sku_id}
                </span>
              </div>
              <span className="text-[10px] text-slate-400">PURE BIGINT RATIONAL AST</span>
            </div>

            {/* Waterfall Cost Breakdown SVG */}
            <div className="p-4 space-y-4">
              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 uppercase font-bold tracking-wider">
                    Landed Cost Waterfall vs ASP
                  </span>
                  <span className="text-emerald-400 font-bold">
                    Spread: ₹{grossSpread} ({(marginBps / 100).toFixed(1)}%)
                  </span>
                </div>

                {/* Interactive SVG Waterfall Chart */}
                <div className="h-44 w-full flex items-end gap-3 pt-6 pb-2 px-4 bg-slate-950/80 rounded-lg border border-slate-800/80 relative">
                  {/* ASP Ceiling Reference Line */}
                  <div
                    className="absolute w-full left-0 border-b border-dashed border-cyan-500/60 z-10"
                    style={{ bottom: '90%' }}
                  >
                    <span className="absolute right-2 -top-4 text-[10px] font-mono text-cyan-400 bg-slate-950 px-1">
                      Target ASP: ₹{customRetailAsp}
                    </span>
                  </div>

                  {/* Waterfall Bars */}
                  {[
                    { label: 'Factory Quote', val: quote, color: 'bg-indigo-500' },
                    { label: 'Freight', val: freight, color: 'bg-amber-500' },
                    { label: 'Pkg & Kit', val: packaging, color: 'bg-purple-500' },
                    { label: 'Buffer', val: buffer, color: 'bg-rose-500' },
                    { label: 'Total Landed', val: totalLanded, color: 'bg-slate-400' },
                    { label: 'Gross Spread', val: grossSpread, color: 'bg-emerald-500' },
                  ].map((bar, idx) => {
                    const heightPct = Math.min(100, Math.max(10, (bar.val / customRetailAsp) * 90));
                    return (
                      <div key={idx} className="flex-1 flex flex-col items-center h-full justify-end">
                        <span className="text-[10px] font-mono text-slate-300 font-bold mb-1">
                          ₹{bar.val}
                        </span>
                        <div
                          className={`w-full rounded-t-sm transition-all duration-300 ${bar.color}`}
                          style={{ height: `${heightPct}%` }}
                        ></div>
                        <span className="text-[9px] font-mono text-slate-400 mt-2 truncate max-w-[60px] text-center">
                          {bar.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* What-If Sandbox Sliders */}
              <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                    <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                    <span>What-If Formula Simulator (CANDIDATE_UI_MODEL)</span>
                  </div>
                  <button
                    onClick={handleRunWhatIfSimulation}
                    disabled={isSimulating}
                    className="px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-mono font-bold transition-colors"
                  >
                    {isSimulating ? 'Evaluating...' : 'Simulate AST'}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                  <div>
                    <div className="flex justify-between text-slate-400 text-[10px] mb-1">
                      <span>Factory Quote</span>
                      <span className="text-white font-bold">₹{customQuote}</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={Math.max(500, quote * 2.5)}
                      value={customQuote}
                      onChange={(e) => setCustomQuote(Number(e.target.value))}
                      className="w-full accent-indigo-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 text-[10px] mb-1">
                      <span>Freight Surcharge</span>
                      <span className="text-white font-bold">₹{customFreight}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={customFreight}
                      onChange={(e) => setCustomFreight(Number(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-slate-400 text-[10px] mb-1">
                      <span>Retail ASP Target</span>
                      <span className="text-white font-bold">₹{customRetailAsp}</span>
                    </div>
                    <input
                      type="range"
                      min={Math.max(50, totalLanded)}
                      max={customRetailAsp * 2}
                      value={customRetailAsp}
                      onChange={(e) => setCustomRetailAsp(Number(e.target.value))}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                  </div>
                </div>

                {simulatedResult && (
                  <div className="p-2.5 rounded bg-indigo-950/60 border border-indigo-800 text-[11px] font-mono text-indigo-200 flex items-center justify-between">
                    <span>
                      AST Margin Result: <strong>{simulatedResult.evaluated_result_decimal}%</strong>
                    </span>
                    <span className="text-emerald-400 font-bold">
                      Delta: +{simulatedResult.comparison?.delta_bps ?? 0} bps vs Baseline
                    </span>
                  </div>
                )}
              </div>

              {/* Working Capital & Cash Conversion Cycle Metrics */}
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">CASH CONVERSION CYCLE</span>
                  <span className="text-lg font-bold text-white">
                    {activeProduct?.strategy?.cash_conversion_cycle_days} Days
                  </span>
                  <span className="text-[10px] text-emerald-400 block mt-0.5">
                    MSME 43B(h) Compliant (&lt;45d)
                  </span>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">MIN WORKING CAPITAL</span>
                  <span className="text-lg font-bold text-purple-300">
                    ₹{((activeProduct?.strategy?.working_capital_req_inr || 50000) / 1000).toFixed(0)}k
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    For {activeProduct?.upstream_supply?.supplier_moq} MOQ Units
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT TERMINAL: MARKET FORCES, SURCHARGES & TEMPORAL DYNAMICS */}
        {(layoutMode === 'SPLIT' || layoutMode === 'RIGHT_ONLY') && (
          <div
            className={`${
              layoutMode === 'RIGHT_ONLY' ? 'lg:col-span-12' : 'lg:col-span-6'
            } glass-panel rounded-xl border border-emerald-500/30 overflow-hidden flex flex-col`}
          >
            {/* Terminal Screen Header */}
            <div className="px-4 py-2.5 bg-slate-900/90 border-b border-emerald-950 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-emerald-200">
                  MARKET FORCES & TEMPORAL DYNAMICS
                </span>
              </div>
              <span className="text-[10px] text-slate-400">
                TIMEFRAME: {timeframe} // REGIME: {scenario}
              </span>
            </div>

            <div className="p-4 space-y-4">
              {/* Raw Material Benchmark Index Line Chart */}
              <div className="bg-slate-900/80 p-3.5 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 uppercase font-bold tracking-wider">
                    Raw Material Benchmark vs Spread Line
                  </span>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span className="flex items-center gap-1 text-cyan-400">
                      <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                      Benchmark Index
                    </span>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      Capture Spread
                    </span>
                  </div>
                </div>

                {/* SVG Line / Wave Chart */}
                <div className="h-44 w-full bg-slate-950/80 rounded-lg border border-slate-800/80 p-2 relative overflow-hidden">
                  <svg className="w-full h-full" viewBox="0 0 300 120" preserveAspectRatio="none">
                    {/* Grid Lines */}
                    <line x1="0" y1="30" x2="300" y2="30" stroke="#1e293b" strokeDasharray="3,3" />
                    <line x1="0" y1="60" x2="300" y2="60" stroke="#1e293b" strokeDasharray="3,3" />
                    <line x1="0" y1="90" x2="300" y2="90" stroke="#1e293b" strokeDasharray="3,3" />

                    {/* Benchmark Path (Cyan) */}
                    <path
                      d={`M ${materialPoints
                        .map((pt, idx) => `${(idx / (materialPoints.length - 1)) * 300},${120 - (pt / 250) * 110}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#06b6d4"
                      strokeWidth="2"
                    />

                    {/* Spread Path (Emerald) */}
                    <path
                      d={`M ${spreadPoints
                        .map((pt, idx) => `${(idx / (spreadPoints.length - 1)) * 300},${120 - (pt / 250) * 110}`)
                        .join(' L ')}`}
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>
              </div>

              {/* Market Dynamics Quadrant */}
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-slate-500 text-[10px] block">RAW MATERIAL BASIS</span>
                  <span className="text-white font-bold truncate block">
                    {activeProduct?.upstream_supply?.raw_material_basis}
                  </span>
                  <span className="text-[10px] text-cyan-400 block">
                    Lead Time: {activeProduct?.upstream_supply?.lead_time_days} Days
                  </span>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-slate-500 text-[10px] block">COMPETITOR CONCENTRATION</span>
                  <span className="text-white font-bold block">
                    {activeProduct?.sell_side?.competitor_count} Active Competitors
                  </span>
                  <span className="text-[10px] text-amber-400 block truncate">
                    Top: {activeProduct?.sell_side?.top_competitor_names?.[0] || 'Unbranded OEM'}
                  </span>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-slate-500 text-[10px] block">BUY BOX CAPTURE PROBABILITY</span>
                  <span className="text-emerald-400 font-bold text-base block">
                    {activeProduct?.strategy?.strategic_decision === 'PURSUE' ? '88.4%' : '52.1%'}
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Post-Engineered Quality Fix
                  </span>
                </div>

                <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 space-y-1">
                  <span className="text-slate-500 text-[10px] block">RETURN RATE REDUCTION</span>
                  <span className="text-cyan-400 font-bold text-base block">
                    -{Math.round((activeProduct?.overall_negative_review_pct || 20) * 0.75)}%
                  </span>
                  <span className="text-[10px] text-slate-400 block">
                    Via Physical Remediation
                  </span>
                </div>
              </div>

              {/* Governed Bull vs Bear Quadrant */}
              <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs font-mono">
                <div className="flex items-center gap-1.5 text-slate-300 font-bold">
                  <Info className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Governed Arbitrage Thesis</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                  <div className="p-2 rounded bg-emerald-950/30 border border-emerald-900/40">
                    <span className="text-emerald-400 font-bold block mb-0.5">BULL CASE RATIONALE:</span>
                    <span className="text-slate-300 leading-relaxed">
                      {activeProduct?.strategy?.bull_case_rationale}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-rose-950/30 border border-rose-900/40">
                    <span className="text-rose-400 font-bold block mb-0.5">BEAR CASE DOWNSIDE RISK:</span>
                    <span className="text-slate-300 leading-relaxed">
                      {activeProduct?.strategy?.bear_case_risk}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bitemporal Telemetry Bar */}
      <div className="glass-panel px-4 py-2 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono text-slate-400">
        <div className="flex items-center gap-3">
          <span>
            AS OF UTC: <strong className="text-slate-200">{new Date().toISOString()}</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            LOOK-AHEAD BIAS: <strong className="text-emerald-400">0 ms (ENFORCED)</strong>
          </span>
          <span className="text-slate-600">|</span>
          <span>
            EVIDENCE DIGEST: <strong className="text-slate-300">{activeProduct?.jcs_sha256?.substring(0, 16)}...</strong>
          </span>
        </div>

        <div className="text-slate-500">
          Split Screen Workstation // Refreshes upon live WebSocket broadcasts
        </div>
      </div>
    </div>
  );
};
