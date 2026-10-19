import React, { useState } from 'react';
import {
  TrendingUp,
  Search,
  Filter,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Building2,
  Wrench,
  AlertCircle,
  CheckCircle2,
  Package,
  Boxes,
  Percent,
  Plus,
  Play,
  Bot,
  Brain,
  Sliders,
  DollarSign,
  Clock,
  ArrowUpRight
} from 'lucide-react';
import { ProductObservationItem, CommercialArchetype } from '../types/product';
import { WorkstationApiClient } from '../services/api';

interface CockpitHomeProps {
  products: ProductObservationItem[];
  onSelectProductForTeardown: (product: ProductObservationItem) => void;
  onSelectProductForSplitTerminal: (productId: string) => void;
  onOpenGroqModal: (product: ProductObservationItem) => void;
  onRefreshData: () => void;
}

export const CockpitHome: React.FC<CockpitHomeProps> = ({
  products,
  onSelectProductForTeardown,
  onSelectProductForSplitTerminal,
  onOpenGroqModal,
  onRefreshData,
}) => {
  const [selectedArchetype, setSelectedArchetype] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showPushForm, setShowPushForm] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  // New Product Push Form States
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('Standard Mechanical Consumables');
  const [newArchetype, setNewArchetype] = useState<CommercialArchetype>('CLUSTER_MRO_STANDARDIZED');
  const [newMarketplace, setNewMarketplace] = useState('Amazon India');
  const [newListingUrl, setNewListingUrl] = useState('https://www.amazon.in/dp/B0EXAMP123');
  const [newMonthlyVol, setNewMonthlyVol] = useState(1500);
  const [newAsp, setNewAsp] = useState(350);
  const [newGrievanceSummary, setNewGrievanceSummary] = useState('Threads stripping under moderate torque');
  const [newGrievanceQuote, setNewGrievanceQuote] = useState('Screws sheared off when tightening, cheap zinc alloy');
  const [newRemediation, setNewRemediation] = useState('Switch to Grade 8.8 quenched carbon steel with CNC rolled threads');
  const [newHubName, setNewHubName] = useState('Ludhiana Fasteners Cluster');
  const [newFactoryQuote, setNewFactoryQuote] = useState(120);
  const [newMoq, setNewMoq] = useState(500);
  const [newProposedStrategy, setNewProposedStrategy] = useState('High-Torque Contractor Pack with Calibrated Hex Driver');
  const [newGrossSpread, setNewGrossSpread] = useState(230);
  const [newDecision, setNewDecision] = useState<'PURSUE' | 'INVESTIGATING' | 'MONITOR_ONLY'>('PURSUE');

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesArchetype =
      selectedArchetype === 'ALL' || p.commercial_archetype === selectedArchetype;
    const matchesSearch =
      searchQuery === '' ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.upstream_supply.hub_name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesArchetype && matchesSearch;
  });

  // Calculate aggregates
  const totalVolume = products.reduce((acc, p) => acc + (p.sell_side?.monthly_sales_volume_est || 0), 0);
  const totalGrossRev = products.reduce((acc, p) => acc + (p.sell_side?.monthly_gross_revenue_inr_est || 0), 0);
  const pursueCount = products.filter((p) => p.strategy?.strategic_decision === 'PURSUE').length;

  const handleDispatchResearch = async (productId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDispatchingId(productId);
    try {
      await WorkstationApiClient.dispatchResearch(
        productId,
        'Operator dispatched exhaustive research from Cockpit UI'
      );
      onRefreshData();
    } catch (err: any) {
      alert(`Research dispatch error: ${err.message}`);
    } finally {
      setDispatchingId(null);
    }
  };

  const handlePushProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSku || !newName) {
      alert('SKU and Product Name are required');
      return;
    }
    setIsSubmitting(true);
    try {
      await WorkstationApiClient.pushProductObservation({
        sku_id: newSku,
        name: newName,
        category: newCategory,
        commercial_archetype: newArchetype,
        primary_marketplace: newMarketplace,
        listing_url: newListingUrl,
        monthly_sales_volume_est: Number(newMonthlyVol),
        prevailing_retail_asp_inr: Number(newAsp),
        primary_grievance_summary: newGrievanceSummary,
        representative_quote: newGrievanceQuote,
        engineered_remediation: newRemediation,
        hub_name: newHubName,
        factory_gate_quote_inr: Number(newFactoryQuote),
        supplier_moq: Number(newMoq),
        proposed_strategy: newProposedStrategy,
        target_gross_spread_inr: Number(newGrossSpread),
        strategic_decision: newDecision,
      });
      setShowPushForm(false);
      onRefreshData();
    } catch (err: any) {
      alert(`Failed to push observation: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Hero KPI Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>TRACKED OPPORTUNITIES</span>
            <Boxes className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">{products.length}</span>
            <span className="text-[11px] font-mono text-cyan-400">Products</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            Across 6 Commercial Archetypes
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>ACTIVE INVESTIGATIONS</span>
            <Sparkles className="w-4 h-4 text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-amber-300">
              {products.length - 1}
            </span>
            <span className="text-[11px] font-mono text-slate-400">In Progress</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            + 1 Guiding Benchmark Anchor
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>PURSUE DECISIONS</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-400">{pursueCount}</span>
            <span className="text-[11px] font-mono text-emerald-500/80">Approved For Sourcing</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            Validated Positive Spread
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>MONTHLY VOLUME EST.</span>
            <Package className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-white">
              {(totalVolume / 1000).toFixed(1)}k
            </span>
            <span className="text-[11px] font-mono text-slate-400">Units / Month</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            Across Target Marketplaces
          </div>
        </div>

        <div className="glass-panel p-4 rounded-xl border border-slate-800">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>AGGREGATE GROSS REV.</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono text-emerald-300">
              ₹{(totalGrossRev / 100000).toFixed(1)}L
            </span>
            <span className="text-[11px] font-mono text-slate-400">/ Month</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            Gross Market Capture Surface
          </div>
        </div>
      </div>

      {/* Filter Ribbon & Push Button */}
      <div className="glass-panel p-4 rounded-xl border border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Archetype Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'ALL', label: 'All Archetypes' },
            { id: 'CLUSTER_MRO_STANDARDIZED', label: 'Cluster MRO' },
            { id: 'TECHNICAL_COMPLIANCE', label: 'Technical / BIS' },
            { id: 'SEASONAL_D2C_VISUAL', label: 'Seasonal D2C' },
            { id: 'D2C_CONSUMABLE', label: 'D2C Consumables' },
            { id: 'MRO_INDUSTRIAL', label: 'Heavy Fasteners' },
            { id: 'REPLACEMENT_PARTS', label: 'Replacement Seals' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedArchetype(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                selectedArchetype === tab.id
                  ? 'bg-cyan-950 text-cyan-200 border border-cyan-500/60 font-semibold shadow-[0_0_10px_rgba(6,182,212,0.2)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search & Ingestion Button */}
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search product, SKU, hub..."
              className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            onClick={() => setShowPushForm(!showPushForm)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-bold font-mono transition-colors shrink-0 shadow-lg"
          >
            <Plus className="w-4 h-4" />
            <span>{showPushForm ? 'Close Ingest' : 'Push Product'}</span>
          </button>
        </div>
      </div>

      {/* Collapsible Push Product Form */}
      {showPushForm && (
        <form
          onSubmit={handlePushProduct}
          className="glass-panel p-6 rounded-xl border border-cyan-500/40 space-y-4 animate-in fade-in slide-in-from-top-4 duration-200"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-cyan-400" />
              <h3 className="text-sm font-bold font-mono text-white">
                Push New Product Observation to Deck
              </h3>
            </div>
            <span className="text-[11px] font-mono text-cyan-400">
              Validates and hashes via RFC 8785 JCS SHA-256
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">SKU ID *</label>
              <input
                type="text"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                placeholder="SKU-VALVE-BRASS-12IN"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Product Title *</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Forged Brass Ball Valves 1/2in PN20"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
                required
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Commercial Archetype</label>
              <select
                value={newArchetype}
                onChange={(e) => setNewArchetype(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              >
                <option value="CLUSTER_MRO_STANDARDIZED">CLUSTER_MRO_STANDARDIZED</option>
                <option value="TECHNICAL_COMPLIANCE">TECHNICAL_COMPLIANCE</option>
                <option value="SEASONAL_D2C_VISUAL">SEASONAL_D2C_VISUAL</option>
                <option value="D2C_CONSUMABLE">D2C_CONSUMABLE</option>
                <option value="MRO_INDUSTRIAL">MRO_INDUSTRIAL</option>
                <option value="REPLACEMENT_PARTS">REPLACEMENT_PARTS</option>
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Monthly Sales Volume Est.</label>
              <input
                type="number"
                value={newMonthlyVol}
                onChange={(e) => setNewMonthlyVol(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Prevailing Retail ASP (₹)</label>
              <input
                type="number"
                value={newAsp}
                onChange={(e) => setNewAsp(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Upstream Sourcing Hub</label>
              <input
                type="text"
                value={newHubName}
                onChange={(e) => setNewHubName(e.target.value)}
                placeholder="Jamnagar Brass Cluster (Gujarat)"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Factory Gate Quote (₹)</label>
              <input
                type="number"
                value={newFactoryQuote}
                onChange={(e) => setNewFactoryQuote(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Supplier MOQ</label>
              <input
                type="number"
                value={newMoq}
                onChange={(e) => setNewMoq(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Strategic Decision</label>
              <select
                value={newDecision}
                onChange={(e) => setNewDecision(e.target.value as any)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              >
                <option value="PURSUE">PURSUE</option>
                <option value="INVESTIGATING">INVESTIGATING</option>
                <option value="MONITOR_ONLY">MONITOR_ONLY</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono pt-2 border-t border-slate-800">
            <div>
              <label className="text-slate-400 block mb-1">
                Buyer Review Grievance Summary & Representative Quote
              </label>
              <input
                type="text"
                value={newGrievanceSummary}
                onChange={(e) => setNewGrievanceSummary(e.target.value)}
                placeholder="Grievance summary"
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 mb-2"
              />
              <textarea
                value={newGrievanceQuote}
                onChange={(e) => setNewGrievanceQuote(e.target.value)}
                placeholder="Exact customer quote from reviews..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div>
              <label className="text-slate-400 block mb-1">
                Engineered Operational Edge (Quality Fix Formulation)
              </label>
              <textarea
                value={newRemediation}
                onChange={(e) => setNewRemediation(e.target.value)}
                placeholder="The physical or metallurgical fix to eliminate returns and win the Buy Box..."
                rows={4}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowPushForm(false)}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold font-mono transition-colors"
            >
              {isSubmitting ? 'Pushing...' : 'Commit Observation to Deck'}
            </button>
          </div>
        </form>
      )}

      {/* Product Opportunities Cards Grid */}
      <div className="grid grid-cols-1 gap-6">
        {filteredProducts.map((product) => {
          const topGrievance = product.buyer_grievances?.[0];
          const isGuiding = product.is_guiding_reference;
          const isPursue = product.strategy?.strategic_decision === 'PURSUE';
          const isInvestigating = product.strategy?.strategic_decision === 'INVESTIGATING';

          return (
            <div
              key={product.product_id}
              className={`glass-panel rounded-2xl border transition-all duration-200 overflow-hidden hover:border-slate-600 ${
                isGuiding
                  ? 'border-cyan-500/40 ring-1 ring-cyan-500/20'
                  : 'border-slate-800'
              }`}
            >
              {/* Card Header Strip */}
              <div className="px-6 py-4 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[11px] font-mono font-bold">
                    {product.sku_id}
                  </span>
                  <span className="text-sm font-bold font-mono text-white">
                    {product.name}
                  </span>
                  {isGuiding && (
                    <span className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-mono font-semibold">
                      [GUIDING REFERENCE]
                    </span>
                  )}
                  <span className="px-2 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 text-[10px] font-mono">
                    {product.commercial_archetype}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Origin Class Badge */}
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border font-semibold ${
                      product.evidence_origin?.origin_class === 'LIVE_VERIFIED_CAPTURE'
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}
                  >
                    {product.evidence_origin?.semantic_badge?.icon_symbol || '[FIXTURE]'}{' '}
                    {product.evidence_origin?.origin_class === 'LIVE_VERIFIED_CAPTURE' ? 'LIVE' : 'FIXTURE'}
                  </span>

                  {/* Decision Badge */}
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold border ${
                      isPursue
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-600'
                        : isInvestigating
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-600'
                        : 'bg-amber-950 text-amber-300 border-amber-600'
                    }`}
                  >
                    {product.strategy?.strategic_decision}
                  </span>
                </div>
              </div>

              {/* 3-Column Dossier Body */}
              <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Column 1: Sell-Side Dynamics ("What Others Are Selling") */}
                <div className="lg:col-span-4 space-y-3 border-b lg:border-b-0 lg:border-r border-slate-800/80 pb-6 lg:pb-0 lg:pr-6">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                    <TrendingUp className="w-4 h-4 text-cyan-400" />
                    <span>Sell-Side Marketplace Dynamics</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">MONTHLY GROSS REV.</span>
                      <span className="text-emerald-400 font-bold text-sm">
                        ₹{((product.sell_side?.monthly_gross_revenue_inr_est || 0) / 100000).toFixed(2)}L
                      </span>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">MONTHLY VOLUME</span>
                      <span className="text-white font-bold text-sm">
                        {(product.sell_side?.monthly_sales_volume_est || 0).toLocaleString()} units
                      </span>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">PREVAILING RETAIL ASP</span>
                      <span className="text-cyan-300 font-bold">
                        ₹{product.sell_side?.prevailing_retail_asp_inr}
                      </span>
                    </div>

                    <div className="bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                      <span className="text-slate-500 block text-[10px]">BEST SELLER RANK</span>
                      <span className="text-amber-300 font-bold">
                        #{product.sell_side?.best_seller_rank}
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-slate-400 space-y-1 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Marketplace:</span>
                      <span className="text-slate-300">{product.sell_side?.primary_marketplace}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Competitors:</span>
                      <span className="text-slate-300">
                        {product.sell_side?.competitor_count} active brands
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Formats:</span>
                      <span className="text-slate-300 truncate max-w-[180px]">
                        {product.sell_side?.dominant_pack_formats?.join(', ')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Column 2: Buyer Review Grievance Mining ("What Buyers Are Noting as Feedback") */}
                <div className="lg:col-span-5 space-y-3 border-b lg:border-b-0 lg:border-r border-slate-800/80 pb-6 lg:pb-0 lg:pr-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                      <AlertCircle className="w-4 h-4 text-rose-400" />
                      <span>Buyer Grievance Mining ({product.overall_negative_review_pct}% Negative)</span>
                    </div>
                  </div>

                  {topGrievance && (
                    <div className="p-3 rounded-xl bg-rose-950/20 border border-rose-900/40 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold font-mono text-rose-200">
                          {topGrievance.summary}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[9px] font-mono shrink-0">
                          {topGrievance.severity}
                        </span>
                      </div>

                      <blockquote className="text-[11px] font-mono text-slate-300 italic border-l-2 border-rose-500/60 pl-2 leading-relaxed">
                        "{topGrievance.representative_quote}"
                      </blockquote>

                      {/* Engineered Operational Edge */}
                      <div className="pt-2 border-t border-rose-900/30 flex items-start gap-2">
                        <Wrench className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <div className="text-[11px] font-mono">
                          <span className="text-emerald-400 font-bold uppercase tracking-wider block">
                            Engineered Operational Edge (Quality Fix):
                          </span>
                          <span className="text-slate-200 leading-relaxed">
                            {topGrievance.engineered_remediation}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {product.buyer_grievances && product.buyer_grievances.length > 1 && (
                    <div className="text-[11px] font-mono text-slate-500 flex items-center justify-between">
                      <span>
                        + {product.buyer_grievances.length - 1} more categorized failure mode(s)
                      </span>
                      <button
                        onClick={() => onSelectProductForTeardown(product)}
                        className="text-cyan-400 hover:underline"
                      >
                        View all grievances &rarr;
                      </button>
                    </div>
                  )}
                </div>

                {/* Column 3: Upstream Sourcing Hub & Strategic Thesis */}
                <div className="lg:col-span-3 space-y-3 flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-300 uppercase tracking-wider">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                      <span>Upstream Sourcing Hub</span>
                    </div>

                    <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-800 text-xs font-mono space-y-1.5">
                      <div className="text-slate-200 font-bold truncate">
                        {product.upstream_supply?.hub_name}
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Factory Gate Quote:</span>
                        <span className="text-white font-semibold">
                          ₹{product.upstream_supply?.factory_gate_quote_inr}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Est. Landed COGS:</span>
                        <span className="text-emerald-400 font-bold">
                          ₹{product.upstream_supply?.per_unit_landed_cost_est_inr}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Target Gross Spread:</span>
                        <span className="text-cyan-300 font-bold">
                          ₹{product.strategy?.target_gross_spread_inr}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-slate-400 text-[11px]">
                        <span>Est. Annualized RoWC:</span>
                        <span className="text-purple-300 font-bold">
                          {((product.strategy?.estimated_annualized_rowc_bps || 0) / 100).toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons Toolbar */}
                  <div className="pt-2 flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => onSelectProductForSplitTerminal(product.product_id)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-200 border border-indigo-700/60 text-xs font-mono transition-all"
                        title="Open Bloomberg-Style Split-Terminal for Temporal Dynamics"
                      >
                        <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Terminal</span>
                      </button>

                      <button
                        onClick={() => onOpenGroqModal(product)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/60 text-xs font-mono transition-all"
                        title="AI Strategy Synthesis via Groq"
                      >
                        <Brain className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Groq AI</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={(e) => handleDispatchResearch(product.product_id, e)}
                        disabled={dispatchingId === product.product_id}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-cyan-950 text-cyan-300 border border-slate-700 hover:border-cyan-600 text-xs font-mono transition-all"
                      >
                        <Play className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{dispatchingId === product.product_id ? 'Running...' : 'Dispatch'}</span>
                      </button>

                      <button
                        onClick={() => onSelectProductForTeardown(product)}
                        className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-mono font-bold transition-all shadow-md"
                      >
                        <span>Teardown</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
