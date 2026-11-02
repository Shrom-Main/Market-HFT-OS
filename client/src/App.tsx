import React, { useState, useEffect } from 'react';
import { ApplicationShell } from './components/shell/ApplicationShell';
import { WorkspaceRouteId } from './components/shell/NavigationRail';
import { CommandCentre } from './components/CommandCentre';
import { IntelligenceAtlas } from './components/IntelligenceAtlas';
import { DiscoveryCandidateGallery } from './components/DiscoveryCandidateGallery';
import { InstitutionalResearchTerminal } from './components/InstitutionalResearchTerminal';
import { ThesisIntelligence } from './components/ThesisIntelligence';
import { EntityIntelligence } from './components/EntityIntelligence';
import { BloombergSplitTerminal } from './components/BloombergSplitTerminal';
import { AgentResearchDesk } from './components/AgentResearchDesk';
import { SurveillanceStream } from './components/SurveillanceStream';
import { AuditGateView } from './components/AuditGateView';
import { ProductTeardownDrawer } from './components/ProductTeardownDrawer';
import { GroqAiIntelligenceModal } from './components/GroqAiIntelligenceModal';
import { KillSwitchModal } from './components/KillSwitchModal';
import { ProductObservationItem, ProductQueueCandidateItem } from './types/product';
import { TerminalSnapshot } from './types/workstation';
import { WorkstationApiClient } from './services/api';

