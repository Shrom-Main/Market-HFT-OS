import React, { useState, useEffect } from 'react';
import {
  FileText,
  ShieldCheck,
  AlertTriangle,
  Compass,
  Search,
  Cpu,
  Building2,
  TrendingUp,
  CheckCircle2,
  Clock,
  ArrowRight,
  Filter,
  ShieldAlert
} from 'lucide-react';
import { WorkspaceRouteId } from './shell/NavigationRail';

export interface ThesisItem {
  thesis_id: string;
  candidate_id: string;
  atlas_node_id: string;
  entity_id: string;
  entity_name: string;
  title: string;
  opportunity_conviction_bps: number;
  supplier_confidence_bps: number;
  underwriting_state: 'QUARANTINED_PENDING_AUDIT' | 'UNDER_REVIEW' | 'VERIFIED_ROBUST' | 'DATA_REQUIRED';
  lifecycle_state: 'PRELIMINARY_FORMULATION' | 'ADVERSARIAL_REVIEW' | 'VERIFIED_ROBUST' | 'FALSIFIED';
  epistemic_status: 'VERIFIED' | 'CORROBORATED' | 'ASSUMPTION' | 'DATA_REQUIRED' | 'CONTRADICTED';
  refutation_callout?: string;
  bull_hypothesis: string;
  bear_falsification_risk: string;
  target_contribution_pct: number;
  supporting_evidence: {
    source: string;
    fact: string;
    verification_type: string;
  }[];
  contradictory_evidence: {
    source: string;
    fact: string;
    audit_notes: string;
  }[];
  statutory_summary: string;
  logistics_lane: string;
}

