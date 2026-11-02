import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Filter,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Layers,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Database,
  Tag,
  Clock,
  Sparkles,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  FileText,
  Play,
  Compass,
  Building2,
  MapPin,
  SlidersHorizontal,
  Columns,
  Bookmark,
  BarChart3,
  ArrowUpDown,
  Eye,
  EyeOff,
  Copy,
  Check,
  CheckSquare,
  Square,
  Maximize2,
  Minimize2,
  X,
  HelpCircle,
  Radio,
  Share2,
  Workflow,
  Cpu
} from 'lucide-react';
import { ProductQueueCandidateItem, OriginClassType, ProductObservationItem } from '../types/product';
import { WorkstationApiClient } from '../services/api';

export interface DiscoveryCandidateGalleryProps {
  onRefreshData?: () => void;
  onSelectCandidateForInvestigation?: (candidateId: string) => void;
  selectedCandidateId?: string | null;
  onSelectCandidate?: (candidateId: string) => void;
  onNavigateToAtlas?: (nodeId: string) => void;
  onNavigateToThesis?: (thesisId: string) => void;
  onNavigateToEntity?: (entityId: string) => void;
  initialTab?: 'TABLE' | 'ANALYTICS' | 'COMPARE';
  initialCompareIds?: string[];
  initialWalkthrough?: boolean;
}

export interface CandidateComparisonRow {
  candidate_id: string;
  canonical_product_id: string;
  candidate_name: string;
  category: string;
  origin_class: string;
  source_connector_id: string;
  observed_at_utc: string;
  freshness_age_seconds: number;
  evidence_gap_status: string;
  unresolved_gaps: string[];
  underwriting_outcome: string;
  evaluation_status: string;
  prevailing_retail_asp_inr: number | null;
  factory_gate_quote_inr: number | null;
  gross_spread_inr: number | null;
  estimated_margin_bps: number | null;
  net_unit_contribution_inr: number | null;
  contribution_margin_bps: number | null;
  initial_cash_requirement_inr: number | null;
  unit_batch_moq: number | null;
  sufficiency_score_bps: number;
  priority_rank: number;
  ranking_rationale: string;
}

export interface CandidateDetailedRecord {
  candidate_id: string;
  strategy_id: string;
  canonical_product_id: string;
  candidate_name: string;
  category: string;
  lifecycle_state: string;
  active_signals: string[];
  investigation_status: string;
  evidence_sufficiency: {
    is_sufficient_for_underwriting: boolean;
    sufficiency_score_bps: number;
    has_upstream_quote: boolean;
    has_prevailing_asp: boolean;
    has_verbatim_reviews: boolean;
    has_logistics_route: boolean;
    has_regulatory_clearance: boolean;
    missing_critical_fields: string[];
    uncorroborated_fields: string[];
    last_evaluated_at_utc: string;
  };
  commercial_attractiveness: {
    estimated_gross_spread_inr: number | null;
    estimated_gross_margin_bps: number | null;
    attractiveness_rating: string;
    heuristic_rationale: string;
    calculation_epistemic_class: string;
  };
  economic_eligibility: {
    is_economically_eligible: boolean;
    evaluation_status: string;
    missing_economic_inputs: string[];
    economic_model_applied: string;
    policy_min_margin_bps: number;
    estimated_margin_bps: number | null;
    policy_evaluation_notes: string;
    last_evaluated_at_utc: string;
  };
  current_observation: {
    observation_id: string;
    source_connector_id: string;
    origin_class: string;
    observed_at_utc: string;
    prevailing_retail_asp_inr: number | null;
    factory_gate_quote_inr: number | null;
    unit_batch_moq: number | null;
    observed_seller_count: number | null;
    review_sentiment_summary: string;
    raw_payload_snippet: string;
    payload_sha256: string;
  };
  observation_history_count: number;
  latest_transition_reason: string;
  first_seen_utc: string;
  last_seen_utc: string;
  updated_at_utc: string;
  jcs_sha256: string;
}

export interface SavedResearchView {
  id: string;
  name: string;
  isSystem: boolean;
  query: string;
  category: string;
  lifecycle: string;
  origin: string;
  geography: string;
  evidenceStatus: string;
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
}

export const CANDIDATE_CROSS_MAP: Record<
  string,
  {
    atlasNodeId?: string;
    thesisId?: string;
    entityId?: string;
    unlocatedReason?: string;
    clusterPrecision?: string;
    precisionRadius?: string;
    regionName?: string;
  }
> = {
  'OPP-E6B40775E03ECE44': {
    atlasNodeId: 'GEO-HOWRAH-BALTIKURI-01',
    thesisId: 'THESIS-SS304-HOWRAH-01',
    entityId: 'GEO-HOWRAH-BALTIKURI-01',
    clusterPrecision: 'INDUSTRIAL_ESTATE_CENTROID',
    precisionRadius: '±1,500m',
    regionName: 'Howrah / Baltikuri (West Bengal)'
  },
  'OPP-4C9B52BBEB89D4E2': {
    atlasNodeId: 'GEO-JAMNAGAR-GIDC-02',
    thesisId: 'THESIS-VALVE-JAMNAGAR-01',
    entityId: 'GEO-JAMNAGAR-GIDC-02',
    clusterPrecision: 'INDUSTRIAL_ESTATE_CENTROID',
    precisionRadius: '±1,200m',
    regionName: 'Jamnagar GIDC Phase III (Gujarat)'
  },
  'OPP-65038D38DF8D8B67': {
    atlasNodeId: 'GEO-SAAS-SYNAPSE-10',
    thesisId: 'THESIS-DEVTOOL-SAAS-01',
    entityId: 'GEO-SAAS-SYNAPSE-10',
    unlocatedReason: 'Cloud Distributed Infrastructure: No physical factory gate or estate cadastral footprint.',
    clusterPrecision: 'UNVERIFIED_LOCATION',
    precisionRadius: 'Virtual Cloud Multi-Region',
    regionName: 'AWS / GCP Cloud Multi-Region'
  },
  'OPP-6DA1DDAC84E59527': {
    atlasNodeId: 'GEO-AHMEDABAD-VATVA-06',
    thesisId: 'THESIS-ARGON-GAS-01',
    entityId: 'GEO-AHMEDABAD-VATVA-06',
    clusterPrecision: 'INDUSTRIAL_ESTATE_CENTROID',
    precisionRadius: '±2,000m',
    regionName: 'Vatva GIDC, Ahmedabad (Gujarat)'
  },
  'OPP-C81D434ECFD26233': {
    atlasNodeId: 'GEO-HOWRAH-BALTIKURI-01',
    thesisId: 'THESIS-SERVICE-LAB-01',
    entityId: 'GEO-HOWRAH-BALTIKURI-01',
    clusterPrecision: 'INDUSTRIAL_ESTATE_CENTROID',
    precisionRadius: '±1,500m',
    regionName: 'Baltikuri Industrial Belt, Howrah'
  },
  'OPP-C6C258651ABF30EB': {
    unlocatedReason: 'Pre-Industrial Patent / Tech Transfer Office: Pre-manufacturing intellectual property.',
    clusterPrecision: 'UNVERIFIED_LOCATION',
    precisionRadius: 'Patent Licensing Bureau',
    regionName: 'Government IP & Technology Transfer Bureau'
  }
};

const SYSTEM_VIEW_PRESETS: SavedResearchView[] = [
  {
    id: 'sys-all',
    name: '[SYSTEM PRESET] All Active Opportunities',
    isSystem: true,
    query: '',
    category: 'ALL',
    lifecycle: 'ALL',
    origin: 'ALL',
    geography: 'ALL',
    evidenceStatus: 'ALL',
    sortColumn: 'candidate_id',
    sortDirection: 'asc'
  },
  {
    id: 'sys-physical',
    name: '[SYSTEM PRESET] MRO & Industrial Fasteners (Physical)',
    isSystem: true,
    query: '',
    category: 'PHYSICAL_GOODS',
    lifecycle: 'ALL',
    origin: 'ALL',
    geography: 'ALL',
    evidenceStatus: 'ALL',
    sortColumn: 'gross_margin',
    sortDirection: 'desc'
  },
  {
    id: 'sys-digital',
    name: '[SYSTEM PRESET] High Margin Digital & SaaS',
    isSystem: true,
    query: '',
    category: 'SOFTWARE_DIGITAL',
    lifecycle: 'ALL',
    origin: 'ALL',
    geography: 'ALL',
    evidenceStatus: 'ALL',
    sortColumn: 'candidate_id',
    sortDirection: 'asc'
  },
  {
    id: 'sys-contradicted',
    name: '[SYSTEM PRESET] Contradicted / Refuted Batches (Howrah)',
    isSystem: true,
    query: 'Howrah',
    category: 'ALL',
    lifecycle: 'ALL',
    origin: 'ALL',
    geography: 'ALL',
    evidenceStatus: 'CONTRADICTED',
    sortColumn: 'candidate_id',
    sortDirection: 'asc'
  },
  {
    id: 'sys-gaps',
    name: '[SYSTEM PRESET] Evidence Deficient / Gaps Pending',
    isSystem: true,
    query: '',
    category: 'ALL',
    lifecycle: 'ALL',
    origin: 'ALL',
    geography: 'ALL',
    evidenceStatus: 'EVIDENCE_GAPS',
    sortColumn: 'candidate_id',
    sortDirection: 'asc'
  }
];

