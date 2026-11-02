import React, { useState, useEffect } from 'react';
import {
  Building2,
  ShieldCheck,
  AlertTriangle,
  Compass,
  Search,
  FileText,
  Cpu,
  MapPin,
  ExternalLink,
  Clock,
  Layers,
  ChevronRight,
  Info,
  ShieldAlert
} from 'lucide-react';
import { WorkspaceRouteId } from './shell/NavigationRail';

export interface EntityDossier {
  entity_id: string;
  atlas_node_id: string;
  candidate_id: string;
  thesis_id: string;
  legal_name: string;
  trade_names: string[];
  corporate_cin: string | null;
  corporate_cin_status: 'SYNTHETIC_DEMO_FIXTURE' | 'REGISTRY_CORROBORATED' | 'DATA_REQUIRED';
  gstin: string | null;
  gstin_status: 'SYNTHETIC_DEMO_FIXTURE' | 'REGISTRY_CORROBORATED' | 'DATA_REQUIRED';
  statutory_status: string;
  incorporation_year: number | null;
  registered_office: string;
  registered_office_status: 'SYNTHETIC_DEMO_CLAIM' | 'REGISTRY_VERIFIED' | 'UNVERIFIED_CLAIM';
  physical_facility_address: string;
  physical_facility_status: 'ESTATE_CENTROID_REFERENCE' | 'UNVERIFIED_CLAIM' | 'DATA_REQUIRED';
  facility_type: string;
  lat: number | null;
  lon: number | null;
  is_unlocated_digital: boolean;
  geographic_precision: string;
  coordinate_provenance: string;
  epistemic_status: 'VERIFIED' | 'CORROBORATED' | 'FIXTURE' | 'DATA_REQUIRED' | 'CONTRADICTED';
  underwriting_state: 'QUARANTINED_PENDING_AUDIT' | 'UNDER_REVIEW' | 'VERIFIED_ROBUST' | 'DATA_REQUIRED';
  directors: string[];
  products: string[];
  logistics_lane: string;
  primary_port: string;
  bitemporal_records: {
    date: string;
    filing_type: string;
    details: string;
    epistemic_class: string;
  }[];
  contradiction_or_audit_notes?: string;
}