export const THESIS_RECORDS: ThesisItem[] = [
  {
    thesis_id: 'THESIS-SS304-HOWRAH-01',
    candidate_id: 'OPP-E6B40775E03ECE44',
    atlas_node_id: 'GEO-HOWRAH-BALTIKURI-01',
    entity_id: 'GEO-HOWRAH-BALTIKURI-01',
    entity_name: 'Modern Metal Works / Apex Precision Fasteners',
    title: 'Industrial Hardware Distributor Arbitrage (SS304 DIN 3017 Hose Clamps)',
    opportunity_conviction_bps: 8500,
    supplier_confidence_bps: 0,
    underwriting_state: 'QUARANTINED_PENDING_AUDIT',
    lifecycle_state: 'ADVERSARIAL_REVIEW',
    epistemic_status: 'CONTRADICTED',
    refutation_callout:
      'CRITICAL AUDIT REFUTATION: Task 4 ICP-OES spectrometry test flagged 7.2% Mn and 1.2% Ni (SS201 alloy) on unbranded market samples vs claimed SS304. Sourcing quote cannot be underwritten until direct vendor batch audit succeeds. Supplier confidence reduced to 0 bps.',
    bull_hypothesis:
      'Macro opportunity: Displacing unbranded SS201 clamps with certified DIN 3017 SS304 contractor 10-packs captures premium B2B margin. Howrah cluster allows rapid replenishment via NH16 corridor to Kolkata Syama Prasad Mookerjee Port.',
    bear_falsification_risk:
      'Nickel price MCX volatility > 25% or local unorganized re-melting compromising chromium alloy integrity below 18.0%. Sourcing batch quarantined pending metallurgical re-audit.',
    target_contribution_pct: 38.5,
    supporting_evidence: [
      {
        source: 'Stage C Candidate Fixture',
        fact: 'Active statutory standing claim (CIN: U28991WB2014PTC201882) from test fixture.',
        verification_type: 'SYNTHETIC_DEMO_FIXTURE'
      },
      {
        source: 'Direct Sourcing Fixture FIX-B2B-HOWRAH-001',
        fact: 'Factory gate quote recorded at ₹28.50/unit for 1,000 unit batch with claimed W4 worm housing.',
        verification_type: 'RECORDED_FIXTURE'
      },
      {
        source: 'Amazon B2B Marketplace Feed',
        fact: 'Prevailing contractor 10-pack retail ASP verified at ₹85.00/unit.',
        verification_type: 'OBSERVED_MARKET'
      }
    ],
    contradictory_evidence: [
      {
        source: 'Laboratory Spectrometry Audit (Task 4)',
        fact: 'Competing unbranded sample exhibited 7.2% Mn and 1.2% Ni (SS201 alloy) rather than required 18% Cr / 8% Ni (SS304).',
        audit_notes: 'Validates thesis refutation of cheap competitors but mandates strict pre-dispatch PMI metallurgical testing on our vendor lot.'
      }
    ],
    statutory_summary: 'CIN U28991WB2014PTC201882 [DEMO] • GSTIN 19AAACM1234F1Z5 [DEMO] • Baltikuri Centroid',
    logistics_lane: 'NH16 / Syama Prasad Mookerjee Port (~14 km Road Est.)'
  },
  {
    thesis_id: 'THESIS-VALVE-JAMNAGAR-01',
    candidate_id: 'OPP-4C9B52BBEB89D4E2',
    atlas_node_id: 'GEO-JAMNAGAR-GIDC-02',
    entity_id: 'GEO-JAMNAGAR-GIDC-02',
    entity_name: 'Omkar Brass Industries',
    title: 'Plumbing & Fluid Control Arbitrage (Forged Brass Ball Valves 1/2" PN20)',
    opportunity_conviction_bps: 7800,
    supplier_confidence_bps: 5500,
    underwriting_state: 'UNDER_REVIEW',
    lifecycle_state: 'ADVERSARIAL_REVIEW',
    epistemic_status: 'CORROBORATED',
    refutation_callout:
      'PENDING SECONDARY AUDIT: Independent second supplier quote required to rule out local GIDC Phase-II brass cartel pricing markups before capital commitment.',
    bull_hypothesis:
      'Contractor 2-packs displace brittle cast-handle competitors; dual PTFE stem seals eliminate slow weep leaks identified in 31% of competitor reviews in residential plumbing installations.',
    bear_falsification_risk:
      'LME copper/zinc billet volatility before batch delivery; foundry sand-casting porosity defects leading to micro-seepage under 16 bar hydro-testing.',
    target_contribution_pct: 34.2,
    supporting_evidence: [
      {
        source: 'Synthetic Registration Claim',
        fact: 'Reported Udyam Registration GJ-14-002194 in demo fixture.',
        verification_type: 'SYNTHETIC_DEMO_FIXTURE'
      },
      {
        source: 'Factory Gate Quote Jamnagar GIDC Phase-II',
        fact: 'Confirmed quote ₹115.00/unit; IS 9890 forged brass standard claim.',
        verification_type: 'RECORDED_FIXTURE'
      },
      {
        source: 'Deendayal (Kandla) Port Corridor Access',
        fact: '~115 km road highway estimate via SH26 for export containerization.',
        verification_type: 'APPROXIMATE_GEOGRAPHIC_REFERENCE'
      }
    ],
    contradictory_evidence: [
      {
        source: 'Supplier Syndication Screen',
        fact: 'Second supplier quote required to rule out local cartelized brass billet markups in Jamnagar Dared cluster.',
        audit_notes: 'Underwriting conditional on secondary quote from GIDC Phase-III alternative foundry.'
      }
    ],
    statutory_summary: 'Udyam GJ-14-002194 [DEMO] • GSTIN 24AAAFO1234F1Z8 [DEMO] • Dared Centroid',
    logistics_lane: 'SH26 / Deendayal Port Kandla (~115 km Road Est.)'
  },
  {
    thesis_id: 'THESIS-DEVTOOL-SAAS-01',
    candidate_id: 'OPP-65038D38DF8D8B67',
    atlas_node_id: 'GEO-SAAS-SYNAPSE-10',
    entity_id: 'GEO-SAAS-SYNAPSE-10',
    entity_name: 'Synapse Distributed Tracing Ltd',
    title: 'Distributed eBPF Tracing SaaS Margin Arbitrage (Team Tier)',
    opportunity_conviction_bps: 6200,
    supplier_confidence_bps: 4500,
    underwriting_state: 'DATA_REQUIRED',
    lifecycle_state: 'PRELIMINARY_FORMULATION',
    epistemic_status: 'DATA_REQUIRED',
    refutation_callout:
      'DATA REQUIRED: Direct compute and egress COGS missing. Gross margin cannot be verified without audited provider infrastructure invoices.',
    bull_hypothesis:
      'Open-telemetry compatible binary agent with low CPU overhead achieves potential high margins against Datadog and Dynatrace pricing tiers.',
    bear_falsification_risk:
      'Cloud egress costs across multi-cloud regions; unverified AWS hosting invoice prevents exact unit gross margin calculation.',
    target_contribution_pct: 68.0,
    supporting_evidence: [
      {
        source: 'Synthetic Registration Claim',
        fact: 'Delaware File 7894120 in demo fixture.',
        verification_type: 'SYNTHETIC_DEMO_FIXTURE'
      },
      {
        source: 'Marketplace Subscription Plan',
        fact: 'Retail ASP $4,999 / year per 50-node cluster observed.',
        verification_type: 'OBSERVED_MARKET'
      }
    ],
    contradictory_evidence: [
      {
        source: 'Underwriting Cost Engine',
        fact: 'Direct compute and egress COGS missing [DATA REQUIRED]. Cannot verify margin claim without audited provider invoice.',
        audit_notes: 'Classified as UNSUPPORTED until infrastructure cost accounting is provided.'
      }
    ],
    statutory_summary: 'Delaware File 7894120 [DEMO] • Pure Cloud Asset [DATA REQUIRED]',
    logistics_lane: 'Global Multi-Region CDN / Anycast Network (No Physical Foundry)'
  }
];