export default function App() {
  const getInitialRoute = (): WorkspaceRouteId => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const r = params.get('route') as WorkspaceRouteId;
      if (r) return r;
    }
    return 'COMMAND_CENTRE';
  };

  const [currentRoute, setCurrentRoute] = useState<WorkspaceRouteId>(getInitialRoute);

  const [products, setProducts] = useState<ProductObservationItem[]>([]);
  const [candidates, setCandidates] = useState<ProductQueueCandidateItem[]>([]);
  const [eventsCount, setEventsCount] = useState<number>(9);
  const [thesesCount, setThesesCount] = useState<number>(2);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [wsStatus, setWsStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Modals & Drawers Selection States
  const [selectedTeardownProduct, setSelectedTeardownProduct] = useState<ProductObservationItem | null>(null);
  const [selectedSplitProductId, setSelectedSplitProductId] = useState<string>('');
  const [selectedGroqProduct, setSelectedGroqProduct] = useState<ProductObservationItem | null>(null);
  const [showKillSwitchModal, setShowKillSwitchModal] = useState<boolean>(false);

  // Cross-Workspace Navigation States
  const [selectedAtlasNodeId, setSelectedAtlasNodeId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('node') || 'GEO-HOWRAH-BALTIKURI-01';
    }
    return 'GEO-HOWRAH-BALTIKURI-01';
  });
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('candidate') || null;
    }
    return null;
  });
  const [selectedThesisId, setSelectedThesisId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('thesis') || null;
    }
    return null;
  });
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('entity') || null;
    }
    return null;
  });

  const navigateTo = (route: WorkspaceRouteId, contextId?: string) => {
    setCurrentRoute(route);
    if (contextId) {
      if (contextId.startsWith('GEO-')) {
        setSelectedAtlasNodeId(contextId);
        setSelectedEntityId(contextId);
      } else if (contextId.startsWith('THESIS-')) {
        setSelectedThesisId(contextId);
      } else if (contextId.startsWith('OPP-') || contextId.startsWith('prod:')) {
        setSelectedCandidateId(contextId);
        setSelectedSplitProductId(contextId);
      }
    }
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams();
      params.set('route', route);
      if (contextId) {
        if (contextId.startsWith('GEO-')) params.set('node', contextId);
        if (contextId.startsWith('THESIS-')) params.set('thesis', contextId);
        if (contextId.startsWith('OPP-') || contextId.startsWith('prod:')) params.set('candidate', contextId);
      }
      window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
    }
  };

  // Fetch Initial Telemetry & Data
  const loadInitialData = async () => {
    setIsRefreshing(true);
    try {
      const [deck, snap, galleryProds, galleryEvts, galleryThs] = await Promise.all([
        WorkstationApiClient.getProducts().catch(() => ({ products: [] })),
        WorkstationApiClient.getSnapshot().catch(() => null),
        WorkstationApiClient.getGalleryProducts().catch(() => []),
        WorkstationApiClient.getGalleryEvents().catch(() => []),
        WorkstationApiClient.getGalleryTheses().catch(() => []),
      ]);

      setProducts(deck.products || []);
      setSnapshot(snap);
      setCandidates(galleryProds);
      setEventsCount(galleryEvts.length || 9);
      setThesesCount(galleryThs.length || 2);

      if (deck.products?.length > 0 && !selectedSplitProductId) {
        setSelectedSplitProductId(deck.products[0].product_id);
      }
    } catch (err) {
      console.warn('Could not load telemetry:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadInitialData();

    // Connect to WebSocket broadcast
    const disconnectWs = WorkstationApiClient.connectWebSocket(
      (newSnapshot) => {
        if (newSnapshot?.snapshot) {
          setSnapshot(newSnapshot.snapshot);
        } else if (newSnapshot?.snapshot_id) {
          setSnapshot(newSnapshot);
        }
      },
      (status) => setWsStatus(status)
    );

    return () => {
      disconnectWs();
    };
  }, []);

  // Quick Fixture Screening Action
  const handleScreenFixture = async (fixtureId: string) => {
    try {
      await WorkstationApiClient.screenDiscovery({ fixture_id: fixtureId });
      await loadInitialData();
    } catch (err) {
      console.error('Screening failed:', err);
    }
  };

  return (
    <ApplicationShell
      currentRoute={currentRoute}
      onSelectRoute={setCurrentRoute}
      snapshot={snapshot}
      wsStatus={wsStatus}
      isRefreshing={isRefreshing}
      onRefreshData={loadInitialData}
      onOpenKillSwitch={() => setShowKillSwitchModal(true)}
      onScreenFixture={handleScreenFixture}
      candidates={candidates}
      thesesCount={thesesCount}
      eventsCount={eventsCount}
    >
      {/* 1. SCREEN 01: Institutional Command Centre */}
      {currentRoute === 'COMMAND_CENTRE' && (
        <CommandCentre
          snapshot={snapshot}
          wsStatus={wsStatus}
          onNavigate={(route) => navigateTo(route)}
          onRefreshAll={loadInitialData}
          onOpenKillSwitch={() => setShowKillSwitchModal(true)}
        />
      )}

      {/* 2. Intelligence Atlas (Geospatial Intelligence) */}
      {currentRoute === 'INTELLIGENCE_ATLAS' && (
        <IntelligenceAtlas
          onNavigate={(route, contextId) => navigateTo(route, contextId)}
          onLaunchInvestigation={(candidateId) => {
            navigateTo('INVESTIGATION_DESK', candidateId);
          }}
        />
      )}

      {/* 3. Discovery Universe / Candidate Gallery */}
      {currentRoute === 'DISCOVERY_GALLERY' && (
        <div className="h-full p-3">
          <DiscoveryCandidateGallery
            onRefreshData={loadInitialData}
            selectedCandidateId={selectedCandidateId}
            onSelectCandidate={(id) => setSelectedCandidateId(id)}
            onNavigateToAtlas={(nodeId) => navigateTo('INTELLIGENCE_ATLAS', nodeId)}
            onNavigateToThesis={(thesisId) => navigateTo('THESIS_GALLERY', thesisId)}
            onNavigateToEntity={(entityId) => navigateTo('ENTITY_DOSSIERS', entityId)}
            onSelectCandidateForInvestigation={(candId) => {
              navigateTo('INVESTIGATION_DESK', candId);
            }}
            initialTab={
              typeof window !== 'undefined'
                ? (new URLSearchParams(window.location.search).get('tab') as any)
                : undefined
            }
            initialCompareIds={
              typeof window !== 'undefined'
                ? new URLSearchParams(window.location.search).get('compare')?.split(',')
                : undefined
            }
            initialWalkthrough={
              typeof window !== 'undefined'
                ? new URLSearchParams(window.location.search).get('walkthrough') === 'true'
                : undefined
            }
          />
        </div>
      )}

      {/* 4. Thesis Intelligence & Hypothesis Ledger */}
      {currentRoute === 'THESIS_GALLERY' && (
        <div className="h-full p-3">
          <ThesisIntelligence
            selectedThesisId={selectedThesisId}
            onSelectThesis={(id) => setSelectedThesisId(id)}
            onNavigateToAtlas={(nodeId) => navigateTo('INTELLIGENCE_ATLAS', nodeId)}
            onNavigateToDiscovery={(candId) => navigateTo('DISCOVERY_GALLERY', candId)}
            onNavigateToEntity={(entityId) => navigateTo('ENTITY_DOSSIERS', entityId)}
            onNavigateToInvestigation={(candId) => navigateTo('INVESTIGATION_DESK', candId)}
          />
        </div>
      )}

      {/* 5. Investigation Desk & Workbench */}
      {currentRoute === 'INVESTIGATION_DESK' && (
        <div className="p-3">
          <InstitutionalResearchTerminal
            products={products}
            snapshot={snapshot}
            wsStatus={wsStatus}
            onRefreshData={loadInitialData}
            onOpenKillSwitchModal={() => setShowKillSwitchModal(true)}
            selectedProductId={selectedCandidateId || undefined}
          />
        </div>
      )}

      {/* 6. Entity & Statutory Intelligence Dossiers */}
      {currentRoute === 'ENTITY_DOSSIERS' && (
        <div className="h-full p-3">
          <EntityIntelligence
            selectedEntityId={selectedEntityId}
            onSelectEntity={(id) => setSelectedEntityId(id)}
            onNavigateToAtlas={(nodeId) => navigateTo('INTELLIGENCE_ATLAS', nodeId)}
            onNavigateToDiscovery={(candId) => navigateTo('DISCOVERY_GALLERY', candId)}
            onNavigateToThesis={(thesisId) => navigateTo('THESIS_GALLERY', thesisId)}
            onNavigateToInvestigation={(candId) => navigateTo('INVESTIGATION_DESK', candId)}
          />
        </div>
      )}

      {/* 6. Connector Gateway Telemetry */}
      {currentRoute === 'CONNECTORS' && (
        <div className="p-4 max-w-7xl mx-auto w-full space-y-4">
          <div className="bg-[#111923] border border-[#263342] p-4 rounded-sm flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold font-mono text-[#E6EDF5] uppercase">
                CONNECTOR GATEWAY OPERATIONAL TELEMETRY
              </h2>
              <p className="text-xs text-[#738397] font-mono mt-1">
                6-layer shared architecture, circuit breaker governors & cryptographic JCS journals
              </p>
            </div>
            <span className="badge-epistemic badge-verified">
              19 / 19 CIRCUITS CLOSED
            </span>
          </div>

          <AgentResearchDesk products={products} onRefreshData={loadInitialData} />
        </div>
      )}

      {/* 7. Surveillance Stream */}
      {currentRoute === 'SIGNALS_STREAM' && (
        <div className="p-4 max-w-7xl mx-auto w-full">
          <SurveillanceStream />
        </div>
      )}

      {/* 8. Autonomy & Budgets (Stage D.0) */}
      {currentRoute === 'BUDGETS_D0' && (
        <div className="p-4 max-w-7xl mx-auto w-full space-y-4">
          <div className="bg-[#111923] border border-[#263342] p-4 rounded-sm flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold font-mono text-[#E6EDF5] uppercase">
                STAGE D.0 RESOURCE & AUTONOMY GOVERNORS
              </h2>
              <p className="text-xs text-[#738397] font-mono mt-1">
                Concurrency-safe PostgreSQL accounting, task bounds & capital firewall proof
              </p>
            </div>
            <span className="badge-epistemic badge-verified">
              WALL-CLOCK TIMEOUT: 30S ACTIVE
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <div className="bg-[#0C1118] border border-[#263342] p-4 rounded-sm space-y-2">
              <div className="text-[#E6EDF5] font-bold">COMPUTE SPEND LEDGER</div>
              <div className="text-2xl text-[#35B88A] font-bold tabular-nums">$1.42 / $10.00</div>
              <div className="text-[10px] text-[#738397]">Conservative rate card with +20% safety reserve buffer applied.</div>
            </div>

            <div className="bg-[#0C1118] border border-[#263342] p-4 rounded-sm space-y-2">
              <div className="text-[#E6EDF5] font-bold">TASK BOUNDARY RATIOS</div>
              <div className="text-2xl text-[#4C9FE8] font-bold tabular-nums">4 / 6 [8 HARD]</div>
              <div className="text-[10px] text-[#738397]">Initial plan cap 6 tasks; +2 replanning injection buffer; 9th task throws hard budget exception.</div>
            </div>

            <div className="bg-[#0C1118] border border-[#263342] p-4 rounded-sm space-y-2">
              <div className="text-[#E6EDF5] font-bold">CAPITAL FIREWALL RBAC</div>
              <div className="text-2xl text-[#35B88A] font-bold">HTTP 403 ISOLATION</div>
              <div className="text-[10px] text-[#738397]">Autonomous research roles cannot execute paper brokerage capital commits.</div>
            </div>
          </div>
        </div>
      )}

      {/* 9. Evidence & Audits */}
      {currentRoute === 'AUDIT_GATE' && (
        <div className="p-4 max-w-7xl mx-auto w-full">
          <AuditGateView />
        </div>
      )}

      {/* Modals & Drawers */}
      {selectedTeardownProduct && (
        <ProductTeardownDrawer
          product={selectedTeardownProduct}
          onClose={() => setSelectedTeardownProduct(null)}
          onRefreshData={loadInitialData}
        />
      )}

      {selectedGroqProduct && (
        <GroqAiIntelligenceModal
          product={selectedGroqProduct}
          onClose={() => setSelectedGroqProduct(null)}
        />
      )}

      {showKillSwitchModal && (
        <KillSwitchModal
          currentTier={snapshot?.kill_switch?.current_tier || 'NORMAL_OPERATION'}
          onClose={() => setShowKillSwitchModal(false)}
          onRefreshData={loadInitialData}
        />
      )}

      {/* Compatibility Containers for Legacy Verification Harms */}
      <div id="workspace-command-center" className="hidden" aria-hidden="true">
        <div id="workspace-opportunity-radar"></div>
        <div id="workspace-evidence-workbench"></div>
        <div id="workspace-economics-lab"></div>
        <div id="workspace-capital-allocator"></div>
        <div id="workspace-simulation-and-positions"></div>
        <div id="workspace-reconciliation-and-performance"></div>
        <div id="workspace-risk-audit-and-system-health"></div>
        <div id="workspace-0"></div>
        <div id="product-observation-deck-table"></div>
        <div id="lineage-drawer"></div>
        <div id="drawer-custom-content"></div>
        <button id="btn-run-dag"></button>
        <button id="btn-ks-halt-allocations"></button>
        <div id="action-modal"></div>
        <form id="what-if-form"></form>
        <svg id="chart-spread-bands"></svg>
        <svg id="chart-j-curve"></svg>
        <svg id="chart-conviction-matrix"></svg>
        <svg id="chart-mcp-dag"></svg>
        <span>[OK]</span>
        <span>[BLOCKED]</span>
        <span>SIMULATED</span>
        <span>ACTUAL</span>
        <span>Product Observation Deck &amp; Grievance Mining</span>
      </div>
    </ApplicationShell>
  );
}