export const ENTITY_DOSSIERS_DATA: EntityDossier[] = [
  {
    entity_id: 'GEO-HOWRAH-BALTIKURI-01',
    atlas_node_id: 'GEO-HOWRAH-BALTIKURI-01',
    candidate_id: 'OPP-E6B40775E03ECE44',
    thesis_id: 'THESIS-SS304-HOWRAH-01',
    legal_name: 'Modern Metal Works Private Limited',
    trade_names: ['Apex Precision Fasteners', 'Modern Clamps Bengal'],
    corporate_cin: 'U28991WB2014PTC201882',
    corporate_cin_status: 'SYNTHETIC_DEMO_FIXTURE',
    gstin: '19AAACM1234F1Z5',
    gstin_status: 'SYNTHETIC_DEMO_FIXTURE',
    statutory_status: 'Unverified Demo Fixture (Format Valid Only, Not Registry Looked Up)',
    incorporation_year: 2014,
    registered_office: '42 B.T. Road, Shyambazar, Kolkata, WB 700002 (Synthetic Demo Claim)',
    registered_office_status: 'SYNTHETIC_DEMO_CLAIM',
    physical_facility_address: 'Plot 18, Baltikuri Industrial Belt, Howrah, WB 711113 (Synthetic Demo Claim; Estate Centroid Used)',
    physical_facility_status: 'ESTATE_CENTROID_REFERENCE',
    facility_type: 'Worm-Drive Clamp Stamping & Annealing Foundry (Demo Reference)',
    lat: 22.5958,
    lon: 88.2636,
    is_unlocated_digital: false,
    geographic_precision: 'INDUSTRIAL_ESTATE_CENTROID (Estate Centroid ±1,500m; Not Verified Factory Gate)',
    coordinate_provenance: 'Survey of India / OpenStreetMap Baltikuri Junction Centroid (Estate Level ±1,500m; Not Verified Factory Gate)',
    epistemic_status: 'CONTRADICTED',
    underwriting_state: 'QUARANTINED_PENDING_AUDIT',
    directors: ['Sunil K. Banerjee (Synthetic Demo DIN)', 'Pradeep Roy (Synthetic Demo DIN)'],
    products: [
      'DIN 3017 W4 Stainless Steel Hose Clamps',
      'Heavy-Duty Perforated Banding',
      'Galvanized Carbon Steel Fasteners'
    ],
    logistics_lane: 'NH16 Golden Quadrilateral / Kona Expressway (~14 km Road Est.)',
    primary_port: 'Syama Prasad Mookerjee Port, Kolkata (~14 km Road Est.)',
    bitemporal_records: [
      {
        date: '2014-03-12',
        filing_type: 'DEMO_INCORPORATION',
        details: 'Synthetic ROC claim: U28991WB2014PTC201882 (Unverified via MCA21 API).',
        epistemic_class: 'DEMO_FIXTURE'
      },
      {
        date: '2017-07-01',
        filing_type: 'DEMO_GST_CLAIM',
        details: 'Format-valid GSTIN 19AAACM1234F1Z5 (Unverified against GSTN portal).',
        epistemic_class: 'DEMO_FIXTURE'
      },
      {
        date: '2024-10-24',
        filing_type: 'GOLDEN_FIXTURE_INGEST',
        details: 'Attributable fixture FIX-AMZ-SS304-001 ingested into living product deck.',
        epistemic_class: 'DEMO_FIXTURE'
      },
      {
        date: '2026-10-31',
        filing_type: 'AUDIT_REFUTATION_LOG',
        details: 'Stage C.3.4 Adaptive Spectrometry Audit (Task 4) detected SS201 alloy (7.2% Mn). Batch quarantined.',
        epistemic_class: 'PRIMARY_OBSERVATION'
      }
    ],
    contradiction_or_audit_notes:
      'CRITICAL AUDIT REFUTATION: Task 4 ICP-OES spectrometry test flagged 7.2% Mn and 1.2% Ni (SS201 alloy) on unbranded market samples vs claimed SS304. Sourcing quote cannot be underwritten until direct vendor batch audit succeeds.'
  },
  {
    entity_id: 'GEO-JAMNAGAR-GIDC-02',
    atlas_node_id: 'GEO-JAMNAGAR-GIDC-02',
    candidate_id: 'OPP-4C9B52BBEB89D4E2',
    thesis_id: 'THESIS-VALVE-JAMNAGAR-01',
    legal_name: 'Omkar Brass Industries',
    trade_names: ['Omkar Precision Brass', 'Dared Forgings'],
    corporate_cin: 'U27209GJ2016PTC091124',
    corporate_cin_status: 'SYNTHETIC_DEMO_FIXTURE',
    gstin: '24AAAFO1234F1Z8',
    gstin_status: 'SYNTHETIC_DEMO_FIXTURE',
    statutory_status: 'Unverified Demo Fixture (Format Valid Only, Not Registry Looked Up)',
    incorporation_year: 2016,
    registered_office: 'Shed 412, GIDC Phase-II, Dared, Jamnagar, GJ 361004 (Synthetic Demo Claim)',
    registered_office_status: 'SYNTHETIC_DEMO_CLAIM',
    physical_facility_address: 'Plot 412-414, GIDC Phase-II, Dared, Jamnagar, GJ 361004 (Synthetic Demo Claim; Estate Centroid Used)',
    physical_facility_status: 'ESTATE_CENTROID_REFERENCE',
    facility_type: 'Brass Extrusion, CNC Turning & Hydrostatic Testing Plant (Demo Reference)',
    lat: 22.4707,
    lon: 70.0577,
    is_unlocated_digital: false,
    geographic_precision: 'INDUSTRIAL_ESTATE_CENTROID (Estate Centroid ±2,000m; Not Verified Gate)',
    coordinate_provenance: 'OpenStreetMap GIDC Phase-II Dared Centroid (Estate Level ±2,000m; Not Verified Plant Gate)',
    epistemic_status: 'CORROBORATED',
    underwriting_state: 'UNDER_REVIEW',
    directors: ['Rajesh V. Patel (Proprietor / Demo Authorized)'],
    products: [
      'Forged Brass Ball Valves (1/2" PN20 IS 9890)',
      'Male/Female Brass Hose Nipples',
      'Pneumatic Quick-Connect Couplings'
    ],
    logistics_lane: 'SH26 Jamnagar-Rajkot Highway / Kandla Port Corridor (~115 km Road Est.)',
    primary_port: 'Deendayal Port (Kandla), Gujarat (~115 km Road Est.)',
    bitemporal_records: [
      {
        date: '2016-04-18',
        filing_type: 'DEMO_MSME_CLAIM',
        details: 'Demo registration claim under Gujarat District Industries Centre.',
        epistemic_class: 'DEMO_FIXTURE'
      },
      {
        date: '2026-10-31',
        filing_type: 'SUPPLIER_QUOTE_AUDIT',
        details: 'Confirmed ₹115/unit quote on 500-unit lot fixture with PTFE seal claim.',
        epistemic_class: 'DEMO_FIXTURE'
      }
    ],
    contradiction_or_audit_notes:
      'AUDIT REQUIREMENT: Independent second supplier quote required to rule out local GIDC Phase-II brass cartel pricing markups.'
  },
  {
    entity_id: 'GEO-HARIDWAR-SIDCUL-03',
    atlas_node_id: 'GEO-HARIDWAR-SIDCUL-03',
    candidate_id: 'OPP-MCB-HARIDWAR-003',
    thesis_id: 'THESIS-MCB-HARIDWAR-01',
    legal_name: 'Havells India Limited (Haridwar Switchgear Reference)',
    trade_names: ['Havells Switchgear', 'Crabtree India'],
    corporate_cin: 'L31900DL1983PLC016304',
    corporate_cin_status: 'REGISTRY_CORROBORATED',
    gstin: '05AAACH1234H1Z2',
    gstin_status: 'SYNTHETIC_DEMO_FIXTURE',
    statutory_status: 'BSE/NSE Public Listing Corroborated (Haridwar Plant Gate Unverified)',
    incorporation_year: 1983,
    registered_office: '904, Surya Kiran Building, K.G. Marg, New Delhi 110001 (Corroborated Domicile)',
    registered_office_status: 'REGISTRY_VERIFIED',
    physical_facility_address: 'Plot 2 & 3, Sector 10, IIE SIDCUL, Haridwar, UK 249403 (Corporate Plant Reference; Centroid Used)',
    physical_facility_status: 'ESTATE_CENTROID_REFERENCE',
    facility_type: 'Automated Switchgear & Breaker Assembly Foundry (Corporate Subsidiary)',
    lat: 29.9457,
    lon: 78.0772,
    is_unlocated_digital: false,
    geographic_precision: 'INDUSTRIAL_ESTATE_CENTROID (Industrial Park Level ±3,000m)',
    coordinate_provenance: 'Survey of India IIE SIDCUL Haridwar Centroid (Industrial Park Level ±3,000m)',
    epistemic_status: 'OBSERVED',
    underwriting_state: 'UNDER_REVIEW',
    directors: ['Anil Rai Gupta (Chairman & MD)', 'Rajesh Kumar Gupta (Director - Finance)'],
    products: [
      'Havells 16A Single Pole C-Curve MCB (10kA IS/IEC 60898-1)',
      'Distribution Boards',
      'RCCBs & Isolators'
    ],
    logistics_lane: 'NH334 / Western Dedicated Freight Corridor',
    primary_port: 'ICD Pantnagar / ICD Moradabad (~140 km)',
    bitemporal_records: [
      {
        date: '1983-08-08',
        filing_type: 'CORPORATE_INCORPORATION',
        details: 'Listed entity public disclosure on Bombay Stock Exchange.',
        epistemic_class: 'HISTORICAL_CACHE'
      }
    ]
  },
  {
    entity_id: 'GEO-SAAS-SYNAPSE-10',
    atlas_node_id: 'GEO-SAAS-SYNAPSE-10',
    candidate_id: 'OPP-65038D38DF8D8B67',
    thesis_id: 'THESIS-DEVTOOL-SAAS-01',
    legal_name: 'Synapse Distributed Tracing Ltd',
    trade_names: ['Synapse eBPF', 'Synapse Cloud Trace'],
    corporate_cin: 'Delaware File No: 7894120',
    corporate_cin_status: 'SYNTHETIC_DEMO_FIXTURE',
    gstin: null,
    gstin_status: 'DATA_REQUIRED',
    statutory_status: 'Unverified Demo Fixture (Delaware Good Standing Claim Unchecked via API)',
    incorporation_year: 2023,
    registered_office: '1209 North Orange Street, Wilmington, DE 19801 (Corporation Trust Center Statutory Agent)',
    registered_office_status: 'SYNTHETIC_DEMO_CLAIM',
    physical_facility_address: '[DATA REQUIRED] — Digital SaaS Asset (Zero Physical Factory Gate Exists)',
    physical_facility_status: 'DATA_REQUIRED',
    facility_type: 'Cloud Software & Developer API Provider',
    lat: null,
    lon: null,
    is_unlocated_digital: true,
    geographic_precision: 'DATA_REQUIRED (Unlocated Cloud Digital Asset)',
    coordinate_provenance: 'Coordinates Intentionally Omitted [DATA REQUIRED]: Cloud software distributed via Anycast/CDN edge with zero physical foundry gate.',
    epistemic_status: 'DATA_REQUIRED',
    underwriting_state: 'DATA_REQUIRED',
    directors: ['Marcus Vance (Founder & CEO - Demo Claim)'],
    products: [
      'Low-Latency eBPF Distributed Tracing Agent (Team Tier)',
      'Kernel-Level Packet Inspection Collector',
      'OpenTelemetry Exporter Suite'
    ],
    logistics_lane: 'Global Multi-Region Anycast / BGP Network',
    primary_port: 'AWS us-east-1 / Cloudflare Edge [DATA REQUIRED]',
    bitemporal_records: [
      {
        date: '2023-02-14',
        filing_type: 'DEMO_DELAWARE_INCORPORATION',
        details: 'Division of Corporations File 7894120 claim in demo fixture.',
        epistemic_class: 'DEMO_FIXTURE'
      },
      {
        date: '2026-10-31',
        filing_type: 'FACILITY_AUDIT',
        details: 'Audit confirms zero physical foundry gate. Coordinates truthfully marked [DATA REQUIRED].',
        epistemic_class: 'PRIMARY_OBSERVATION'
      }
    ],
    contradiction_or_audit_notes:
      'Cloud hosting COGS invoices unverified. Gross margin calculation blocked until audited AWS/GCP bills are ingested.'
  }
];

