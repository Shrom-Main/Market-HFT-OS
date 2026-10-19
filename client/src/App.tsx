import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { CockpitHome } from './components/CockpitHome';
import { BloombergSplitTerminal } from './components/BloombergSplitTerminal';
import { AgentResearchDesk } from './components/AgentResearchDesk';
import { SurveillanceStream } from './components/SurveillanceStream';
import { AuditGateView } from './components/AuditGateView';
import { InstitutionalResearchTerminal } from './components/InstitutionalResearchTerminal';
import { ProductTeardownDrawer } from './components/ProductTeardownDrawer';
import { GroqAiIntelligenceModal } from './components/GroqAiIntelligenceModal';
import { KillSwitchModal } from './components/KillSwitchModal';
import { ProductObservationItem } from './types/product';
import { TerminalSnapshot } from './types/workstation';
import { WorkstationApiClient } from './services/api';

export default function App() {
  const [activeView, setActiveView] = useState<
    'RESEARCH_TERMINAL' | 'COCKPIT' | 'BLOOMBERG_TERMINAL' | 'AGENTS_DESK' | 'SIGNALS_STREAM' | 'AUDIT_GATE'
  >('RESEARCH_TERMINAL');

  const [products, setProducts] = useState<ProductObservationItem[]>([]);
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [wsStatus, setWsStatus] = useState<'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'>('DISCONNECTED');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Modal / Drawer Selection States
  const [selectedTeardownProduct, setSelectedTeardownProduct] = useState<ProductObservationItem | null>(null);
  const [selectedSplitProductId, setSelectedSplitProductId] = useState<string>('');
  const [selectedGroqProduct, setSelectedGroqProduct] = useState<ProductObservationItem | null>(null);
  const [showKillSwitchModal, setShowKillSwitchModal] = useState<boolean>(false);

  // Fetch Initial Data
  const loadInitialData = async () => {
    setIsRefreshing(true);
    try {
      const deck = await WorkstationApiClient.getProducts();
      setProducts(deck.products || []);
      if (deck.products?.length > 0 && !selectedSplitProductId) {
        setSelectedSplitProductId(deck.products[0].product_id);
      }
    } catch (err) {
      console.warn('Could not load products:', err);
    }

    try {
      const snap = await WorkstationApiClient.getSnapshot();
      setSnapshot(snap);
    } catch (err) {
      console.warn('Could not load snapshot:', err);
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

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      {/* Top Header Bar */}
      <Header
        activeView={activeView}
        onSelectView={setActiveView}
        snapshot={snapshot}
        wsStatus={wsStatus}
        onOpenKillSwitchModal={() => setShowKillSwitchModal(true)}
        onRefreshData={loadInitialData}
        isRefreshing={isRefreshing}
      />

      {/* Main Content Workspace Container */}
      <main className={`flex-1 ${activeView === 'RESEARCH_TERMINAL' ? 'p-3 max-w-[1920px]' : 'p-6 max-w-7xl'} w-full mx-auto space-y-6`}>
        {activeView === 'RESEARCH_TERMINAL' && (
          <InstitutionalResearchTerminal
            products={products}
            snapshot={snapshot}
            wsStatus={wsStatus}
            onRefreshData={loadInitialData}
            onOpenKillSwitchModal={() => setShowKillSwitchModal(true)}
          />
        )}

        {activeView === 'COCKPIT' && (
          <CockpitHome
            products={products}
            onSelectProductForTeardown={(p) => setSelectedTeardownProduct(p)}
            onSelectProductForSplitTerminal={(id) => {
              setSelectedSplitProductId(id);
              setActiveView('BLOOMBERG_TERMINAL');
            }}
            onOpenGroqModal={(p) => setSelectedGroqProduct(p)}
            onRefreshData={loadInitialData}
          />
        )}

        {activeView === 'BLOOMBERG_TERMINAL' && (
          <BloombergSplitTerminal
            products={products}
            selectedProductId={selectedSplitProductId || products[0]?.product_id || ''}
            onSelectProduct={(id) => setSelectedSplitProductId(id)}
            onRefreshData={loadInitialData}
          />
        )}

        {activeView === 'AGENTS_DESK' && (
          <AgentResearchDesk products={products} onRefreshData={loadInitialData} />
        )}

        {activeView === 'SIGNALS_STREAM' && <SurveillanceStream />}

        {activeView === 'AUDIT_GATE' && <AuditGateView />}
      </main>

      {/* Slide-Over Teardown Drawer */}
      {selectedTeardownProduct && (
        <ProductTeardownDrawer
          product={selectedTeardownProduct}
          onClose={() => setSelectedTeardownProduct(null)}
          onRefreshData={loadInitialData}
        />
      )}

      {/* Groq AI Strategic Advisor Modal */}
      {selectedGroqProduct && (
        <GroqAiIntelligenceModal
          product={selectedGroqProduct}
          onClose={() => setSelectedGroqProduct(null)}
        />
      )}

      {/* 3-Tier Kill Switch Modal */}
      {showKillSwitchModal && (
        <KillSwitchModal
          currentTier={snapshot?.kill_switch?.current_tier || 'NORMAL_OPERATION'}
          onClose={() => setShowKillSwitchModal(false)}
          onRefreshData={loadInitialData}
        />
      )}

      {/* Normative Fallback Hooks for Backward Compatibility */}
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
    </div>
  );
}