export interface ThesisIntelligenceProps {
  selectedThesisId?: string | null;
  onSelectThesis?: (thesisId: string) => void;
  onNavigateToAtlas?: (nodeId: string) => void;
  onNavigateToDiscovery?: (candidateId: string) => void;
  onNavigateToEntity?: (entityId: string) => void;
  onNavigateToInvestigation?: (candidateId: string) => void;
}

export const ThesisIntelligence: React.FC<ThesisIntelligenceProps> = ({
  selectedThesisId,
  onSelectThesis,
  onNavigateToAtlas,
  onNavigateToDiscovery,
  onNavigateToEntity,
  onNavigateToInvestigation
}) => {
  const [activeThesisId, setActiveThesisId] = useState<string>(
    selectedThesisId || 'THESIS-SS304-HOWRAH-01'
  );

  useEffect(() => {
    if (selectedThesisId) {
      setActiveThesisId(selectedThesisId);
    }
  }, [selectedThesisId]);

  const activeThesis =
    THESIS_RECORDS.find((t) => t.thesis_id === activeThesisId) || THESIS_RECORDS[0];

  const handleSelect = (id: string) => {
    setActiveThesisId(id);
    onSelectThesis?.(id);
  };

  return (
    <div className="h-full flex flex-col bg-[#080B10] text-[#E6EDF5] overflow-hidden select-none font-sans">
      {/* 1. Header Ribbon */}
      <div className="h-10 bg-[#0C1118] border-b border-[#263342] px-3 flex items-center justify-between shrink-0 text-xs font-mono">
        <div className="flex items-center space-x-2">
          <FileText className="w-3.5 h-3.5 text-[#35B88A]" />
          <span className="font-bold text-[#E6EDF5] uppercase tracking-wide">
            INDEPENDENT THESIS INTELLIGENCE &amp; HYPOTHESIS LEDGER
          </span>
          <span className="text-[#263342]">|</span>
          <span className="text-[#A6B4C3] hidden md:inline">
            FALSIFICATION CONDITIONS, CONVICTION DECOUPLING &amp; GROUNDED EVIDENCE
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="badge-epistemic badge-verified">
            {THESIS_RECORDS.length} ACTIVE HYPOTHESES
          </span>
        </div>
      </div>

      {/* 2. Main Dual-Pane Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Thesis List & Conviction Ranking */}
        <aside className="w-80 bg-[#0C1118] border-r border-[#263342] flex flex-col shrink-0">
          <div className="p-2.5 bg-[#111923] border-b border-[#263342] flex items-center justify-between text-[11px] font-mono text-[#738397]">
            <span>FORMULATED THESES ({THESIS_RECORDS.length})</span>
            <span>UNDERWRITING STATE</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#263342]/40">
            {THESIS_RECORDS.map((thesis) => {
              const isSelected = thesis.thesis_id === activeThesis.thesis_id;
              const isQuarantined = thesis.underwriting_state === 'QUARANTINED_PENDING_AUDIT';
              return (
                <div
                  key={thesis.thesis_id}
                  onClick={() => handleSelect(thesis.thesis_id)}
                  className={`p-3 transition-colors cursor-pointer space-y-1.5 ${
                    isSelected
                      ? 'bg-[#172230] border-l-2 border-[#5794D6]'
                      : 'hover:bg-[#111923] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#E6EDF5]">
                      {thesis.thesis_id}
                    </span>
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                        isQuarantined
                          ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                          : thesis.underwriting_state === 'UNDER_REVIEW'
                          ? 'bg-[#3D2F1B] text-[#E5AC55] border border-[#6B4E1B]'
                          : 'bg-[#1B3D2F] text-[#35B88A] border border-[#2D664E]'
                      }`}
                    >
                      {isQuarantined ? 'QUARANTINED' : thesis.underwriting_state}
                    </span>
                  </div>

                  <div className="text-xs text-[#A6B4C3] line-clamp-2 leading-relaxed">
                    {thesis.title}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[10px] font-mono text-[#738397]">
                    <span>Macro: {thesis.opportunity_conviction_bps.toLocaleString()} bps</span>
                    <span className={thesis.supplier_confidence_bps === 0 ? 'text-[#FF6B6B] font-bold' : 'text-[#E5AC55]'}>
                      Supplier: {thesis.supplier_confidence_bps === 0 ? '0 bps [REFUTED]' : `${thesis.supplier_confidence_bps} bps`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right: Detailed Hypothesis Inspector & Evidence Chain */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#080B10]">
          {/* Header Card */}
          <div className="bg-[#111923] border border-[#263342] p-4 rounded-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-mono font-bold text-[#5794D6]">
                  {activeThesis.thesis_id}
                </span>
                <span className="text-[#263342]">/</span>
                <span className="text-xs font-mono text-[#A6B4C3]">{activeThesis.candidate_id}</span>
              </div>
              <div className="flex items-center space-x-2">
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                    activeThesis.underwriting_state === 'QUARANTINED_PENDING_AUDIT'
                      ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                      : 'bg-[#172E3D] text-[#4EB3D3] border border-[#234E6B]'
                  }`}
                >
                  {activeThesis.underwriting_state}
                </span>
              </div>
            </div>

            <h1 className="text-base font-bold text-[#E6EDF5]">{activeThesis.title}</h1>

            <div className="text-xs font-mono text-[#738397] flex items-center space-x-4">
              <span>Entity: <strong className="text-[#E6EDF5]">{activeThesis.entity_name}</strong></span>
              <span>Lane: <strong className="text-[#A6B4C3]">{activeThesis.logistics_lane}</strong></span>
            </div>
          </div>

          {/* CRITICAL CONTRADICTION BANNER IF REFUTED */}
          {activeThesis.refutation_callout && (
            <div className="p-3 bg-[#3D1B1B]/50 border border-[#802026] rounded-sm space-y-1">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#FF6B6B] uppercase">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>EVIDENCE AUDIT CONTRADICTION &amp; UNDERWRITING ALERT</span>
              </div>
              <p className="text-xs text-[#E6EDF5] leading-relaxed">
                {activeThesis.refutation_callout}
              </p>
              <div className="text-[10px] font-mono text-[#FF6B6B] pt-0.5">
                STAGE D.0 GOVERNANCE: Capital allocation blocked pending verified batch assay.
              </div>
            </div>
          )}

          {/* CONVICTION DECOUPLING MATRIX (UIADR01-A Section 6) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-1 font-mono">
              <div className="text-[10px] text-[#738397] uppercase">1. MACRO OPPORTUNITY CONVICTION</div>
              <div className="text-xl font-bold text-[#35B88A]">
                {activeThesis.opportunity_conviction_bps.toLocaleString()} BPS
              </div>
              <div className="text-[10px] text-[#A6B4C3]">
                Market demand spread and distributor arbitrage potential.
              </div>
            </div>

            <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-1 font-mono">
              <div className="text-[10px] text-[#738397] uppercase">2. SUPPLIER CLAIM CONFIDENCE</div>
              <div
                className={`text-xl font-bold ${
                  activeThesis.supplier_confidence_bps === 0 ? 'text-[#FF6B6B]' : 'text-[#E5AC55]'
                }`}
              >
                {activeThesis.supplier_confidence_bps === 0
                  ? '0 BPS (REFUTED)'
                  : `${activeThesis.supplier_confidence_bps.toLocaleString()} BPS`}
              </div>
              <div className="text-[10px] text-[#A6B4C3]">
                {activeThesis.supplier_confidence_bps === 0
                  ? 'Task 4 Spectrometry failed (SS201 alloy detected).'
                  : 'Pending secondary supplier quote verification.'}
              </div>
            </div>

            <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-1 font-mono">
              <div className="text-[10px] text-[#738397] uppercase">3. NET UNDERWRITING DECISION</div>
              <div
                className={`text-xl font-bold ${
                  activeThesis.underwriting_state === 'QUARANTINED_PENDING_AUDIT'
                    ? 'text-[#FF6B6B]'
                    : 'text-[#E5AC55]'
                }`}
              >
                {activeThesis.underwriting_state === 'QUARANTINED_PENDING_AUDIT' ? 'BLOCKED' : 'UNDER REVIEW'}
              </div>
              <div className="text-[10px] text-[#A6B4C3]">
                Refuted supplier claim blocks capital authorization.
              </div>
            </div>
          </div>

          {/* Core Hypotheses: Bull vs Bear Falsification */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#0C1118] border border-[#263342] p-3.5 rounded-sm space-y-2">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#35B88A] uppercase">
                <TrendingUp className="w-4 h-4" />
                <span>BULL ARBITRAGE HYPOTHESIS</span>
              </div>
              <p className="text-xs text-[#A6B4C3] leading-relaxed">
                {activeThesis.bull_hypothesis}
              </p>
            </div>

            <div className="bg-[#0C1118] border border-[#263342] p-3.5 rounded-sm space-y-2">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#FF6B6B] uppercase">
                <AlertTriangle className="w-4 h-4" />
                <span>BEAR FALSIFICATION &amp; RISK BOUNDS</span>
              </div>
              <p className="text-xs text-[#A6B4C3] leading-relaxed">
                {activeThesis.bear_falsification_risk}
              </p>
            </div>
          </div>

          {/* Grounded Evidence Ledgers: Supporting vs Contradictory */}
          <div className="space-y-3">
            <h2 className="text-xs font-mono font-bold text-[#738397] uppercase">
              GROUNDED EVIDENCE AUDIT TRAIL
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Supporting Evidence */}
              <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[#35B88A] font-bold">
                  <span className="flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>SUPPORTING EVIDENCE ({activeThesis.supporting_evidence.length})</span>
                  </span>
                  <span className="text-[10px] text-[#738397]">CLASSIFIED</span>
                </div>

                <div className="space-y-2">
                  {activeThesis.supporting_evidence.map((ev, i) => (
                    <div key={i} className="p-2.5 rounded bg-[#111923] border border-[#263342] text-xs space-y-1">
                      <div className="flex justify-between text-[10px] font-mono text-[#5794D6]">
                        <span>{ev.source}</span>
                        <span className="text-[#E5AC55]">{ev.verification_type}</span>
                      </div>
                      <div className="text-[#E6EDF5] text-[11px] leading-relaxed">{ev.fact}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contradictory Evidence */}
              <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-[#FF6B6B] font-bold">
                  <span className="flex items-center space-x-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>CONTRADICTIONS &amp; AUDIT AUDITS ({activeThesis.contradictory_evidence.length})</span>
                  </span>
                  <span className="text-[10px] text-[#FF6B6B]">PRIMARY AUDITED</span>
                </div>

                <div className="space-y-2">
                  {activeThesis.contradictory_evidence.map((ev, i) => (
                    <div key={i} className="p-2.5 rounded bg-[#3D1B1B]/30 border border-[#802026] text-xs space-y-1">
                      <div className="text-[10px] font-mono text-[#FF6B6B] font-bold">
                        {ev.source}
                      </div>
                      <div className="text-[#E6EDF5] text-[11px] leading-relaxed">{ev.fact}</div>
                      <div className="text-[10px] text-[#A6B4C3] italic bg-[#080B10] p-1.5 rounded border border-[#263342]">
                        {ev.audit_notes}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Cross-Navigation Action Ribbon */}
          <div className="p-4 bg-[#111923] border border-[#263342] rounded-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-xs font-mono text-[#A6B4C3]">
              <span>CONNECTED CAPABILITIES:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onNavigateToAtlas?.(activeThesis.atlas_node_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-[#5794D6]" />
                <span>Locate Hub on Atlas</span>
              </button>

              <button
                onClick={() => onNavigateToDiscovery?.(activeThesis.candidate_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-[#5794D6]" />
                <span>Inspect in Discovery</span>
              </button>

              <button
                onClick={() => onNavigateToEntity?.(activeThesis.entity_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Building2 className="w-3.5 h-3.5 text-[#E5AC55]" />
                <span>Entity Dossier</span>
              </button>

              <button
                onClick={() => onNavigateToInvestigation?.(activeThesis.candidate_id)}
                className="px-3 py-1.5 rounded bg-[#1B3D2F] hover:bg-[#2D664E] border border-[#2D664E] text-[#35B88A] text-xs font-mono font-bold flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Launch Bounded Investigation (D.0)</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
