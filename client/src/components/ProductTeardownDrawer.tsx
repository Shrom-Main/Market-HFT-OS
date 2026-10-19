import React, { useState } from 'react';
import {
  X,
  TrendingUp,
  AlertCircle,
  Building2,
  FileText,
  Wrench,
  ExternalLink,
  ShieldCheck,
  Package,
  Layers,
  Sparkles,
  Play
} from 'lucide-react';
import { ProductObservationItem } from '../types/product';
import { WorkstationApiClient } from '../services/api';

interface ProductTeardownDrawerProps {
  product: ProductObservationItem;
  onClose: () => void;
  onRefreshData: () => void;
}

export const ProductTeardownDrawer: React.FC<ProductTeardownDrawerProps> = ({
  product,
  onClose,
  onRefreshData,
}) => {
  const [activeTab, setActiveTab] = useState<'SELL_SIDE' | 'GRIEVANCES' | 'UPSTREAM' | 'THESIS'>('GRIEVANCES');
  const [isDispatching, setIsDispatching] = useState<boolean>(false);

  const handleDispatchResearch = async () => {
    setIsDispatching(true);
    try {
      await WorkstationApiClient.dispatchResearch(
        product.product_id,
        'Operator dispatched exhaustive research from teardown drawer'
      );
      onRefreshData();
    } catch (err: any) {
      alert(`Research dispatch error: ${err.message}`);
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col font-mono animate-in slide-in-from-right duration-300">
      {/* Drawer Header */}
      <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs font-bold">
              {product.sku_id}
            </span>
            <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[10px]">
              {product.commercial_archetype}
            </span>
            {product.is_guiding_reference && (
              <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px]">
                [GUIDING REFERENCE]
              </span>
            )}
          </div>
          <h2 className="text-base font-bold text-white">{product.name}</h2>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Sub-Tab Navigation */}
      <div className="flex items-center border-b border-slate-800 bg-slate-950/60 px-6 text-xs">
        {[
          { id: 'GRIEVANCES', label: 'Buyer Grievances & Edge', icon: AlertCircle },
          { id: 'SELL_SIDE', label: 'Sell-Side Dynamics', icon: TrendingUp },
          { id: 'UPSTREAM', label: 'Upstream Hub Cluster', icon: Building2 },
          { id: 'THESIS', label: 'Strategic Thesis', icon: FileText },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-1.5 py-3 px-3 border-b-2 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-cyan-500 text-cyan-400 font-bold'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Drawer Body */}
      <div className="p-6 space-y-6 overflow-y-auto flex-1 text-xs">
        {/* TAB 1: GRIEVANCES & OPERATIONAL EDGE */}
        {activeTab === 'GRIEVANCES' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 flex items-center justify-between">
              <div>
                <span className="text-rose-400 font-bold block text-sm">
                  Overall Negative Review Frequency: {product.overall_negative_review_pct}%
                </span>
                <span className="text-slate-400 text-[11px] mt-0.5 block">
                  Identified across verified buyer feedback clusters
                </span>
              </div>
              <span className="px-2 py-1 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[11px] font-bold">
                {product.buyer_grievances?.length || 0} Failure Modes
              </span>
            </div>

            <div className="space-y-4">
              {product.buyer_grievances?.map((grievance, idx) => (
                <div
                  key={grievance.grievance_id || idx}
                  className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] text-slate-500 block">
                        FAILURE MODE #{idx + 1} · {grievance.category}
                      </span>
                      <h4 className="text-xs font-bold text-white mt-0.5">
                        {grievance.summary}
                      </h4>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        grievance.severity === 'CRITICAL'
                          ? 'bg-rose-950 text-rose-300 border-rose-800'
                          : 'bg-amber-950 text-amber-300 border-amber-800'
                      }`}
                    >
                      {grievance.severity}
                    </span>
                  </div>

                  {/* Customer Review Quote */}
                  <blockquote className="p-3 rounded-lg bg-slate-950 border-l-2 border-rose-500 text-[11px] text-slate-300 italic leading-relaxed">
                    "{grievance.representative_quote}"
                  </blockquote>

                  {/* Engineered Remediation */}
                  <div className="pt-2 border-t border-slate-800 flex items-start gap-2">
                    <Wrench className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-emerald-400 font-bold block text-[11px] uppercase tracking-wider">
                        Engineered Operational Edge (Quality Fix):
                      </span>
                      <p className="text-slate-200 mt-0.5 leading-relaxed">
                        {grievance.engineered_remediation}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 2: SELL-SIDE DYNAMICS */}
        {activeTab === 'SELL_SIDE' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">PRIMARY MARKETPLACE</span>
                <span className="text-white font-bold text-sm">
                  {product.sell_side?.primary_marketplace}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">BEST SELLER RANK</span>
                <span className="text-amber-400 font-bold text-sm">
                  #{product.sell_side?.best_seller_rank}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">MONTHLY UNIT VOLUME</span>
                <span className="text-cyan-400 font-bold text-sm">
                  {(product.sell_side?.monthly_sales_volume_est || 0).toLocaleString()} units
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">MONTHLY GROSS REVENUE</span>
                <span className="text-emerald-400 font-bold text-sm">
                  ₹{((product.sell_side?.monthly_gross_revenue_inr_est || 0) / 100000).toFixed(2)} Lakhs
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
              <span className="text-slate-400 font-bold block uppercase tracking-wider text-[11px]">
                Top Competitor Brands
              </span>
              <div className="flex flex-wrap gap-2">
                {product.sell_side?.top_competitor_names?.map((comp, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-300 text-[11px]"
                  >
                    {comp}
                  </span>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-slate-400 font-bold block uppercase tracking-wider text-[11px]">
                Dominant Pack Formats
              </span>
              <div className="flex flex-wrap gap-2">
                {product.sell_side?.dominant_pack_formats?.map((fmt, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 text-indigo-300 text-[11px]"
                  >
                    {fmt}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: UPSTREAM SOURCING */}
        {activeTab === 'UPSTREAM' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-slate-500 text-[10px] block">GEOGRAPHIC MANUFACTURING CLUSTER</span>
              <h3 className="text-sm font-bold text-emerald-400">
                {product.upstream_supply?.hub_name}
              </h3>
              <p className="text-slate-400 text-[11px]">
                Method: {product.upstream_supply?.manufacturing_method}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">FACTORY GATE QUOTE</span>
                <span className="text-white font-bold text-sm">
                  ₹{product.upstream_supply?.factory_gate_quote_inr}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">EST. LANDED COST</span>
                <span className="text-emerald-400 font-bold text-sm">
                  ₹{product.upstream_supply?.per_unit_landed_cost_est_inr}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">SUPPLIER MOQ</span>
                <span className="text-cyan-400 font-bold text-sm">
                  {product.upstream_supply?.supplier_moq} units
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">LEAD TIME</span>
                <span className="text-amber-400 font-bold text-sm">
                  {product.upstream_supply?.lead_time_days} days
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
              <span className="text-slate-500 text-[10px] block">RAW MATERIAL BASIS</span>
              <span className="text-slate-200 font-bold text-xs">
                {product.upstream_supply?.raw_material_basis}
              </span>
            </div>
          </div>
        )}

        {/* TAB 4: STRATEGIC THESIS */}
        {activeTab === 'THESIS' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <span className="text-cyan-400 font-bold block uppercase tracking-wider text-[11px]">
                Proposed Arbitrage Strategy
              </span>
              <p className="text-slate-200 leading-relaxed text-xs">
                {product.strategy?.proposed_strategy}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">TARGET GROSS SPREAD</span>
                <span className="text-emerald-400 font-bold text-sm">
                  ₹{product.strategy?.target_gross_spread_inr}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">EST. ANNUALIZED RoWC</span>
                <span className="text-purple-400 font-bold text-sm">
                  {((product.strategy?.estimated_annualized_rowc_bps || 0) / 100).toFixed(0)}%
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">WORKING CAPITAL REQ.</span>
                <span className="text-white font-bold text-sm">
                  ₹{((product.strategy?.working_capital_req_inr || 0) / 1000).toFixed(0)}k
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="text-slate-500 text-[10px] block">CASH CONVERSION CYCLE</span>
                <span className="text-cyan-300 font-bold text-sm">
                  {product.strategy?.cash_conversion_cycle_days} Days
                </span>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-1">
              <span className="text-emerald-400 font-bold uppercase tracking-wider text-[11px] block">
                Bull Case Thesis:
              </span>
              <p className="text-slate-200 leading-relaxed">
                {product.strategy?.bull_case_rationale}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40 space-y-1">
              <span className="text-rose-400 font-bold uppercase tracking-wider text-[11px] block">
                Bear Case Downside Risk:
              </span>
              <p className="text-slate-200 leading-relaxed">
                {product.strategy?.bear_case_risk}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Drawer Footer Actions */}
      <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          Decision: <strong className="text-emerald-400">{product.strategy?.strategic_decision}</strong>
        </span>

        <button
          onClick={handleDispatchResearch}
          disabled={isDispatching}
          className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs flex items-center gap-2 transition-colors shadow-lg"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>{isDispatching ? 'Dispatching...' : 'Dispatch Specialist Research'}</span>
        </button>
      </div>
    </div>
  );
};