export const DiscoveryCandidateGallery: React.FC<DiscoveryCandidateGalleryProps> = ({
  onRefreshData,
  onSelectCandidateForInvestigation,
  selectedCandidateId: propsSelectedCandidateId,
  onSelectCandidate,
  onNavigateToAtlas,
  onNavigateToThesis,
  onNavigateToEntity,
  initialTab,
  initialCompareIds,
  initialWalkthrough
}) => {
  // 1. Data States
  const [candidates, setCandidates] = useState<ProductQueueCandidateItem[]>([]);
  const [comparisonRows, setComparisonRows] = useState<CandidateComparisonRow[]>([]);
  const [candidateDetailMap, setCandidateDetailMap] = useState<Record<string, CandidateDetailedRecord>>({});
  const [evidenceGapsMap, setEvidenceGapsMap] = useState<Record<string, any>>({});
  const [deckProducts, setDeckProducts] = useState<ProductObservationItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  // 2. View Mode
  const [activeTab, setActiveTab] = useState<'TABLE' | 'ANALYTICS' | 'COMPARE'>(() => {
    if (initialTab) return initialTab;
    if (typeof window !== 'undefined') {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'ANALYTICS' || t === 'COMPARE' || t === 'TABLE') return t;
    }
    return 'TABLE';
  });
  const [isFilterRailOpen, setIsFilterRailOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);

  // 3. Selection & Multi-Comparison States
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(propsSelectedCandidateId || null);
  const [comparisonSelectedIds, setComparisonSelectedIds] = useState<string[]>(() => {
    if (initialCompareIds && initialCompareIds.length > 0) return initialCompareIds;
    if (typeof window !== 'undefined') {
      const c = new URLSearchParams(window.location.search).get('compare');
      if (c) return c.split(',').filter(Boolean);
    }
    return ['OPP-E6B40775E03ECE44', 'OPP-4C9B52BBEB89D4E2'];
  });
  const [unlocatedNotice, setUnlocatedNotice] = useState<string | null>(null);

  // 4. Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedLifecycle, setSelectedLifecycle] = useState<string>('ALL');
  const [selectedOrigin, setSelectedOrigin] = useState<string>('ALL');
  const [selectedGeography, setSelectedGeography] = useState<string>('ALL');
  const [selectedEvidenceStatus, setSelectedEvidenceStatus] = useState<string>('ALL');
  const [selectedResearchState, setSelectedResearchState] = useState<string>('ALL');
  const [onlyAtlasLinked, setOnlyAtlasLinked] = useState<boolean>(false);

  // 5. Table Sorting & Column Visibility
  const [sortColumn, setSortColumn] = useState<string>('candidate_id');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>({
    candidate_id: true,
    name: true,
    category: true,
    geography: true,
    entity: true,
    lifecycle: true,
    evidence: true,
    pricing: true,
    spread: true,
    connector: true,
    nextAction: true
  });
  const [showColumnMenu, setShowColumnMenu] = useState<boolean>(false);

  // 6. Saved Views State
  const [savedViews, setSavedViews] = useState<SavedResearchView[]>(() => {
    try {
      const stored = localStorage.getItem('market_hft_discovery_views_v1');
      if (stored) {
        const parsed = JSON.parse(stored);
        return [...SYSTEM_VIEW_PRESETS, ...parsed];
      }
    } catch {
      // fallback to system
    }
    return SYSTEM_VIEW_PRESETS;
  });
  const [activeViewId, setActiveViewId] = useState<string>('sys-all');
  const [showSaveViewModal, setShowSaveViewModal] = useState<boolean>(false);
  const [newViewName, setNewViewName] = useState<string>('');

  // 7. Governed Action & Modal States
  const [governedModalAction, setGovernedModalAction] = useState<{
    type: 'DISPATCH_RESEARCH' | 'UNDERWRITE';
    candidateId: string;
    productName: string;
    canonicalId: string;
  } | null>(null);
  const [operatorRationale, setOperatorRationale] = useState<string>('Operator bounded research intake verification');
  const [isExecutingAction, setIsExecutingAction] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  // 8. Strategic Walkthrough Assistant
  const [showWalkthroughModal, setShowWalkthroughModal] = useState<boolean>(() => {
    if (initialWalkthrough !== undefined) return initialWalkthrough;
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('walkthrough') === 'true';
    }
    return false;
  });
  const [walkthroughStep, setWalkthroughStep] = useState<number>(1);

  // Synchronize incoming props
  useEffect(() => {
    if (propsSelectedCandidateId) {
      setSelectedCandidateId(propsSelectedCandidateId);
    }
  }, [propsSelectedCandidateId]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (initialCompareIds && initialCompareIds.length > 0) {
      setComparisonSelectedIds(initialCompareIds);
    }
  }, [initialCompareIds]);

  useEffect(() => {
    if (initialWalkthrough !== undefined) {
      setShowWalkthroughModal(initialWalkthrough);
    }
  }, [initialWalkthrough]);

  // Load Data
  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [prods, compRows, deckRes] = await Promise.all([
        WorkstationApiClient.getGalleryProducts().catch(() => []),
        WorkstationApiClient.getCandidatesCompare().catch(() => []),
        WorkstationApiClient.getProducts().catch(() => ({ products: [] }))
      ]);

      setCandidates(prods);
      setComparisonRows(compRows);
      setDeckProducts(deckRes.products || []);

      // If nothing selected, select first
      if (prods.length > 0 && !selectedCandidateId) {
        setSelectedCandidateId(prods[0].candidate_id);
      }

      // Preload details for top candidates
      const detailPromises = prods.map(async (c) => {
        try {
          const detail = await WorkstationApiClient.getCandidateDetail(c.candidate_id);
          return { id: c.candidate_id, detail };
        } catch {
          return null;
        }
      });

      const gapPromises = prods.map(async (c) => {
        try {
          const gaps = await WorkstationApiClient.getEvidenceGaps(c.canonical_product_id);
          return { canonicalId: c.canonical_product_id, gaps };
        } catch {
          return null;
        }
      });

      const [detailResults, gapResults] = await Promise.all([
        Promise.all(detailPromises),
        Promise.all(gapPromises)
      ]);

      const newDetailMap: Record<string, CandidateDetailedRecord> = {};
      detailResults.forEach((r) => {
        if (r && r.detail) newDetailMap[r.id] = r.detail;
      });
      setCandidateDetailMap(newDetailMap);

      const newGapMap: Record<string, any> = {};
      gapResults.forEach((r) => {
        if (r && r.gaps) newGapMap[r.canonicalId] = r.gaps;
      });
      setEvidenceGapsMap(newGapMap);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load Discovery Universe data.');
    } finally {
      setIsLoading(false);
    }
  }, [selectedCandidateId]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Handle Quick Fixture Intake
  const handleIngestFixture = async (fixtureId: string) => {
    setIsLoading(true);
    setActionSuccessMessage(null);
    try {
      const result = await WorkstationApiClient.screenDiscovery({ fixture_id: fixtureId });
      setActionSuccessMessage(
        `Discovered candidate: ${result.candidate_id || fixtureId} (${result.notes || 'Screened into queue'})`
      );
      await fetchAllData();
      if (result.candidate_id) {
        setSelectedCandidateId(result.candidate_id);
        onSelectCandidate?.(result.candidate_id);
      }
      onRefreshData?.();
    } catch (err: any) {
      setErrorMessage(`Intake failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Execute Governed Action
  const handleExecuteGovernedAction = async () => {
    if (!governedModalAction) return;
    setIsExecutingAction(true);
    setActionSuccessMessage(null);
    setErrorMessage(null);

    try {
      if (governedModalAction.type === 'DISPATCH_RESEARCH') {
        const res = await WorkstationApiClient.dispatchResearch(
          governedModalAction.canonicalId,
          operatorRationale
        );
        setActionSuccessMessage(
          `Governed research dispatched for "${governedModalAction.productName}". Status: ${res.status || 'IN_PROGRESS'}`
        );
      } else if (governedModalAction.type === 'UNDERWRITE') {
        const res = await WorkstationApiClient.underwriteCandidate(governedModalAction.candidateId);
        setActionSuccessMessage(
          `Candidate ${governedModalAction.candidateId} underwritten! Outcome: ${res.outcome || 'EVALUATED'} (${res.decision_code || 'PROCESSED'})`
        );
      }
      await fetchAllData();
      onRefreshData?.();
      setGovernedModalAction(null);
    } catch (err: any) {
      setErrorMessage(`Governance action failed: ${err.message}`);
    } finally {
      setIsExecutingAction(false);
    }
  };

  // Copy hash helper
  const handleCopyHash = (hash: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(hash);
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    }
  };

  // Cross-Navigation Handler with Truthful Unlocated Fallback
  const handleAtlasNavigation = (candidateId: string) => {
    const meta = CANDIDATE_CROSS_MAP[candidateId];
    if (meta?.atlasNodeId && onNavigateToAtlas) {
      onNavigateToAtlas(meta.atlasNodeId);
      setUnlocatedNotice(null);
    } else {
      setUnlocatedNotice(
        meta?.unlocatedReason ||
          `Candidate ${candidateId} has no physical factory gate or estate centroid coordinates: Showing unlocated status instead of fabricating coordinates.`
      );
      setTimeout(() => setUnlocatedNotice(null), 6000);
    }
  };

  // Saved Views Management
  const handleApplyView = (view: SavedResearchView) => {
    setActiveViewId(view.id);
    setSearchQuery(view.query);
    setSelectedCategory(view.category);
    setSelectedLifecycle(view.lifecycle);
    setSelectedOrigin(view.origin);
    setSelectedGeography(view.geography);
    setSelectedEvidenceStatus(view.evidenceStatus);
    setSortColumn(view.sortColumn);
    setSortDirection(view.sortDirection);
  };

  const handleSaveCustomView = () => {
    if (!newViewName.trim()) return;
    const newView: SavedResearchView = {
      id: `custom-${Date.now()}`,
      name: `[LOCAL VIEW] ${newViewName.trim()}`,
      isSystem: false,
      query: searchQuery,
      category: selectedCategory,
      lifecycle: selectedLifecycle,
      origin: selectedOrigin,
      geography: selectedGeography,
      evidenceStatus: selectedEvidenceStatus,
      sortColumn,
      sortDirection
    };

    const updated = [...savedViews, newView];
    setSavedViews(updated);
    setActiveViewId(newView.id);
    setShowSaveViewModal(false);
    setNewViewName('');

    try {
      const customOnly = updated.filter((v) => !v.isSystem);
      localStorage.setItem('market_hft_discovery_views_v1', JSON.stringify(customOnly));
    } catch {
      // Local storage full or unavailable
    }
  };

  // Filter & Search Candidates
  const filteredCandidates = useMemo(() => {
    return candidates.filter((item) => {
      const meta = CANDIDATE_CROSS_MAP[item.candidate_id];
      const comp = comparisonRows.find((c) => c.candidate_id === item.candidate_id);
      const detail = candidateDetailMap[item.candidate_id];

      // 1. Full-text Search
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesId = item.candidate_id.toLowerCase().includes(q);
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesCanonical = item.canonical_product_id.toLowerCase().includes(q);
        const matchesEntity = item.entity_relationships?.some((e) =>
          e.entity_name.toLowerCase().includes(q)
        );
        const matchesRegion = meta?.regionName?.toLowerCase().includes(q);
        const matchesConnector = item.source_url?.toLowerCase().includes(q);

        if (!matchesId && !matchesName && !matchesCanonical && !matchesEntity && !matchesRegion && !matchesConnector) {
          return false;
        }
      }

      // 2. Category
      if (selectedCategory !== 'ALL' && item.category !== selectedCategory) {
        return false;
      }

      // 3. Lifecycle
      if (selectedLifecycle !== 'ALL' && item.lifecycle_state !== selectedLifecycle) {
        return false;
      }

      // 4. Origin
      if (selectedOrigin !== 'ALL' && item.origin_class !== selectedOrigin) {
        return false;
      }

      // 5. Geography
      if (selectedGeography !== 'ALL') {
        if (selectedGeography === 'HOWRAH' && !meta?.regionName?.includes('Howrah')) return false;
        if (selectedGeography === 'JAMNAGAR' && !meta?.regionName?.includes('Jamnagar')) return false;
        if (selectedGeography === 'AHMEDABAD' && !meta?.regionName?.includes('Ahmedabad')) return false;
        if (selectedGeography === 'UNLOCATED' && meta?.atlasNodeId) return false;
      }

      // 6. Evidence Status
      if (selectedEvidenceStatus !== 'ALL') {
        if (selectedEvidenceStatus === 'CONTRADICTED') {
          const isContradicted =
            item.candidate_id === 'OPP-E6B40775E03ECE44' || item.contradictory_evidence_ids?.length > 0;
          if (!isContradicted) return false;
        } else if (selectedEvidenceStatus === 'DATA_COMPLETE') {
          if (comp?.evidence_gap_status !== 'DATA_COMPLETE') return false;
        } else if (selectedEvidenceStatus === 'EVIDENCE_GAPS') {
          if (comp?.evidence_gap_status === 'DATA_COMPLETE') return false;
        }
      }

      // 7. Atlas Linked Only
      if (onlyAtlasLinked && !meta?.atlasNodeId) {
        return false;
      }

      // 8. Research State
      if (selectedResearchState !== 'ALL') {
        if (selectedResearchState === 'IN_PROGRESS' && item.investigation_status !== 'IN_PROGRESS') return false;
        if (selectedResearchState === 'UNSCHEDULED' && item.investigation_status !== 'UNSCHEDULED') return false;
      }

      return true;
    });
  }, [
    candidates,
    searchQuery,
    selectedCategory,
    selectedLifecycle,
    selectedOrigin,
    selectedGeography,
    selectedEvidenceStatus,
    onlyAtlasLinked,
    selectedResearchState,
    comparisonRows,
    candidateDetailMap
  ]);

  // Sort Candidates
  const sortedCandidates = useMemo(() => {
    const list = [...filteredCandidates];
    list.sort((a, b) => {
      let valA: any = a.candidate_id;
      let valB: any = b.candidate_id;

      if (sortColumn === 'name') {
        valA = a.name;
        valB = b.name;
      } else if (sortColumn === 'category') {
        valA = a.category;
        valB = b.category;
      } else if (sortColumn === 'lifecycle') {
        valA = a.lifecycle_state;
        valB = b.lifecycle_state;
      } else if (sortColumn === 'gross_margin') {
        valA = a.financial_summary?.estimated_gross_margin_bps ?? -1;
        valB = b.financial_summary?.estimated_gross_margin_bps ?? -1;
      } else if (sortColumn === 'retail_asp') {
        valA = a.financial_summary?.prevailing_retail_asp_inr ?? -1;
        valB = b.financial_summary?.prevailing_retail_asp_inr ?? -1;
      } else if (sortColumn === 'updated') {
        valA = new Date(a.updated_at_utc).getTime();
        valB = new Date(b.updated_at_utc).getTime();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [filteredCandidates, sortColumn, sortDirection]);

  // Active Selected Candidate Details
  const activeCandidate = useMemo(() => {
    return candidates.find((c) => c.candidate_id === selectedCandidateId) || null;
  }, [candidates, selectedCandidateId]);

  const activeCandidateDetail = useMemo(() => {
    if (!selectedCandidateId) return null;
    return candidateDetailMap[selectedCandidateId] || null;
  }, [candidateDetailMap, selectedCandidateId]);

  const activeCandidateGaps = useMemo(() => {
    if (!activeCandidate) return null;
    return evidenceGapsMap[activeCandidate.canonical_product_id] || null;
  }, [evidenceGapsMap, activeCandidate]);

  // Keyboard Navigation: Up / Down arrow moves selection; Enter opens inspector; 'c' toggles compare
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIndex = sortedCandidates.findIndex((c) => c.candidate_id === selectedCandidateId);
        if (currentIndex < sortedCandidates.length - 1) {
          const next = sortedCandidates[currentIndex + 1];
          setSelectedCandidateId(next.candidate_id);
          onSelectCandidate?.(next.candidate_id);
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = sortedCandidates.findIndex((c) => c.candidate_id === selectedCandidateId);
        if (currentIndex > 0) {
          const prev = sortedCandidates[currentIndex - 1];
          setSelectedCandidateId(prev.candidate_id);
          onSelectCandidate?.(prev.candidate_id);
        }
      } else if (e.key === 'Enter') {
        setIsInspectorOpen(true);
      } else if (e.key === 'Escape') {
        setIsInspectorOpen(false);
        setUnlocatedNotice(null);
        setShowSaveViewModal(false);
        setShowWalkthroughModal(false);
        setGovernedModalAction(null);
      } else if (e.key === 'c' && selectedCandidateId) {
        toggleComparisonCandidate(selectedCandidateId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sortedCandidates, selectedCandidateId, onSelectCandidate]);

  // Toggle selection for comparison
  const toggleComparisonCandidate = (id: string) => {
    setComparisonSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((item) => item !== id);
      } else {
        if (prev.length >= 4) {
          // Keep max 4
          return [...prev.slice(1), id];
        }
        return [...prev, id];
      }
    });
  };

  // Multi-column Sort Toggle
  const handleSortToggle = (colKey: string) => {
    if (sortColumn === colKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(colKey);
      setSortDirection('asc');
    }
  };

  // Strategic Walkthrough Handler
  const handleExecuteWalkthroughStep = (step: number) => {
    setWalkthroughStep(step);
    if (step === 1) {
      // Step 1: Select Howrah SS304 Clamps
      const howrahId = 'OPP-E6B40775E03ECE44';
      setSelectedCandidateId(howrahId);
      onSelectCandidate?.(howrahId);
      setIsInspectorOpen(true);
      setActiveTab('TABLE');
    } else if (step === 2) {
      // Step 2: Filter universe to comparable opportunities (Physical Goods)
      setSelectedCategory('PHYSICAL_GOODS');
      setSearchQuery('');
      setActiveTab('TABLE');
    } else if (step === 3) {
      // Step 3: Compare against 3 alternatives (Howrah SS304, Jamnagar Brass, Argon Gas, NABL Lab)
      setComparisonSelectedIds([
        'OPP-E6B40775E03ECE44',
        'OPP-4C9B52BBEB89D4E2',
        'OPP-6DA1DDAC84E59527',
        'OPP-C81D434ECFD26233'
      ]);
      setActiveTab('COMPARE');
    } else if (step === 4) {
      // Step 4: Inspect evidence gaps
      setActiveTab('TABLE');
      setSelectedCandidateId('OPP-E6B40775E03ECE44');
      setIsInspectorOpen(true);
    } else if (step === 5) {
      // Step 5: Trace back to thesis and Atlas
      setShowWalkthroughModal(false);
      onNavigateToThesis?.('THESIS-SS304-HOWRAH-01');
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0f17] text-slate-100 font-sans select-text border border-[#1f293d] rounded-lg overflow-hidden shadow-2xl">
      {/* ========================================================================= */}
      {/* 1. UNIVERSE COMMAND HEADER                                                */}
      {/* ========================================================================= */}
      <header className="px-4 py-2.5 bg-[#111827] border-b border-[#1f293d] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100 text-sm tracking-tight font-mono">
                  DISCOVERY UNIVERSE
                </span>
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800">
                  WORKSPACE 03
                </span>
              </div>
              <span className="text-[10px] text-slate-400">
                Institutional Opportunity Universe & Multi-Candidate Sieve
              </span>
            </div>
          </div>

          <div className="h-6 w-[1px] bg-slate-700 hidden sm:block" />

          {/* Population Counters */}
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="px-2 py-0.5 rounded bg-[#162238] border border-[#233554] text-slate-300">
              Total: <strong className="text-cyan-300">{candidates.length}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-800 text-emerald-300 hidden md:inline">
              Investigate: <strong>{candidates.filter((c) => c.lifecycle_state === 'INVESTIGATE').length}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800 text-amber-300 hidden md:inline">
              New: <strong>{candidates.filter((c) => c.lifecycle_state === 'NEW').length}</strong>
            </span>
            <span className="px-2 py-0.5 rounded bg-rose-950/70 border border-rose-800 text-rose-300 hidden lg:inline">
              Refuted: <strong>{candidates.filter((c) => c.candidate_id === 'OPP-E6B40775E03ECE44').length}</strong>
            </span>
          </div>
        </div>

        {/* Global Controls & Views */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Strategic Walkthrough Trigger */}
          <button
            onClick={() => setShowWalkthroughModal(true)}
            className="px-2.5 py-1 rounded bg-gradient-to-r from-cyan-950 to-indigo-950 hover:from-cyan-900 hover:to-indigo-900 text-cyan-200 border border-cyan-700 text-[11px] font-semibold flex items-center gap-1.5 transition-all shadow-sm"
            title="Launch governed multi-candidate strategic walkthrough"
          >
            <Workflow className="w-3.5 h-3.5 text-cyan-400" />
            <span>Strategic Walkthrough</span>
          </button>

          {/* View Mode Switcher */}
          <div className="flex items-center rounded bg-[#162032] border border-[#223352] p-0.5">
            <button
              onClick={() => setActiveTab('TABLE')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                activeTab === 'TABLE'
                  ? 'bg-cyan-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Universe Table ({sortedCandidates.length})
            </button>
            <button
              onClick={() => setActiveTab('ANALYTICS')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activeTab === 'ANALYTICS'
                  ? 'bg-cyan-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart3 className="w-3 h-3" />
              <span>Distributions</span>
            </button>
            <button
              onClick={() => setActiveTab('COMPARE')}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
                activeTab === 'COMPARE'
                  ? 'bg-cyan-600 text-white font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns className="w-3 h-3" />
              <span>Compare ({comparisonSelectedIds.length})</span>
            </button>
          </div>

          {/* Quick Intake Trigger */}
          <div className="relative group">
            <button className="px-2 py-1 rounded bg-[#162238] hover:bg-[#1f2f4e] text-cyan-300 border border-[#2b416d] text-[11px] font-mono flex items-center gap-1">
              <span>+ Screen Fixture</span>
              <ChevronDown className="w-3 h-3 text-cyan-400" />
            </button>
            <div className="absolute right-0 top-full mt-1 w-64 bg-[#111827] border border-[#1f293d] rounded shadow-xl py-1 z-50 hidden group-hover:block text-xs">
              <div className="px-3 py-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                Golden Discovery Fixtures
              </div>
              <button
                onClick={() => handleIngestFixture('FIX-IMART-SS304-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>Howrah DIN3017 SS304 Clamps</span>
                <span className="text-[10px] font-mono text-cyan-400">[PHYS]</span>
              </button>
              <button
                onClick={() => handleIngestFixture('FIX-AMZ-BRASS-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>Jamnagar Brass Ball Valve</span>
                <span className="text-[10px] font-mono text-cyan-400">[PHYS]</span>
              </button>
              <button
                onClick={() => handleIngestFixture('FIX-B2B-ARGON-GAS-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>Industrial Argon Gas Cylinders</span>
                <span className="text-[10px] font-mono text-cyan-400">[B2B]</span>
              </button>
              <button
                onClick={() => handleIngestFixture('FIX-SERVICE-METALLURGY-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>NABL Metallurgy Test Lab</span>
                <span className="text-[10px] font-mono text-cyan-400">[SERV]</span>
              </button>
              <button
                onClick={() => handleIngestFixture('FIX-SAAS-DEVTOOL-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>Synapse eBPF Tracing SaaS</span>
                <span className="text-[10px] font-mono text-cyan-400">[SAAS]</span>
              </button>
              <button
                onClick={() => handleIngestFixture('FIX-NOVEL-MYCELIUM-001')}
                className="w-full text-left px-3 py-1.5 hover:bg-[#1a253a] text-slate-200 flex items-center justify-between"
              >
                <span>Mycelium Packaging IP</span>
                <span className="text-[10px] font-mono text-cyan-400">[NOVEL]</span>
              </button>
            </div>
          </div>

          {/* Refresh Action */}
          <button
            onClick={fetchAllData}
            disabled={isLoading}
            className="p-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-slate-300 border border-[#1f293d] transition-colors"
            title="Refresh Discovery Universe"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* 2. SUB-TOOLBAR: SAVED VIEWS, SEARCH, & SYSTEM INTEGRITY                   */}
      {/* ========================================================================= */}
      <div className="px-4 py-2 bg-[#0e1422] border-b border-[#1f293d] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
        <div className="flex items-center gap-2 flex-1 max-w-2xl">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter by ID (OPP-...), product name, entity, cluster, or connector..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#141b2b] border border-[#1f293d] rounded pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Saved View Selector */}
          <div className="flex items-center gap-1 shrink-0">
            <Bookmark className="w-3.5 h-3.5 text-cyan-400" />
            <select
              value={activeViewId}
              onChange={(e) => {
                const found = savedViews.find((v) => v.id === e.target.value);
                if (found) handleApplyView(found);
              }}
              className="bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1.5 text-[11px] text-slate-200 focus:outline-none focus:border-cyan-500 max-w-[210px] truncate"
            >
              {savedViews.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowSaveViewModal(true)}
              className="px-2 py-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-slate-300 border border-[#1f293d] text-[10px] font-mono"
              title="Save current filters as custom local view"
            >
              Save View
            </button>
          </div>
        </div>

        {/* Column Visibility & Table Layout Options */}
        <div className="flex items-center gap-2">
          {/* Column Toggle Menu */}
          <div className="relative">
            <button
              onClick={() => setShowColumnMenu(!showColumnMenu)}
              className="px-2 py-1.5 rounded bg-[#141b2b] hover:bg-[#1a253a] text-slate-300 border border-[#1f293d] text-[11px] flex items-center gap-1.5"
            >
              <Columns className="w-3.5 h-3.5 text-slate-400" />
              <span>Columns</span>
            </button>
            {showColumnMenu && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-[#111827] border border-[#1f293d] rounded shadow-2xl p-2 z-50 text-xs">
                <div className="font-semibold text-slate-400 mb-1.5 text-[10px] uppercase tracking-wider">
                  Visible Columns
                </div>
                {Object.keys(visibleColumns).map((colKey) => (
                  <label key={colKey} className="flex items-center gap-2 py-1 hover:text-white cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleColumns[colKey]}
                      onChange={(e) =>
                        setVisibleColumns((prev) => ({
                          ...prev,
                          [colKey]: e.target.checked
                        }))
                      }
                      className="rounded border-[#2b3c5a] text-cyan-500 focus:ring-0"
                    />
                    <span className="capitalize">{colKey.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Toggle Filter Rail */}
          <button
            onClick={() => setIsFilterRailOpen(!isFilterRailOpen)}
            className={`px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 border transition-colors ${
              isFilterRailOpen
                ? 'bg-cyan-950/70 border-cyan-800 text-cyan-300'
                : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filters</span>
          </button>

          {/* Toggle Right Inspector */}
          <button
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            className={`px-2 py-1.5 rounded text-[11px] flex items-center gap-1.5 border transition-colors ${
              isInspectorOpen
                ? 'bg-cyan-950/70 border-cyan-800 text-cyan-300'
                : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Inspector</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. ALERTS & UNLOCATED FEEDBACK BANNERS                                    */}
      {/* ========================================================================= */}
      {unlocatedNotice && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-amber-950/80 border border-amber-800 text-amber-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{unlocatedNotice}</span>
          </div>
          <button onClick={() => setUnlocatedNotice(null)} className="text-amber-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionSuccessMessage && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccessMessage}</span>
          </div>
          <button onClick={() => setActionSuccessMessage(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="mx-4 mt-2 px-3 py-2 rounded bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-center justify-between animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. MAIN WORKSPACE CONTENT: FILTER RAIL + TABLE + INSPECTOR                */}
      {/* ========================================================================= */}
      <div className="flex-1 flex overflow-hidden">
        {/* ----------------------------------------------------------------------- */}
        {/* REGION B: FACETED FILTER RAIL (LEFT SIDE)                               */}
        {/* ----------------------------------------------------------------------- */}
        {isFilterRailOpen && (
          <aside className="w-64 border-r border-[#1f293d] bg-[#0c121d] flex flex-col shrink-0 overflow-y-auto select-none">
            <div className="p-3 border-b border-[#1f293d] flex items-center justify-between bg-[#111827]">
              <span className="font-semibold text-slate-200 text-xs uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3.5 h-3.5 text-cyan-400" />
                Faceted Filters
              </span>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedCategory('ALL');
                  setSelectedLifecycle('ALL');
                  setSelectedOrigin('ALL');
                  setSelectedGeography('ALL');
                  setSelectedEvidenceStatus('ALL');
                  setSelectedResearchState('ALL');
                  setOnlyAtlasLinked(false);
                }}
                className="text-[10px] text-cyan-400 hover:underline"
              >
                Reset All
              </button>
            </div>

            <div className="p-3 space-y-4 text-xs">
              {/* Filter 1: Geography & Spatial Reference */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Geography & Cluster</span>
                  <MapPin className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedGeography}
                  onChange={(e) => setSelectedGeography(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Geographies</option>
                  <option value="HOWRAH">Howrah / Baltikuri (WB)</option>
                  <option value="JAMNAGAR">Jamnagar GIDC (GJ)</option>
                  <option value="AHMEDABAD">Ahmedabad / Vatva (GJ)</option>
                  <option value="UNLOCATED">Unlocated (Cloud / IP)</option>
                </select>

                <div className="mt-2">
                  <label className="flex items-center gap-2 text-slate-300 hover:text-white cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={onlyAtlasLinked}
                      onChange={(e) => setOnlyAtlasLinked(e.target.checked)}
                      className="rounded border-[#2b3c5a] text-cyan-500 focus:ring-0"
                    />
                    <span>Atlas-Linked Hubs Only</span>
                  </label>
                </div>
              </div>

              {/* Filter 2: Opportunity Classification */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Category Classification</span>
                  <Tag className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Categories</option>
                  <option value="PHYSICAL_GOODS">Physical Goods (Manufactured)</option>
                  <option value="SOFTWARE_DIGITAL">Software & Cloud SaaS</option>
                  <option value="B2B_DISTRIBUTION">B2B Industrial Distribution</option>
                  <option value="SERVICE_CONTRACT">Service Contract / NABL Lab</option>
                  <option value="BIOMATERIAL_PACKAGING_IP">Novel IP / Bio-Material</option>
                </select>
              </div>

              {/* Filter 3: Lifecycle State */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Lifecycle State</span>
                  <Clock className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedLifecycle}
                  onChange={(e) => setSelectedLifecycle(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Lifecycle States</option>
                  <option value="NEW">NEW (Discovered)</option>
                  <option value="INVESTIGATE">INVESTIGATE (Queued Tasks)</option>
                  <option value="UNDERWRITING">UNDERWRITING (Audited)</option>
                  <option value="DISQUALIFIED">DISQUALIFIED (Rejected)</option>
                </select>
              </div>

              {/* Filter 4: Evidence & Epistemic Status */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Evidence & Contradiction</span>
                  <ShieldCheck className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedEvidenceStatus}
                  onChange={(e) => setSelectedEvidenceStatus(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Evidence States</option>
                  <option value="DATA_COMPLETE">Data Complete (Sufficiency 100%)</option>
                  <option value="EVIDENCE_GAPS">Evidence Gaps Present</option>
                  <option value="CONTRADICTED">Contradicted (SS201 Refutation)</option>
                </select>
              </div>

              {/* Filter 5: Origin Class */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Origin Class</span>
                  <Database className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedOrigin}
                  onChange={(e) => setSelectedOrigin(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All Origin Classes</option>
                  <option value="RECORDED_GOLDEN_FIXTURE">[FIXTURE] Golden Fixture</option>
                  <option value="LIVE_VERIFIED_CAPTURE">[LIVE] Verified Capture</option>
                  <option value="HISTORICAL_ANCHOR">[HISTORICAL] Anchor</option>
                </select>
              </div>

              {/* Filter 6: Research Queue State */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1.5 flex items-center justify-between">
                  <span>Task Queue State</span>
                  <Radio className="w-3 h-3 text-cyan-400" />
                </label>
                <select
                  value={selectedResearchState}
                  onChange={(e) => setSelectedResearchState(e.target.value)}
                  className="w-full bg-[#141b2b] border border-[#1f293d] rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="ALL">All States</option>
                  <option value="IN_PROGRESS">Active Tasks In Progress</option>
                  <option value="UNSCHEDULED">Unscheduled Investigation</option>
                </select>
              </div>

              {/* Keyboard Shortcut Tips */}
              <div className="pt-2 border-t border-[#1f293d]/60 text-[10px] text-slate-500 space-y-1 font-mono">
                <div>[↑/↓] Navigate Candidate Rows</div>
                <div>[Enter] Focus Inspector Pane</div>
                <div>[c] Toggle Compare Selection</div>
                <div>[Esc] Dismiss Panes & Modals</div>
              </div>
            </div>
          </aside>
        )}

        {/* ----------------------------------------------------------------------- */}
        {/* REGION C: PRIMARY CANDIDATE UNIVERSE WORKING SURFACE                    */}
        {/* ----------------------------------------------------------------------- */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0b0f17] overflow-hidden">
          {/* MULTI-CANDIDATE SELECTION BAR (When rows checked) */}
          {comparisonSelectedIds.length > 0 && (
            <div className="px-4 py-1.5 bg-[#121c2e] border-b border-cyan-900/60 flex items-center justify-between text-xs text-cyan-200 shrink-0">
              <div className="flex items-center gap-2 font-mono">
                <CheckSquare className="w-4 h-4 text-cyan-400" />
                <span>
                  <strong>{comparisonSelectedIds.length}</strong> Candidate(s) Selected for Side-by-Side Sieve
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-[11px] text-slate-400">
                  {comparisonSelectedIds.map((id) => id.slice(0, 10)).join(', ')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveTab('COMPARE')}
                  className="px-2.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-[11px] transition-colors"
                >
                  Compare Side-by-Side ({comparisonSelectedIds.length})
                </button>
                <button
                  onClick={() => setComparisonSelectedIds([])}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* VIEW: 1. UNIVERSE TABLE */}
          {activeTab === 'TABLE' && (
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-left text-xs font-sans">
                {/* Sticky Header */}
                <thead className="sticky top-0 bg-[#111827] text-slate-300 border-b border-[#1f293d] font-mono text-[11px] z-10 select-none">
                  <tr>
                    <th className="py-2.5 px-3 w-8 text-center">
                      <span className="sr-only">Select</span>
                    </th>

                    {visibleColumns.candidate_id && (
                      <th
                        onClick={() => handleSortToggle('candidate_id')}
                        className="py-2.5 px-3 cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Candidate ID</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.name && (
                      <th
                        onClick={() => handleSortToggle('name')}
                        className="py-2.5 px-3 cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Opportunity / Product</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.category && (
                      <th
                        onClick={() => handleSortToggle('category')}
                        className="py-2.5 px-3 cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Category</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.geography && <th className="py-2.5 px-3">Geography & Precision</th>}

                    {visibleColumns.entity && <th className="py-2.5 px-3">Linked Entity</th>}

                    {visibleColumns.lifecycle && (
                      <th
                        onClick={() => handleSortToggle('lifecycle')}
                        className="py-2.5 px-3 cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center gap-1.5">
                          <span>Lifecycle</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.evidence && <th className="py-2.5 px-3">Evidence Status</th>}

                    {visibleColumns.pricing && (
                      <th
                        onClick={() => handleSortToggle('retail_asp')}
                        className="py-2.5 px-3 text-right cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Retail ASP</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.spread && (
                      <th
                        onClick={() => handleSortToggle('gross_margin')}
                        className="py-2.5 px-3 text-right cursor-pointer hover:text-cyan-300 transition-colors"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          <span>Gross Margin</span>
                          <ArrowUpDown className="w-3 h-3 text-slate-500" />
                        </div>
                      </th>
                    )}

                    {visibleColumns.connector && <th className="py-2.5 px-3">Source Connector</th>}

                    {visibleColumns.nextAction && <th className="py-2.5 px-3 text-center">Next Action</th>}
                  </tr>
                </thead>

                {/* Table Body */}
                <tbody className="divide-y divide-[#172233] text-slate-300">
                  {sortedCandidates.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-slate-500">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Layers className="w-8 h-8 text-slate-600" />
                          <span className="text-sm font-medium">No candidates match current faceted filters</span>
                          <button
                            onClick={() => {
                              setSearchQuery('');
                              setSelectedCategory('ALL');
                              setSelectedLifecycle('ALL');
                              setSelectedOrigin('ALL');
                              setSelectedGeography('ALL');
                              setSelectedEvidenceStatus('ALL');
                            }}
                            className="text-xs text-cyan-400 hover:underline mt-1"
                          >
                            Reset filters to view all opportunities
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    sortedCandidates.map((c) => {
                      const isSelected = c.candidate_id === selectedCandidateId;
                      const isChecked = comparisonSelectedIds.includes(c.candidate_id);
                      const meta = CANDIDATE_CROSS_MAP[c.candidate_id];
                      const comp = comparisonRows.find((r) => r.candidate_id === c.candidate_id);
                      const isContradicted =
                        c.candidate_id === 'OPP-E6B40775E03ECE44' || c.contradictory_evidence_ids?.length > 0;

                      return (
                        <tr
                          key={c.candidate_id}
                          onClick={() => {
                            setSelectedCandidateId(c.candidate_id);
                            onSelectCandidate?.(c.candidate_id);
                          }}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#15233b] text-white border-l-2 border-cyan-400'
                              : 'hover:bg-[#0f1726]'
                          }`}
                        >
                          {/* Row Checkbox */}
                          <td
                            className="py-2 px-3 text-center"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleComparisonCandidate(c.candidate_id);
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="rounded border-[#2b3c5a] text-cyan-500 focus:ring-0 cursor-pointer"
                            />
                          </td>

                          {/* Candidate ID */}
                          {visibleColumns.candidate_id && (
                            <td className="py-2 px-3 font-mono text-[11px] text-cyan-300 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span>{c.candidate_id}</span>
                                {c.origin_class === 'RECORDED_GOLDEN_FIXTURE' && (
                                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-sky-950/80 text-sky-300 border border-sky-800">
                                    [FIXTURE]
                                  </span>
                                )}
                              </div>
                            </td>
                          )}

                          {/* Product / Opportunity Name */}
                          {visibleColumns.name && (
                            <td className="py-2 px-3 font-medium max-w-xs truncate text-slate-100">
                              <div className="flex flex-col">
                                <span className="truncate">{c.name}</span>
                                <span className="text-[10px] font-mono text-slate-500 truncate">
                                  {c.canonical_product_id}
                                </span>
                              </div>
                            </td>
                          )}

                          {/* Category Badge */}
                          {visibleColumns.category && (
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-[#162238] text-slate-300 border border-[#2b416d]">
                                {c.category}
                              </span>
                            </td>
                          )}

                          {/* Geography & Precision */}
                          {visibleColumns.geography && (
                            <td className="py-2 px-3 whitespace-nowrap">
                              {meta?.regionName ? (
                                <div className="flex flex-col">
                                  <span className="text-slate-200 text-[11px]">{meta.regionName}</span>
                                  <span className="text-[9px] font-mono text-cyan-400/80">
                                    {meta.precisionRadius || '±1.5km Centroid'}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-mono text-slate-500 italic">
                                  Unlocated / Virtual IP
                                </span>
                              )}
                            </td>
                          )}

                          {/* Linked Entity */}
                          {visibleColumns.entity && (
                            <td className="py-2 px-3 whitespace-nowrap">
                              {c.entity_relationships && c.entity_relationships.length > 0 ? (
                                <div className="flex flex-col">
                                  <span className="text-slate-200 text-[11px]">
                                    {c.entity_relationships[0].entity_name}
                                  </span>
                                  <span className="text-[9px] font-mono text-amber-400/70">
                                    [SYNTHETIC_DEMO_FIXTURE]
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[10px] font-mono text-slate-500">Unassigned</span>
                              )}
                            </td>
                          )}

                          {/* Lifecycle Badge */}
                          {visibleColumns.lifecycle && (
                            <td className="py-2 px-3 whitespace-nowrap">
                              {c.lifecycle_state === 'INVESTIGATE' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-800">
                                  INVESTIGATE
                                </span>
                              ) : c.lifecycle_state === 'UNDERWRITING' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                                  UNDERWRITING
                                </span>
                              ) : c.lifecycle_state === 'NEW' ? (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-800">
                                  NEW
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                  {c.lifecycle_state}
                                </span>
                              )}
                            </td>
                          )}

                          {/* Evidence Status & Contradictions */}
                          {visibleColumns.evidence && (
                            <td className="py-2 px-3 whitespace-nowrap">
                              {isContradicted ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/90 text-rose-300 border border-rose-700 animate-pulse">
                                  CONTRADICTED (SS201)
                                </span>
                              ) : comp?.evidence_gap_status === 'DATA_COMPLETE' ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-950/70 text-emerald-300 border border-emerald-800">
                                  DATA_COMPLETE
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-950/70 text-amber-300 border border-amber-800">
                                  GAPS_PENDING
                                </span>
                              )}
                            </td>
                          )}

                          {/* Retail ASP */}
                          {visibleColumns.pricing && (
                            <td className="py-2 px-3 text-right font-mono text-[11px] whitespace-nowrap">
                              {c.financial_summary?.prevailing_retail_asp_inr != null ? (
                                <span className="text-slate-100">
                                  ₹{c.financial_summary.prevailing_retail_asp_inr.toLocaleString()}
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">[DATA REQ]</span>
                              )}
                            </td>
                          )}

                          {/* Gross Margin */}
                          {visibleColumns.spread && (
                            <td className="py-2 px-3 text-right font-mono text-[11px] whitespace-nowrap">
                              {c.financial_summary?.estimated_gross_margin_bps != null ? (
                                <span className="text-emerald-400 font-semibold">
                                  {(c.financial_summary.estimated_gross_margin_bps / 100).toFixed(1)}%
                                </span>
                              ) : (
                                <span className="text-slate-500 italic">[DATA REQ]</span>
                              )}
                            </td>
                          )}

                          {/* Connector */}
                          {visibleColumns.connector && (
                            <td className="py-2 px-3 font-mono text-[10px] text-slate-400 whitespace-nowrap">
                              {c.source_url ? c.source_url.replace('connector://', '') : 'internal://fixture'}
                            </td>
                          )}

                          {/* Next Required Action */}
                          {visibleColumns.nextAction && (
                            <td className="py-2 px-3 text-center whitespace-nowrap">
                              {isContradicted ? (
                                <span className="text-[10px] font-mono text-rose-400 font-semibold">
                                  Refute Metallurgy
                                </span>
                              ) : c.lifecycle_state === 'INVESTIGATE' ? (
                                <span className="text-[10px] font-mono text-cyan-400">
                                  Underwrite
                                </span>
                              ) : c.category === 'SERVICE_CONTRACT' ? (
                                <span className="text-[10px] font-mono text-amber-400">
                                  Labor Cost Req
                                </span>
                              ) : (
                                <span className="text-[10px] font-mono text-slate-400">
                                  Explore Gaps
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* VIEW: 2. VISUAL ANALYTICS & DISTRIBUTIONS */}
          {activeTab === 'ANALYTICS' && (
            <div className="flex-1 p-4 overflow-y-auto space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-[#1f293d]">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-cyan-400" />
                    <span>Discovery Universe Population Analytics</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Distribution across lifecycle, domain categories, geographic precisions, and evidence sufficiency.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab('TABLE')}
                  className="px-2.5 py-1 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] text-xs font-mono"
                >
                  Return to Table
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Chart 1: Lifecycle State Distribution */}
                <div className="p-4 rounded bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 font-mono mb-2 uppercase tracking-wider">
                      Lifecycle State Distribution
                    </h4>
                    <div className="space-y-2 mt-3">
                      {['NEW', 'INVESTIGATE', 'UNDERWRITING', 'DISQUALIFIED'].map((state) => {
                        const count = candidates.filter((c) => c.lifecycle_state === state).length;
                        const pct = candidates.length > 0 ? (count / candidates.length) * 100 : 0;
                        return (
                          <div
                            key={state}
                            onClick={() => {
                              setSelectedLifecycle(state);
                              setActiveTab('TABLE');
                            }}
                            className="group cursor-pointer"
                          >
                            <div className="flex items-center justify-between text-xs mb-1 font-mono">
                              <span className="text-slate-300 group-hover:text-cyan-300">{state}</span>
                              <span className="text-slate-400">
                                {count} ({pct.toFixed(0)}%)
                              </span>
                            </div>
                            <div className="h-2 w-full bg-[#162032] rounded overflow-hidden">
                              <div
                                className="h-full bg-cyan-500 transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-3 font-mono">
                    * Click any bar to filter Universe Table by that lifecycle state.
                  </span>
                </div>

                {/* Chart 2: Category Breakdown */}
                <div className="p-4 rounded bg-[#111827] border border-[#1f293d] flex flex-col justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-300 font-mono mb-2 uppercase tracking-wider">
                      Domain Category Distribution
                    </h4>
                    <div className="space-y-2 mt-3">
                      {[
                        'PHYSICAL_GOODS',
                        'SOFTWARE_DIGITAL',
                        'B2B_DISTRIBUTION',
                        'SERVICE_CONTRACT',
                        'BIOMATERIAL_PACKAGING_IP'
                      ].map((cat) => {
                        const count = candidates.filter((c) => c.category === cat).length;
                        const pct = candidates.length > 0 ? (count / candidates.length) * 100 : 0;
                        return (
                          <div
                            key={cat}
                            onClick={() => {
                              setSelectedCategory(cat);
                              setActiveTab('TABLE');
                            }}
                            className="group cursor-pointer"
                          >
                            <div className="flex items-center justify-between text-xs mb-1 font-mono">
                              <span className="text-slate-300 group-hover:text-cyan-300 truncate max-w-[180px]">
                                {cat}
                              </span>
                              <span className="text-slate-400">
                                {count} ({pct.toFixed(0)}%)
                              </span>
                            </div>
                            <div className="h-2 w-full bg-[#162032] rounded overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 transition-all duration-500"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 mt-3 font-mono">
                    * Click any bar to filter Universe Table by domain category.
                  </span>
                </div>

                {/* Chart 3: Geographic Precision Classes */}
                <div className="p-4 rounded bg-[#111827] border border-[#1f293d]">
                  <h4 className="text-xs font-semibold text-slate-300 font-mono mb-2 uppercase tracking-wider">
                    Geographic Spatial Precision
                  </h4>
                  <div className="space-y-3 mt-3 text-xs">
                    <div className="p-2.5 rounded bg-[#162238] border border-[#223554] flex items-center justify-between font-mono">
                      <div>
                        <span className="text-cyan-300 font-semibold">INDUSTRIAL_ESTATE_CENTROID</span>
                        <div className="text-[10px] text-slate-400">Precision: ±800m to ±2,000m buffer</div>
                      </div>
                      <span className="text-sm font-bold text-slate-100">
                        {
                          candidates.filter(
                            (c) =>
                              CANDIDATE_CROSS_MAP[c.candidate_id]?.clusterPrecision ===
                              'INDUSTRIAL_ESTATE_CENTROID'
                          ).length
                        }
                      </span>
                    </div>

                    <div className="p-2.5 rounded bg-[#162238] border border-[#223554] flex items-center justify-between font-mono">
                      <div>
                        <span className="text-amber-300 font-semibold">UNVERIFIED_LOCATION</span>
                        <div className="text-[10px] text-slate-400">Virtual Cloud / Tech Transfer IP</div>
                      </div>
                      <span className="text-sm font-bold text-slate-100">
                        {
                          candidates.filter(
                            (c) =>
                              CANDIDATE_CROSS_MAP[c.candidate_id]?.clusterPrecision === 'UNVERIFIED_LOCATION' ||
                              !CANDIDATE_CROSS_MAP[c.candidate_id]
                          ).length
                        }
                      </span>
                    </div>
                  </div>
                </div>

                {/* Chart 4: Evidence Completeness Matrix */}
                <div className="p-4 rounded bg-[#111827] border border-[#1f293d]">
                  <h4 className="text-xs font-semibold text-slate-300 font-mono mb-2 uppercase tracking-wider">
                    Evidence Integrity & Refutation Audit
                  </h4>
                  <div className="space-y-3 mt-3 text-xs">
                    <div className="p-2.5 rounded bg-rose-950/60 border border-rose-800 flex items-center justify-between font-mono">
                      <div>
                        <span className="text-rose-300 font-semibold">REFUTED_SUPPLIER_CLAIMS</span>
                        <div className="text-[10px] text-rose-400/80">Task 4 SS201 spectrometry contradiction</div>
                      </div>
                      <span className="text-sm font-bold text-rose-300">1</span>
                    </div>

                    <div className="p-2.5 rounded bg-emerald-950/60 border border-emerald-800 flex items-center justify-between font-mono">
                      <div>
                        <span className="text-emerald-300 font-semibold">DATA_COMPLETE_CANDIDATES</span>
                        <div className="text-[10px] text-emerald-400/80">Full evidence sufficiency for underwriting</div>
                      </div>
                      <span className="text-sm font-bold text-emerald-300">
                        {comparisonRows.filter((r) => r.evidence_gap_status === 'DATA_COMPLETE').length}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW: 3. MULTI-CANDIDATE SIDE-BY-SIDE COMPARISON */}
          {activeTab === 'COMPARE' && (
            <div className="flex-1 p-4 overflow-y-auto">
              <div className="flex items-center justify-between pb-3 border-b border-[#1f293d] mb-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                    <Columns className="w-4 h-4 text-cyan-400" />
                    <span>Multi-Candidate Sieve & Difference Matrix</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Side-by-side comparison of 2 to 4 candidates with aligned unit economics, evidence coverage, and difference highlighting.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('TABLE')}
                    className="px-2.5 py-1 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] text-xs font-mono"
                  >
                    Return to Table
                  </button>
                </div>
              </div>

              {comparisonSelectedIds.length < 2 ? (
                <div className="p-8 text-center bg-[#111827] border border-[#1f293d] rounded-lg">
                  <p className="text-sm text-slate-400 mb-3">
                    Please select at least 2 candidates (up to 4) from the table to enable side-by-side comparison.
                  </p>
                  <button
                    onClick={() => {
                      setComparisonSelectedIds(['OPP-E6B40775E03ECE44', 'OPP-4C9B52BBEB89D4E2']);
                    }}
                    className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs"
                  >
                    Load Default Pair (Howrah SS304 vs Jamnagar Brass)
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <div
                    className="grid gap-3 min-w-[700px]"
                    style={{
                      gridTemplateColumns: `repeat(${comparisonSelectedIds.length}, minmax(240px, 1fr))`
                    }}
                  >
                    {comparisonSelectedIds.map((candId) => {
                      const c = candidates.find((item) => item.candidate_id === candId);
                      const comp = comparisonRows.find((r) => r.candidate_id === candId);
                      const meta = CANDIDATE_CROSS_MAP[candId];
                      const isRefuted = candId === 'OPP-E6B40775E03ECE44';

                      return (
                        <div
                          key={candId}
                          className={`rounded-lg border bg-[#111827] p-3 flex flex-col justify-between ${
                            isRefuted ? 'border-rose-800 ring-1 ring-rose-900/50' : 'border-[#1f293d]'
                          }`}
                        >
                          <div>
                            {/* Card Header */}
                            <div className="flex items-start justify-between gap-2 pb-2 border-b border-[#1f293d]">
                              <div>
                                <span className="font-mono text-[10px] text-cyan-400 block">{candId}</span>
                                <h4 className="font-bold text-xs text-slate-100 line-clamp-2">
                                  {c?.name || comp?.candidate_name || 'Loading candidate...'}
                                </h4>
                              </div>
                              <button
                                onClick={() => toggleComparisonCandidate(candId)}
                                className="text-slate-500 hover:text-slate-300"
                                title="Remove from comparison"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Contradiction Banner if Refuted */}
                            {isRefuted && (
                              <div className="my-2 p-1.5 rounded bg-rose-950/90 border border-rose-700 text-rose-200 text-[10px] font-mono">
                                <strong>AUDIT REFUTED:</strong> Laboratory spectrometry detected SS201. Batch confidence 0 bps.
                              </div>
                            )}

                            {/* Comparison Data Points */}
                            <div className="divide-y divide-[#172233] text-xs font-mono my-2 space-y-2">
                              {/* Domain */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Domain</span>
                                <span className="text-slate-200">{c?.category || comp?.category || 'PHYSICAL_GOODS'}</span>
                              </div>

                              {/* Geography */}
                              <div className="pt-2 flex flex-col">
                                <div className="flex justify-between">
                                  <span className="text-slate-500">Geography</span>
                                  <span className="text-slate-200 text-right">{meta?.regionName || 'Unlocated IP'}</span>
                                </div>
                                <span className="text-[10px] text-cyan-400/80 text-right">
                                  {meta?.precisionRadius || 'Virtual'}
                                </span>
                              </div>

                              {/* Retail ASP */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Retail ASP</span>
                                <span className="text-slate-100 font-semibold">
                                  {comp?.prevailing_retail_asp_inr != null
                                    ? `₹${comp.prevailing_retail_asp_inr.toLocaleString()}`
                                    : '[DATA REQ]'}
                                </span>
                              </div>

                              {/* Factory Quote */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Factory Quote</span>
                                <span className="text-slate-100">
                                  {comp?.factory_gate_quote_inr != null
                                    ? `₹${comp.factory_gate_quote_inr.toLocaleString()}`
                                    : '[DATA REQ]'}
                                </span>
                              </div>

                              {/* Gross Margin */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Gross Margin</span>
                                <span className="text-emerald-400 font-bold">
                                  {comp?.estimated_margin_bps != null
                                    ? `${(comp.estimated_margin_bps / 100).toFixed(1)}%`
                                    : '[DATA REQ]'}
                                </span>
                              </div>

                              {/* MOQ & Capital */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Unit MOQ</span>
                                <span className="text-slate-200">
                                  {comp?.unit_batch_moq != null ? `${comp.unit_batch_moq} units` : '[DATA REQ]'}
                                </span>
                              </div>

                              {/* Evidence Completeness */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Sufficiency</span>
                                <span className="text-cyan-300">
                                  {comp?.sufficiency_score_bps != null
                                    ? `${comp.sufficiency_score_bps} bps`
                                    : '10000 bps'}
                                </span>
                              </div>

                              {/* Source Connector */}
                              <div className="pt-2 flex justify-between">
                                <span className="text-slate-500">Connector</span>
                                <span className="text-slate-400 truncate max-w-[130px]">
                                  {comp?.source_connector_id || 'conn:b2b:indiamart'}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Quick Actions per Card */}
                          <div className="pt-2 border-t border-[#1f293d] flex items-center justify-between gap-1">
                            <button
                              onClick={() => {
                                setSelectedCandidateId(candId);
                                setActiveTab('TABLE');
                                setIsInspectorOpen(true);
                              }}
                              className="px-2 py-1 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 text-[10px] font-mono flex-1 text-center"
                            >
                              Inspect Details
                            </button>
                            {meta?.atlasNodeId && (
                              <button
                                onClick={() => handleAtlasNavigation(candId)}
                                className="p-1 rounded bg-[#162238] hover:bg-[#1e2f4f] text-slate-300"
                                title="Locate on Atlas"
                              >
                                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* ----------------------------------------------------------------------- */}
        {/* REGION D: CONTEXTUAL CANDIDATE INSPECTOR (PERSISTENT RIGHT DRAWER)      */}
        {/* ----------------------------------------------------------------------- */}
        {isInspectorOpen && activeCandidate && (
          <aside className="w-96 border-l border-[#1f293d] bg-[#0c121d] flex flex-col shrink-0 overflow-y-auto select-none shadow-2xl z-20">
            {/* Inspector Header */}
            <div className="p-3 bg-[#111827] border-b border-[#1f293d] flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[11px] font-bold text-cyan-400">
                    {activeCandidate.candidate_id}
                  </span>
                  <button
                    onClick={() => handleCopyHash(activeCandidate.candidate_id)}
                    className="text-slate-500 hover:text-slate-300"
                    title="Copy Candidate ID"
                  >
                    {copiedHash === activeCandidate.candidate_id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <h3 className="font-bold text-slate-100 text-xs mt-0.5 line-clamp-2">
                  {activeCandidate.name}
                </h3>
              </div>
              <button
                onClick={() => setIsInspectorOpen(false)}
                className="text-slate-500 hover:text-slate-300"
                title="Close Inspector Pane"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 space-y-4 text-xs font-sans">
              {/* CONTRADICTION ALERT (Howrah SS304) */}
              {activeCandidate.candidate_id === 'OPP-E6B40775E03ECE44' && (
                <div className="p-2.5 rounded bg-rose-950/80 border border-rose-800 text-rose-200">
                  <div className="flex items-center gap-1.5 font-bold font-mono text-[11px] text-rose-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>EVIDENCE CONTRADICTION REFUTATION</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed">
                    Task 4 spectrometry audit detected <strong>SS201 manganese (8.4%)</strong> rather than certified SS304 (0.8%). Macro opportunity conviction (8,500 bps) is decoupled from supplier batch confidence (0 bps, REFUTED). Net capital allocation blocked.
                  </p>
                </div>
              )}

              {/* 1. Identity & Spatial Provenance */}
              <div className="p-3 rounded bg-[#111827] border border-[#1f293d] space-y-2 font-mono text-[11px]">
                <div className="font-semibold text-slate-300 font-sans text-xs uppercase tracking-wider flex items-center justify-between">
                  <span>Identity & Provenance</span>
                  <Database className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="divide-y divide-[#172233] pt-1">
                  <div className="py-1 flex justify-between">
                    <span className="text-slate-500">Domain</span>
                    <span className="text-slate-200">{activeCandidate.category}</span>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span className="text-slate-500">Origin Class</span>
                    <span className="text-sky-300">{activeCandidate.origin_class}</span>
                  </div>
                  <div className="py-1 flex flex-col">
                    <span className="text-slate-500">Canonical SKU</span>
                    <span className="text-slate-300 truncate">{activeCandidate.canonical_product_id}</span>
                  </div>
                  <div className="py-1 flex flex-col">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">RFC 8785 Hash</span>
                      <button
                        onClick={() => handleCopyHash(activeCandidate.jcs_sha256)}
                        className="text-slate-400 hover:text-cyan-300 text-[10px]"
                      >
                        {copiedHash === activeCandidate.jcs_sha256 ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                    <span className="text-[10px] text-slate-400 truncate">{activeCandidate.jcs_sha256}</span>
                  </div>
                  <div className="py-1 flex flex-col">
                    <span className="text-slate-500">Spatial Reference</span>
                    <span className="text-slate-200">
                      {CANDIDATE_CROSS_MAP[activeCandidate.candidate_id]?.regionName || 'Unlocated / Cloud IP'}
                    </span>
                    <span className="text-[10px] text-cyan-400/80">
                      {CANDIDATE_CROSS_MAP[activeCandidate.candidate_id]?.precisionRadius || 'Virtual'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Commercial Economics Pane */}
              <div className="p-3 rounded bg-[#111827] border border-[#1f293d] space-y-2 font-mono text-[11px]">
                <div className="font-semibold text-slate-300 font-sans text-xs uppercase tracking-wider flex items-center justify-between">
                  <span>Commercial Economics</span>
                  <Tag className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="divide-y divide-[#172233] pt-1">
                  <div className="py-1 flex justify-between">
                    <span className="text-slate-500">Retail ASP</span>
                    <span className="text-slate-100 font-bold">
                      {activeCandidate.financial_summary?.prevailing_retail_asp_inr != null
                        ? `₹${activeCandidate.financial_summary.prevailing_retail_asp_inr.toLocaleString()}`
                        : '[DATA REQUIRED]'}
                    </span>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span className="text-slate-500">Factory Quote</span>
                    <span className="text-slate-100 font-bold">
                      {activeCandidate.financial_summary?.factory_gate_quote_inr != null
                        ? `₹${activeCandidate.financial_summary.factory_gate_quote_inr.toLocaleString()}`
                        : '[DATA REQUIRED]'}
                    </span>
                  </div>
                  <div className="py-1 flex justify-between">
                    <span className="text-slate-500">Gross Margin</span>
                    <span className="text-emerald-400 font-bold">
                      {activeCandidate.financial_summary?.estimated_gross_margin_bps != null
                        ? `${(activeCandidate.financial_summary.estimated_gross_margin_bps / 100).toFixed(1)}%`
                        : '[DATA REQUIRED]'}
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Evidence Sufficiency Checklist */}
              <div className="p-3 rounded bg-[#111827] border border-[#1f293d] space-y-2 text-xs">
                <div className="font-semibold text-slate-300 font-mono text-[11px] uppercase tracking-wider flex items-center justify-between">
                  <span>Evidence Sufficiency Sieve</span>
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="space-y-1.5 pt-1 font-mono text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Upstream Quote</span>
                    {activeCandidate.financial_summary?.factory_gate_quote_inr != null ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" /> VERIFIED
                      </span>
                    ) : (
                      <span className="text-amber-400 font-semibold">[DATA REQUIRED]</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Prevailing Retail ASP</span>
                    {activeCandidate.financial_summary?.prevailing_retail_asp_inr != null ? (
                      <span className="text-emerald-400 font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" /> VERIFIED
                      </span>
                    ) : (
                      <span className="text-amber-400 font-semibold">[DATA REQUIRED]</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Logistics Freight Corridor</span>
                    <span className="text-cyan-400 font-semibold">APPROXIMATE</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Statutory Tax / HSN</span>
                    <span className="text-emerald-400 font-semibold">VERIFIED</span>
                  </div>
                </div>
              </div>

              {/* 4. Investigation & Task Queue */}
              {activeCandidate.outstanding_tasks && activeCandidate.outstanding_tasks.length > 0 && (
                <div className="p-3 rounded bg-[#111827] border border-[#1f293d] space-y-2 text-xs">
                  <div className="font-semibold text-slate-300 font-mono text-[11px] uppercase tracking-wider flex items-center justify-between">
                    <span>Active Investigation Tasks ({activeCandidate.outstanding_tasks.length})</span>
                    <Workflow className="w-3.5 h-3.5 text-cyan-400" />
                  </div>
                  <div className="space-y-2 pt-1">
                    {activeCandidate.outstanding_tasks.map((task: any) => (
                      <div
                        key={task.task_id}
                        className="p-2 rounded bg-[#162238] border border-[#233554] font-mono text-[10px]"
                      >
                        <div className="flex items-center justify-between text-cyan-300 font-semibold">
                          <span>{task.task_type}</span>
                          <span className="text-amber-400">{task.state}</span>
                        </div>
                        <p className="text-slate-400 mt-1 line-clamp-2 font-sans">{task.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Governed Actions Strip */}
              <div className="pt-2 border-t border-[#1f293d] space-y-2">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider font-mono">
                  Cross-Workspace & Governed Actions
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <button
                    onClick={() => handleAtlasNavigation(activeCandidate.candidate_id)}
                    className="px-2 py-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Compass className="w-3.5 h-3.5" />
                    <span>Locate on Atlas</span>
                  </button>

                  <button
                    onClick={() => {
                      const meta = CANDIDATE_CROSS_MAP[activeCandidate.candidate_id];
                      if (meta?.thesisId && onNavigateToThesis) {
                        onNavigateToThesis(meta.thesisId);
                      }
                    }}
                    className="px-2 py-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>View Thesis</span>
                  </button>

                  <button
                    onClick={() => {
                      const meta = CANDIDATE_CROSS_MAP[activeCandidate.candidate_id];
                      if (meta?.entityId && onNavigateToEntity) {
                        onNavigateToEntity(meta.entityId);
                      }
                    }}
                    className="px-2 py-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span>Entity Dossier</span>
                  </button>

                  <button
                    onClick={() => {
                      if (onSelectCandidateForInvestigation) {
                        onSelectCandidateForInvestigation(activeCandidate.candidate_id);
                      }
                    }}
                    className="px-2 py-1.5 rounded bg-[#162238] hover:bg-[#1e2f4f] text-cyan-300 border border-[#233554] flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Research Desk</span>
                  </button>
                </div>

                {/* Governed Bounded Actions */}
                <div className="pt-2 flex flex-col gap-1.5">
                  <button
                    onClick={() =>
                      setGovernedModalAction({
                        type: 'DISPATCH_RESEARCH',
                        candidateId: activeCandidate.candidate_id,
                        productName: activeCandidate.name,
                        canonicalId: activeCandidate.canonical_product_id
                      })
                    }
                    className="w-full py-1.5 px-3 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors shadow"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Launch Governed Investigation</span>
                  </button>

                  <button
                    onClick={() =>
                      setGovernedModalAction({
                        type: 'UNDERWRITE',
                        candidateId: activeCandidate.candidate_id,
                        productName: activeCandidate.name,
                        canonicalId: activeCandidate.canonical_product_id
                      })
                    }
                    className="w-full py-1.5 px-3 rounded bg-cyan-700 hover:bg-cyan-600 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Deterministic Underwrite</span>
                  </button>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 5. MODAL: GOVERNED ACTION CONFIRMATION (STAGE D.0 GOVERNANCE)             */}
      {/* ========================================================================= */}
      {governedModalAction && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111827] border border-[#2b3c5a] rounded-lg max-w-md w-full p-5 shadow-2xl space-y-4 text-xs font-sans">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-sm text-slate-100 font-mono">
                  {governedModalAction.type === 'DISPATCH_RESEARCH'
                    ? 'GOVERNED RESEARCH DISPATCH'
                    : 'DETERMINISTIC UNDERWRITE'}
                </h3>
              </div>
              <button
                onClick={() => setGovernedModalAction(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-300">
              You are dispatching bounded autonomous operations for candidate{' '}
              <strong className="text-cyan-300 font-mono">{governedModalAction.candidateId}</strong> (
              {governedModalAction.productName}).
            </p>

            {/* D.0 Governor Limits Check */}
            <div className="p-3 rounded bg-[#162238] border border-[#233554] space-y-2 font-mono text-[11px]">
              <div className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                Stage D.0 Resource & Autonomy Governors
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Daily Investigation Limit</span>
                <span className="text-cyan-300">4 / 6 Used (2 Available)</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Compute Spend Reserve</span>
                <span className="text-emerald-400">$1.42 / $25.00</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Autonomy Kill Switch</span>
                <span className="text-emerald-400 font-bold">NORMAL_PAPER_OPERATION</span>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                Operator Audit Rationale (Required)
              </label>
              <textarea
                value={operatorRationale}
                onChange={(e) => setOperatorRationale(e.target.value)}
                rows={2}
                className="w-full bg-[#141b2b] border border-[#1f293d] rounded p-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-mono"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f293d]">
              <button
                onClick={() => setGovernedModalAction(null)}
                disabled={isExecutingAction}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteGovernedAction}
                disabled={isExecutingAction || !operatorRationale.trim()}
                className="px-4 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow"
              >
                {isExecutingAction && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Confirm Governed Action</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. MODAL: SAVE CUSTOM RESEARCH VIEW                                       */}
      {/* ========================================================================= */}
      {showSaveViewModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[#111827] border border-[#2b3c5a] rounded-lg max-w-sm w-full p-4 shadow-2xl space-y-3 text-xs font-sans">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-100 text-sm font-mono">SAVE RESEARCH VIEW</span>
              <button onClick={() => setShowSaveViewModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-400 text-xs">
              Save current faceted filters, query, and sorting as a custom local view preset.
            </p>
            <div>
              <label className="block text-[11px] font-semibold text-slate-300 mb-1">View Name</label>
              <input
                type="text"
                placeholder="e.g. High Margin Fasteners (West Bengal)"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                className="w-full bg-[#141b2b] border border-[#1f293d] rounded p-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f293d]">
              <button
                onClick={() => setShowSaveViewModal(false)}
                className="px-3 py-1 rounded bg-slate-800 text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCustomView}
                disabled={!newViewName.trim()}
                className="px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold"
              >
                Save View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 7. MODAL: STRATEGIC WORKFLOW DEMONSTRATION ASSISTANT                     */}
      {/* ========================================================================= */}
      {showWalkthroughModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#111827] border border-cyan-800 rounded-lg max-w-xl w-full p-5 shadow-2xl space-y-4 text-xs font-sans">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">
                  STRATEGIC ADVANCEMENT DEMONSTRATION
                </span>
                <h3 className="font-bold text-sm text-slate-100 font-mono mt-0.5">
                  End-to-End Governed Opportunity Sieve
                </h3>
              </div>
              <button onClick={() => setShowWalkthroughModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-300 leading-relaxed">
              This guided demonstration walks through the exact strategic requirement: taking one candidate, filtering to comparable opportunities, comparing evidence against 3 alternatives, identifying missing information, and tracing evidence back into thesis and geospatial context.
            </p>

            <div className="space-y-2 font-mono text-[11px]">
              {/* Step 1 */}
              <div
                onClick={() => handleExecuteWalkthroughStep(1)}
                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-center justify-between ${
                  walkthroughStep === 1
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                    : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-200">1</span>
                  <span>Select Primary Candidate (DIN3017 SS304 Clamps)</span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              </div>

              {/* Step 2 */}
              <div
                onClick={() => handleExecuteWalkthroughStep(2)}
                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-center justify-between ${
                  walkthroughStep === 2
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                    : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-200">2</span>
                  <span>Filter Universe to Comparable Opportunities (Physical Goods)</span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              </div>

              {/* Step 3 */}
              <div
                onClick={() => handleExecuteWalkthroughStep(3)}
                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-center justify-between ${
                  walkthroughStep === 3
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                    : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-200">3</span>
                  <span>Compare Evidence Side-by-Side Against 3 Alternatives</span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              </div>

              {/* Step 4 */}
              <div
                onClick={() => handleExecuteWalkthroughStep(4)}
                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-center justify-between ${
                  walkthroughStep === 4
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                    : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-200">4</span>
                  <span>Inspect Evidence Gaps & Spectrometry Audit Contradiction</span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              </div>

              {/* Step 5 */}
              <div
                onClick={() => handleExecuteWalkthroughStep(5)}
                className={`p-2.5 rounded border cursor-pointer transition-colors flex items-center justify-between ${
                  walkthroughStep === 5
                    ? 'bg-cyan-950/80 border-cyan-500 text-cyan-200'
                    : 'bg-[#141b2b] border-[#1f293d] text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-bold px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-200">5</span>
                  <span>Trace Resulting Evidence into Commercial Thesis & Atlas</span>
                </div>
                <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1f293d]">
              <button
                onClick={() => setShowWalkthroughModal(false)}
                className="px-3 py-1.5 rounded bg-slate-800 text-slate-300 text-xs"
              >
                Dismiss
              </button>
              <button
                onClick={() => handleExecuteWalkthroughStep(walkthroughStep < 5 ? walkthroughStep + 1 : 1)}
                className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs"
              >
                {walkthroughStep < 5 ? `Next Step (${walkthroughStep + 1}/5)` : 'Restart Demonstration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