export interface EntityIntelligenceProps {
  selectedEntityId?: string | null;
  onSelectEntity?: (entityId: string) => void;
  onNavigateToAtlas?: (nodeId: string) => void;
  onNavigateToDiscovery?: (candidateId: string) => void;
  onNavigateToThesis?: (thesisId: string) => void;
  onNavigateToInvestigation?: (candidateId: string) => void;
}

export const EntityIntelligence: React.FC<EntityIntelligenceProps> = ({
  selectedEntityId,
  onSelectEntity,
  onNavigateToAtlas,
  onNavigateToDiscovery,
  onNavigateToThesis,
  onNavigateToInvestigation
}) => {
  const [activeEntityId, setActiveEntityId] = useState<string>(
    selectedEntityId || 'GEO-HOWRAH-BALTIKURI-01'
  );

  useEffect(() => {
    if (selectedEntityId) {
      setActiveEntityId(selectedEntityId);
    }
  }, [selectedEntityId]);

  const activeEntity =
    ENTITY_DOSSIERS_DATA.find((e) => e.entity_id === activeEntityId) || ENTITY_DOSSIERS_DATA[0];

  const handleSelect = (id: string) => {
    setActiveEntityId(id);
    onSelectEntity?.(id);
  };

  return (
    <div className="h-full flex flex-col bg-[#080B10] text-[#E6EDF5] overflow-hidden select-none font-sans">
      {/* 1. Header Ribbon */}
      <div className="h-10 bg-[#0C1118] border-b border-[#263342] px-3 flex items-center justify-between shrink-0 text-xs font-mono">
        <div className="flex items-center space-x-2">
          <Building2 className="w-3.5 h-3.5 text-[#5794D6]" />
          <span className="font-bold text-[#E6EDF5] uppercase tracking-wide">
            ENTITY &amp; STATUTORY INTELLIGENCE DOSSIERS
          </span>
          <span className="text-[#263342]">|</span>
          <span className="text-[#A6B4C3] hidden md:inline">
            CORPORATE STANDING, PHYSICAL FACILITY DISTINCTION &amp; PROVENANCE AUDIT
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="badge-epistemic badge-verified">
            {ENTITY_DOSSIERS_DATA.length} AUDITED ENTITY DOSSIERS
          </span>
        </div>
      </div>

      {/* 2. Main Dual-Pane Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Entity List */}
        <aside className="w-80 bg-[#0C1118] border-r border-[#263342] flex flex-col shrink-0">
          <div className="p-2.5 bg-[#111923] border-b border-[#263342] flex items-center justify-between text-[11px] font-mono text-[#738397]">
            <span>AUDITED ENTITIES</span>
            <span>EPISTEMIC STATE</span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#263342]/40">
            {ENTITY_DOSSIERS_DATA.map((entity) => {
              const isSelected = entity.entity_id === activeEntity.entity_id;
              const isContradicted = entity.epistemic_status === 'CONTRADICTED';
              return (
                <div
                  key={entity.entity_id}
                  onClick={() => handleSelect(entity.entity_id)}
                  className={`p-3 transition-colors cursor-pointer space-y-1.5 ${
                    isSelected
                      ? 'bg-[#172230] border-l-2 border-[#5794D6]'
                      : 'hover:bg-[#111923] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-[#E6EDF5] truncate pr-2">
                      {entity.legal_name}
                    </span>
                    <span
                      className={`text-[8px] font-mono px-1.5 py-0.5 rounded font-bold shrink-0 uppercase ${
                        isContradicted
                          ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                          : entity.epistemic_status === 'CORROBORATED'
                          ? 'bg-[#172E3D] text-[#4EB3D3] border border-[#234E6B]'
                          : entity.epistemic_status === 'DATA_REQUIRED'
                          ? 'bg-[#3D2512] text-[#F08C42] border border-[#6E3F1D]'
                          : 'bg-[#111923] text-[#A6B4C3] border border-[#263342]'
                      }`}
                    >
                      {isContradicted ? 'AUDIT REFUTED' : entity.epistemic_status}
                    </span>
                  </div>

                  <div className="text-[11px] text-[#A6B4C3] font-mono">
                    {entity.corporate_cin || 'Non-Corporate Entity'}
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-mono text-[#738397]">
                    <span>{entity.is_unlocated_digital ? 'Cloud Digital' : entity.facility_type.split(' ')[0]}</span>
                    <span className="text-[#E5AC55]">{entity.corporate_cin_status}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Right: Detailed Entity Inspector */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#080B10]">
          {/* Header Card */}
          <div className="bg-[#111923] border border-[#263342] p-4 rounded-sm space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-mono font-bold text-[#5794D6]">
                  {activeEntity.entity_id}
                </span>
                <span className="text-[#263342]">/</span>
                <span className="text-xs font-mono text-[#A6B4C3]">{activeEntity.statutory_status}</span>
              </div>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                  activeEntity.epistemic_status === 'CONTRADICTED'
                    ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                    : activeEntity.epistemic_status === 'CORROBORATED'
                    ? 'bg-[#172E3D] text-[#4EB3D3] border border-[#234E6B]'
                    : 'bg-[#3D2512] text-[#F08C42] border border-[#6E3F1D]'
                }`}
              >
                {activeEntity.epistemic_status === 'CONTRADICTED' ? 'AUDIT REFUTED CLAIM' : activeEntity.epistemic_status}
              </span>
            </div>

            <h1 className="text-base font-bold text-[#E6EDF5]">{activeEntity.legal_name}</h1>
            <div className="text-xs text-[#A6B4C3] font-mono">
              Trade Names: {activeEntity.trade_names.join(', ')}
            </div>
          </div>

          {/* CRITICAL CONTRADICTION BANNER IF REFUTED */}
          {activeEntity.contradiction_or_audit_notes && (
            <div className="p-3 bg-[#3D1B1B]/50 border border-[#802026] rounded-sm space-y-1">
              <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#FF6B6B] uppercase">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>PRIMARY EVIDENCE AUDIT CONTRADICTION</span>
              </div>
              <p className="text-xs text-[#E6EDF5] leading-relaxed">
                {activeEntity.contradiction_or_audit_notes}
              </p>
              <div className="text-[10px] font-mono text-[#FF6B6B]">
                UNDERWRITING DECISION: Material quote quarantined; physical facility gate unverified.
              </div>
            </div>
          )}

          {/* CRITICAL DISTINCTION: Legal Corporate Office vs Physical Manufacturing Facility */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Legal / Corporate Office */}
            <div className="bg-[#0C1118] border border-[#263342] p-3.5 rounded-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#5794D6] uppercase">
                  <Building2 className="w-4 h-4" />
                  <span>LEGAL CORPORATE HEADQUARTERS</span>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#111923] text-[#E5AC55] border border-[#263342]">
                  {activeEntity.registered_office_status}
                </span>
              </div>
              <div className="text-xs text-[#A6B4C3] leading-relaxed">
                {activeEntity.registered_office}
              </div>
              <div className="bg-[#111923] p-2 rounded text-[10px] font-mono space-y-1">
                <div>CIN / REG: <strong className="text-[#E6EDF5]">{activeEntity.corporate_cin || '[N/A]'}</strong> ({activeEntity.corporate_cin_status})</div>
                <div>GSTIN: <strong className="text-[#E6EDF5]">{activeEntity.gstin || '[DATA REQUIRED]'}</strong> ({activeEntity.gstin_status})</div>
                <div>Incorporation Year: <strong className="text-[#E6EDF5]">{activeEntity.incorporation_year || '[N/A]'}</strong></div>
              </div>
            </div>

            {/* Physical Manufacturing Facility */}
            <div className="bg-[#0C1118] border border-[#263342] p-3.5 rounded-sm space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs font-mono font-bold text-[#35B88A] uppercase">
                  <MapPin className="w-4 h-4" />
                  <span>PHYSICAL MANUFACTURING FACILITY</span>
                </div>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#111923] text-[#4EB3D3] border border-[#263342]">
                  {activeEntity.physical_facility_status}
                </span>
              </div>
              <div className="text-xs text-[#A6B4C3] leading-relaxed">
                {activeEntity.physical_facility_address}
              </div>
              <div className="bg-[#111923] p-2 rounded text-[10px] font-mono space-y-1">
                <div>Facility Type: <strong className="text-[#E6EDF5]">{activeEntity.facility_type}</strong></div>
                <div>
                  Geographic Precision:{' '}
                  <strong className={activeEntity.lat !== null ? 'text-[#4EB3D3]' : 'text-[#F08C42]'}>
                    {activeEntity.geographic_precision}
                  </strong>
                </div>
                <div>Logistics Corridor: <strong className="text-[#A6B4C3]">{activeEntity.logistics_lane}</strong></div>
              </div>
            </div>
          </div>

          {/* Unlocated Digital Asset Explicit Notice */}
          {activeEntity.is_unlocated_digital && (
            <div className="p-3 bg-[#3D2512]/60 border border-[#6E3F1D] rounded text-xs font-mono space-y-1">
              <div className="text-[#F08C42] font-bold flex items-center space-x-1.5">
                <Info className="w-4 h-4 shrink-0" />
                <span>DIGITAL / CLOUD ASSET NOTICE: UNLOCATED FACILITY</span>
              </div>
              <p className="text-[#A6B4C3] text-[11px] leading-relaxed">
                Per Section 5 of UIADR01, coordinates must NEVER be fabricated for cloud software or unverified leads.
                SaaS distribution operates over multi-region cloud networks; zero physical foundry gate exists.
              </p>
            </div>
          )}

          {/* Directorship & Key Personnel */}
          <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-2">
            <div className="text-xs font-mono font-bold text-[#738397] uppercase">
              REGISTERED DIRECTORS &amp; AUTHORIZED SIGNATORIES (DEMO AUDIT)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {activeEntity.directors.map((dir, i) => (
                <div key={i} className="p-2 rounded bg-[#111923] border border-[#263342] text-xs font-mono text-[#E6EDF5]">
                  {dir}
                </div>
              ))}
            </div>
          </div>

          {/* Bitemporal Statutory Filing Audit */}
          <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-2">
            <div className="flex items-center justify-between text-xs font-mono font-bold text-[#738397] uppercase">
              <span>BITEMPORAL STATUTORY HISTORY ({activeEntity.bitemporal_records.length})</span>
              <span>PROVENANCE AUDIT TRAIL</span>
            </div>

            <div className="space-y-1.5">
              {activeEntity.bitemporal_records.map((rec, i) => (
                <div key={i} className="p-2 rounded bg-[#111923] border border-[#263342] text-xs space-y-0.5">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-[#5794D6] font-bold">{rec.date}</span>
                    <span className="text-[#E5AC55]">{rec.epistemic_class}</span>
                  </div>
                  <div className="text-[#E6EDF5] text-[11px]">{rec.details}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Cross-Navigation Action Ribbon */}
          <div className="p-4 bg-[#111923] border border-[#263342] rounded-sm flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2 text-xs font-mono text-[#A6B4C3]">
              <span>CONNECTED WORKSPACES:</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onNavigateToAtlas?.(activeEntity.atlas_node_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Compass className="w-3.5 h-3.5 text-[#5794D6]" />
                <span>Locate on Atlas</span>
              </button>

              <button
                onClick={() => onNavigateToDiscovery?.(activeEntity.candidate_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Search className="w-3.5 h-3.5 text-[#5794D6]" />
                <span>View Candidate</span>
              </button>

              <button
                onClick={() => onNavigateToThesis?.(activeEntity.thesis_id)}
                className="px-3 py-1.5 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <FileText className="w-3.5 h-3.5 text-[#35B88A]" />
                <span>View Thesis</span>
              </button>

              <button
                onClick={() => onNavigateToInvestigation?.(activeEntity.candidate_id)}
                className="px-3 py-1.5 rounded bg-[#1B3D2F] hover:bg-[#2D664E] border border-[#2D664E] text-[#35B88A] text-xs font-mono font-bold flex items-center space-x-1.5 cursor-pointer transition-colors"
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Run Investigation (D.0)</span>
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};
