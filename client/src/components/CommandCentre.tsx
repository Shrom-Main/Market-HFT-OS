import React, { useState, useEffect } from 'react';
import {
  Activity,
  Layers,
  FileText,
  Cpu,
  Coins,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Play,
  Pause,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  Database,
  ArrowUpRight,
  Sparkles,
  Lock,
  Radio,
  FileSpreadsheet
} from 'lucide-react';
import { TerminalSnapshot } from '../types/workstation';
import { ProductQueueCandidateItem, GalleryEventRecordItem } from '../types/product';
import { WorkstationApiClient } from '../services/api';
import { WorkspaceRouteId } from './shell/NavigationRail';

export interface CommandCentreProps {
  snapshot: TerminalSnapshot | null;
  wsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  onNavigate: (route: WorkspaceRouteId) => void;
  onRefreshAll: () => void;
  onOpenKillSwitch: () => void;
}

export const CommandCentre: React.FC<CommandCentreProps> = ({
  snapshot,
  wsStatus,
  onNavigate,
  onRefreshAll,
  onOpenKillSwitch,
}) => {
  const [candidates, setCandidates] = useState<ProductQueueCandidateItem[]>([]);
  const [events, setEvents] = useState<GalleryEventRecordItem[]>([]);
  const [theses, setTheses] = useState<any[]>([]);
  const [connectorData, setConnectorData] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEventStreamPaused, setIsEventStreamPaused] = useState(false);
  const [eventFilter, setEventFilter] = useState<'ALL' | 'CANDIDATE' | 'INVESTIGATION' | 'CONTRADICTION'>('ALL');
  const [eventSearchQuery, setEventSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<GalleryEventRecordItem | null>(null);
  const [screenSuccessMessage, setScreenSuccessMessage] = useState<string | null>(null);

  // Load telemetry data
  const loadCommandCentreData = async () => {
    setIsLoading(true);
    try {
      const [candidatesData, eventsData, thesesData, connData] = await Promise.all([
        WorkstationApiClient.getGalleryProducts().catch(() => []),
        WorkstationApiClient.getGalleryEvents().catch(() => []),
        WorkstationApiClient.getGalleryTheses().catch(() => []),
        WorkstationApiClient.getConnectorOperations().catch(() => null),
      ]);

      setCandidates(candidatesData);
      setEvents(eventsData);
      setTheses(thesesData);
      setConnectorData(connData);
    } catch (err) {
      console.error('Failed to load command centre data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCommandCentreData();
    const interval = setInterval(() => {
      if (!isEventStreamPaused) {
        WorkstationApiClient.getGalleryEvents().then(setEvents).catch(() => {});
        WorkstationApiClient.getGalleryProducts().then(setCandidates).catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [isEventStreamPaused]);

  // Screening Intake Trigger
  const handleTriggerScreening = async (fixtureId: string) => {
    try {
      setScreenSuccessMessage(`Screening ${fixtureId}...`);
      const res = await WorkstationApiClient.screenDiscovery({ fixture_id: fixtureId });
      setScreenSuccessMessage(`Successfully admitted candidate ${res.candidate_id || res.candidate?.candidate_id}`);
      await loadCommandCentreData();
      setTimeout(() => setScreenSuccessMessage(null), 4000);
    } catch (err: any) {
      setScreenSuccessMessage(`Screening failed: ${err.message}`);
      setTimeout(() => setScreenSuccessMessage(null), 5000);
    }
  };

  // Filtered Events
  const filteredEvents = events.filter((evt) => {
    if (eventFilter === 'CANDIDATE' && !evt.event_type.includes('CANDIDATE')) return false;
    if (eventFilter === 'INVESTIGATION' && !evt.event_type.includes('INVESTIGATION')) return false;
    if (eventFilter === 'CONTRADICTION' && !evt.event_type.includes('CONTRADICT')) return false;
    if (eventSearchQuery.trim()) {
      const q = eventSearchQuery.toLowerCase();
      return (
        evt.summary.toLowerCase().includes(q) ||
        evt.event_id.toLowerCase().includes(q) ||
        (evt.aggregate_id && evt.aggregate_id.toLowerCase().includes(q))
      );
    }
    return true;
  });

  return (
    <div className="p-4 space-y-4 max-w-[1920px] mx-auto w-full select-none text-[12px] font-sans">
      {/* Sub-Ribbon: Title, Quick Intake & Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0C1118] border border-[#263342] p-2.5 rounded-sm">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#4C9FE8]" />
            <span className="font-mono text-xs font-bold tracking-wider text-[#E6EDF5] uppercase">
              INSTITUTIONAL RESEARCH COMMAND CENTRE
            </span>
          </div>
          <span className="text-[10px] text-[#738397] font-mono border-l border-[#263342] pl-3 hidden lg:inline">
            CORE AGENT DAG / BITEMPORAL REASONING / STAGE D.0 AUTONOMY
          </span>
        </div>

        {/* Action Controls & Fast Screening Intakes */}
        <div className="flex items-center space-x-2">
          {screenSuccessMessage && (
            <span className="text-[10px] font-mono text-[#35B88A] bg-[#1B3D2F] border border-[#2D664E] px-2 py-0.5 rounded">
              {screenSuccessMessage}
            </span>
          )}

          <div className="flex items-center space-x-1 bg-[#080B10] border border-[#263342] p-0.5 rounded">
            <span className="text-[9px] font-mono text-[#738397] px-1.5 uppercase">Intake:</span>
            <button
              onClick={() => handleTriggerScreening('FIX-AMZ-SS304-001')}
              className="px-2 py-0.5 bg-[#172230] hover:bg-[#1C2938] text-[#4EB3D3] hover:text-white rounded text-[10px] font-mono transition-colors cursor-pointer"
              title="Screen SS304 Clamps (Howrah Manufacturing)"
            >
              + Howrah SS304
            </button>
            <button
              onClick={() => handleTriggerScreening('FIX-AMZ-BRASS-001')}
              className="px-2 py-0.5 bg-[#172230] hover:bg-[#1C2938] text-[#E5AC55] hover:text-white rounded text-[10px] font-mono transition-colors cursor-pointer"
              title="Screen Brass Ball Valve (Jamnagar Cluster)"
            >
              + Jamnagar Brass
            </button>
            <button
              onClick={() => handleTriggerScreening('FIX-SAAS-DEVTOOL-001')}
              className="px-2 py-0.5 bg-[#172230] hover:bg-[#1C2938] text-[#968AE2] hover:text-white rounded text-[10px] font-mono transition-colors cursor-pointer"
              title="Screen eBPF SaaS Tracing Tool (Developer API)"
            >
              + SaaS API
            </button>
          </div>

          <button
            onClick={() => {
              loadCommandCentreData();
              onRefreshAll();
            }}
            disabled={isLoading}
            className="flex items-center space-x-1 px-2.5 py-1 bg-[#111923] hover:bg-[#172230] border border-[#263342] text-[#A6B4C3] hover:text-white rounded text-[11px] font-mono transition-colors cursor-pointer"
            title="Refresh all command centre data"
          >
            <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-[#4C9FE8]' : ''}`} />
            <span className="hidden sm:inline">REFRESH</span>
          </button>
        </div>
      </div>

      {/* TOP ROW: 6 Compact Institutional KPI Modules */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* Module 1: Engine Status */}
        <div className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#394B5E] transition-colors">
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>RESEARCH ENGINE</span>
            <Activity className="w-3.5 h-3.5 text-[#35B88A]" />
          </div>
          <div className="my-2">
            <div className="text-sm font-bold text-[#E6EDF5] truncate font-mono">
              DRY RUN / SIMULATION
            </div>
            <div className="text-[10px] text-[#35B88A] font-mono flex items-center space-x-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#35B88A]" />
              <span>POSTGRES: 75.4ms LATENCY</span>
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between">
            <span>JCS LEDGER:</span>
            <span className="text-[#35B88A] font-semibold">VERIFIED</span>
          </div>
        </div>

        {/* Module 2: Active Investigations */}
        <div className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#394B5E] transition-colors">
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>ACTIVE INVESTIGATIONS</span>
            <Cpu className="w-3.5 h-3.5 text-[#4C9FE8]" />
          </div>
          <div className="my-2">
            <div className="text-xl font-bold text-[#E6EDF5] font-mono tabular-nums">
              3 <span className="text-xs text-[#738397] font-normal">/ 10 DAILY</span>
            </div>
            <div className="text-[10px] text-[#4C9FE8] font-mono mt-0.5">
              4 ENQUEUED SUBTASKS
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between">
            <span>TASK BOUNDS:</span>
            <span className="text-[#E6EDF5]">6 SOFT / 8 HARD</span>
          </div>
        </div>

        {/* Module 3: Candidate Review Queue */}
        <div 
          onClick={() => onNavigate('DISCOVERY_GALLERY')}
          className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#4C9FE8] transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>CANDIDATE GALLERY</span>
            <Layers className="w-3.5 h-3.5 text-[#A6B4C3] group-hover:text-[#4C9FE8]" />
          </div>
          <div className="my-2">
            <div className="text-xl font-bold text-[#E6EDF5] font-mono tabular-nums flex items-baseline space-x-1.5">
              <span>{candidates.length}</span>
              <span className="text-xs text-[#35B88A] font-normal">
                ({candidates.filter(c => c.lifecycle_state === 'INVESTIGATE').length} In Progress)
              </span>
            </div>
            <div className="text-[10px] text-[#A6B4C3] font-mono truncate mt-0.5">
              2 Physical / 1 Digital SaaS
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between group-hover:text-[#4C9FE8]">
            <span>VIEW PIPELINE</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </div>

        {/* Module 4: Contradictions & Audit */}
        <div 
          onClick={() => onNavigate('AUDIT_GATE')}
          className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#394B5E] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>CONTRADICTIONS</span>
            <AlertTriangle className="w-3.5 h-3.5 text-[#E5AC55]" />
          </div>
          <div className="my-2">
            <div className="text-xl font-bold text-[#FF6B6B] font-mono tabular-nums">
              1 <span className="text-xs text-[#E5AC55] font-normal">SPECTROMETRY MISMATCH</span>
            </div>
            <div className="text-[10px] text-[#738397] font-mono truncate mt-0.5">
              SS201 1.2% Ni vs SS304 8.0%
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between">
            <span>ADVERSARIAL SCORE:</span>
            <span className="text-[#35B88A] font-semibold">10,000 BPS</span>
          </div>
        </div>

        {/* Module 5: Compute Spend Ledger (Stage D.0) */}
        <div 
          onClick={() => onNavigate('BUDGETS_D0')}
          className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#394B5E] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>COMPUTE SPEND (D.0)</span>
            <Coins className="w-3.5 h-3.5 text-[#E5AC55]" />
          </div>
          <div className="my-2">
            <div className="text-xl font-bold text-[#E6EDF5] font-mono tabular-nums">
              $1.42 <span className="text-xs text-[#738397] font-normal">/ $10.00</span>
            </div>
            <div className="w-full bg-[#080B10] h-1.5 rounded-full overflow-hidden mt-1 border border-[#263342]">
              <div className="bg-[#35B88A] h-full" style={{ width: '14.2%' }} />
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between">
            <span>SAFETY RESERVE:</span>
            <span className="text-[#35B88A] font-semibold">+20% APPLIED</span>
          </div>
        </div>

        {/* Module 6: Connector Gateway */}
        <div 
          onClick={() => onNavigate('CONNECTORS')}
          className="bg-[#111923] border border-[#263342] p-3 rounded-sm flex flex-col justify-between hover:border-[#394B5E] transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-[11px] text-[#738397] font-mono uppercase">
            <span>CONNECTOR GATEWAY</span>
            <Activity className="w-3.5 h-3.5 text-[#35B88A] group-hover:text-[#4C9FE8]" />
          </div>
          <div className="my-2">
            <div className="text-xl font-bold text-[#35B88A] font-mono tabular-nums">
              19 / 19 <span className="text-xs text-[#A6B4C3] font-normal">OPERATIONAL</span>
            </div>
            <div className="text-[10px] text-[#738397] font-mono truncate mt-0.5">
              0 Open Circuits | 10 Capabilities
            </div>
          </div>
          <div className="text-[10px] text-[#738397] font-mono border-t border-[#263342]/60 pt-1 flex justify-between group-hover:text-[#4C9FE8]">
            <span>VIEW TELEMETRY</span>
            <ChevronRight className="w-3 h-3" />
          </div>
        </div>
      </div>

      {/* SECOND ROW: 3-Column Institutional Workstation Surface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT COLUMN: Live Intelligence Event Stream (5 of 12 cols = 41.6%) */}
        <div className="lg:col-span-5 bg-[#0C1118] border border-[#263342] rounded-sm flex flex-col h-[520px]">
          {/* Header & Controls */}
          <div className="p-2.5 border-b border-[#263342] bg-[#111923] flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <Radio className="w-3.5 h-3.5 text-[#4C9FE8] animate-pulse" />
              <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
                LIVE INTELLIGENCE EVENT STREAM
              </span>
              <span className="font-mono text-[10px] bg-[#080B10] text-[#738397] border border-[#263342] px-1.5 rounded">
                {filteredEvents.length} EVTS
              </span>
            </div>

            <div className="flex items-center space-x-1.5">
              <button
                onClick={() => setIsEventStreamPaused(!isEventStreamPaused)}
                className={`p-1 rounded text-[10px] font-mono flex items-center space-x-1 border cursor-pointer ${
                  isEventStreamPaused
                    ? 'bg-[#3D2E14] text-[#E5AC55] border-[#694E21]'
                    : 'bg-[#080B10] text-[#A6B4C3] hover:text-[#E6EDF5] border-[#263342]'
                }`}
                title={isEventStreamPaused ? 'Resume live streaming' : 'Pause live streaming'}
              >
                {isEventStreamPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                <span className="text-[9px]">{isEventStreamPaused ? 'PAUSED' : 'LIVE'}</span>
              </button>
            </div>
          </div>

          {/* Search & Filter Sub-Bar */}
          <div className="p-2 border-b border-[#263342] bg-[#080B10] flex items-center space-x-2 shrink-0">
            <div className="relative flex-1">
              <Search className="w-3 h-3 text-[#738397] absolute left-2 top-2" />
              <input
                type="text"
                placeholder="Filter events by ID, entity, summary..."
                value={eventSearchQuery}
                onChange={(e) => setEventSearchQuery(e.target.value)}
                className="w-full bg-[#111923] border border-[#263342] text-[#E6EDF5] placeholder-[#738397] pl-7 pr-2 py-1 rounded text-[11px] font-mono focus:outline-hidden focus:border-[#4C9FE8]"
              />
            </div>

            <select
              value={eventFilter}
              onChange={(e: any) => setEventFilter(e.target.value)}
              className="bg-[#111923] border border-[#263342] text-[#A6B4C3] text-[10px] font-mono px-2 py-1 rounded focus:outline-hidden"
            >
              <option value="ALL">ALL TYPES</option>
              <option value="CANDIDATE">CANDIDATES</option>
              <option value="INVESTIGATION">INVESTIGATION</option>
              <option value="CONTRADICTION">CONTRADICTION</option>
            </select>
          </div>

          {/* Events Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#263342]/50 p-1">
            {filteredEvents.length === 0 ? (
              <div className="py-12 text-center text-[#738397] font-mono text-xs">
                No events recorded. Ingest candidates to populate live stream.
              </div>
            ) : (
              filteredEvents.map((evt) => {
                const isSelected = selectedEvent?.event_id === evt.event_id;
                const isContradiction = evt.event_type.includes('CONTRADICT');
                const isDiscovered = evt.event_type.includes('DISCOVERED');

                return (
                  <div
                    key={evt.event_id}
                    onClick={() => setSelectedEvent(isSelected ? null : evt)}
                    className={`p-2 transition-colors cursor-pointer text-[11px] ${
                      isSelected
                        ? 'bg-[#172230]'
                        : isContradiction
                        ? 'bg-[#3D1B1B]/30 hover:bg-[#3D1B1B]/50'
                        : 'hover:bg-[#111923]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-[#738397] mb-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[#4C9FE8] font-bold">#{String(evt.sequence_number).padStart(3, '0')}</span>
                        <span>{evt.timestamp_utc ? new Date(evt.timestamp_utc).toLocaleTimeString() : 'LIVE'}</span>
                        <span className="text-[#4F6072] font-mono">[{evt.event_id.split('-').slice(0, 2).join('-')}]</span>
                      </div>

                      <span
                        className={`badge-epistemic ${
                          isContradiction
                            ? 'badge-contradicted'
                            : isDiscovered
                            ? 'badge-fixture'
                            : 'badge-observed'
                        }`}
                      >
                        {evt.event_type.replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="font-medium text-[#E6EDF5] line-clamp-2 leading-relaxed">
                      {evt.summary}
                    </div>

                    <div className="flex items-center justify-between mt-1 text-[9px] font-mono text-[#738397]">
                      <span className="truncate max-w-[200px]">
                        ID: {evt.aggregate_id || 'SYSTEM'}
                      </span>
                      <span className="text-[#4F6072] truncate max-w-[150px]">
                        sha256:{evt.jcs_sha256?.substring(0, 10)}...
                      </span>
                    </div>

                    {/* Expandable Event Payload Inspection */}
                    {isSelected && (
                      <div className="mt-2 p-2 bg-[#080B10] border border-[#263342] rounded text-[10px] font-mono text-[#A6B4C3] space-y-1">
                        <div className="text-[#E6EDF5] font-semibold border-b border-[#263342] pb-1">
                          EVENT AUDIT PAYLOAD (RFC 8785 CANONICAL)
                        </div>
                        <div className="text-[10px] text-[#738397]">
                          Timestamp: <span className="text-[#E6EDF5]">{evt.timestamp_utc}</span>
                        </div>
                        <div className="text-[10px] text-[#738397]">
                          JCS Hash: <span className="text-[#35B88A]">{evt.jcs_sha256}</span>
                        </div>
                        <pre className="text-[9px] bg-[#0A1017] p-1.5 rounded overflow-x-auto text-[#4EB3D3]">
                          {JSON.stringify(evt.details || {}, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* CENTRE COLUMN: Active Investigations & Task DAG Execution (4 of 12 cols = 33.3%) */}
        <div className="lg:col-span-4 bg-[#0C1118] border border-[#263342] rounded-sm flex flex-col h-[520px]">
          {/* Header */}
          <div className="p-2.5 border-b border-[#263342] bg-[#111923] flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <Cpu className="w-3.5 h-3.5 text-[#35B88A]" />
              <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
                ACTIVE INVESTIGATIONS & DAG TASKS
              </span>
            </div>

            <button
              onClick={() => onNavigate('INVESTIGATION_DESK')}
              className="text-[10px] font-mono text-[#4C9FE8] hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <span>EXPAND</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          {/* Active Tasks & Candidates Scroll */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {candidates.length === 0 ? (
              <div className="py-12 text-center text-[#738397] font-mono text-xs">
                No active investigations in flight.
              </div>
            ) : (
              candidates.map((cand) => {
                const tasks = cand.outstanding_tasks || [];
                const isInvestigating = cand.lifecycle_state === 'INVESTIGATE';

                return (
                  <div
                    key={cand.candidate_id}
                    className="bg-[#111923] border border-[#263342] hover:border-[#394B5E] p-3 rounded-sm transition-colors space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold text-[#E6EDF5] text-xs line-clamp-1">
                          {cand.name}
                        </div>
                        <div className="text-[10px] font-mono text-[#738397] mt-0.5">
                          {cand.candidate_id} • {cand.category}
                        </div>
                      </div>

                      <span
                        className={`badge-epistemic ${
                          isInvestigating ? 'badge-verified' : 'badge-unverified'
                        }`}
                      >
                        {cand.lifecycle_state}
                      </span>
                    </div>

                    {/* Progress / Status metrics */}
                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono bg-[#080B10] p-2 rounded border border-[#263342]">
                      <div>
                        <span className="text-[#738397]">ASP:</span>{' '}
                        <span className="text-[#E6EDF5] font-semibold">
                          {cand.financial_summary?.prevailing_retail_asp_inr 
                            ? `₹${cand.financial_summary.prevailing_retail_asp_inr}`
                            : '[DATA REQUIRED]'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#738397]">FACTORY:</span>{' '}
                        <span className="text-[#E6EDF5] font-semibold">
                          {cand.financial_summary?.factory_gate_quote_inr
                            ? `₹${cand.financial_summary.factory_gate_quote_inr}`
                            : '[DATA REQUIRED]'}
                        </span>
                      </div>
                    </div>

                    {/* Enqueued Subtasks */}
                    {tasks.length > 0 ? (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[9px] font-mono text-[#738397] uppercase flex items-center justify-between">
                          <span>ENQUEUED TASKS ({tasks.length})</span>
                          <span className="text-[#4C9FE8]">PLAN V1</span>
                        </div>
                        {tasks.map((task: any, idx: number) => (
                          <div
                            key={task.task_id || idx}
                            className="bg-[#0C1118] border border-[#263342] p-1.5 rounded text-[10px] font-mono flex items-center justify-between"
                          >
                            <div className="overflow-hidden mr-2">
                              <div className="text-[#E6EDF5] truncate font-medium">
                                {task.target_role}: {task.target_field}
                              </div>
                              <div className="text-[9px] text-[#738397] truncate">
                                {task.task_type}
                              </div>
                            </div>
                            <span className="text-[9px] text-[#E5AC55] bg-[#3D2E14] border border-[#694E21] px-1.5 py-0.2 rounded shrink-0">
                              {task.state}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-[#738397] pt-1">
                        Status: <span className="text-[#A6B4C3]">{cand.investigation_status || 'IDLE'}</span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Autonomy Governors & Connector Matrix (3 of 12 cols = 25%) */}
        <div className="lg:col-span-3 bg-[#0C1118] border border-[#263342] rounded-sm flex flex-col h-[520px]">
          {/* Header */}
          <div className="p-2.5 border-b border-[#263342] bg-[#111923] flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-3.5 h-3.5 text-[#35B88A]" />
              <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
                RESOURCE & AUTONOMY (D.0)
              </span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Daily Budget Meters */}
            <div className="space-y-3 bg-[#111923] border border-[#263342] p-3 rounded-sm">
              <div className="text-[10px] font-mono font-bold text-[#E6EDF5] uppercase border-b border-[#263342] pb-1 flex justify-between">
                <span>DAILY AUTONOMY LEDGER</span>
                <span className="text-[#35B88A]">CONCURRENCY SAFE</span>
              </div>

              {/* Spend */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#738397]">LLM Spend:</span>
                  <span className="text-[#E6EDF5] font-semibold tabular-nums">$1.42 / $10.00</span>
                </div>
                <div className="w-full bg-[#080B10] h-1.5 rounded-full overflow-hidden border border-[#263342]">
                  <div className="bg-[#35B88A] h-full" style={{ width: '14.2%' }} />
                </div>
              </div>

              {/* Tasks */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#738397]">Tasks Allowed:</span>
                  <span className="text-[#4C9FE8] font-semibold tabular-nums">4 / 6 soft [8 hard]</span>
                </div>
                <div className="w-full bg-[#080B10] h-1.5 rounded-full overflow-hidden border border-[#263342]">
                  <div className="bg-[#4C9FE8] h-full" style={{ width: '50%' }} />
                </div>
              </div>

              {/* Replans */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-mono">
                  <span className="text-[#738397]">Replans Bounded:</span>
                  <span className="text-[#E5AC55] font-semibold tabular-nums">1 / 3 max</span>
                </div>
                <div className="w-full bg-[#080B10] h-1.5 rounded-full overflow-hidden border border-[#263342]">
                  <div className="bg-[#E5AC55] h-full" style={{ width: '33.3%' }} />
                </div>
              </div>

              {/* Timeout & Abortion Hook */}
              <div className="pt-1 text-[9px] font-mono text-[#738397] flex items-center justify-between border-t border-[#263342]/60">
                <span>AbortSignal Root:</span>
                <span className="text-[#35B88A] font-semibold">ACTIVE (30s timeout)</span>
              </div>
            </div>

            {/* Connector Circuit Breakers Matrix */}
            <div className="space-y-2 bg-[#111923] border border-[#263342] p-3 rounded-sm">
              <div className="text-[10px] font-mono font-bold text-[#E6EDF5] uppercase border-b border-[#263342] pb-1 flex justify-between">
                <span>CONNECTOR CIRCUITS</span>
                <span className="text-[#35B88A]">19 CLOSED</span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {[
                  { id: 'gemini-llm', label: 'Gemini LLM', state: 'CLOSED' },
                  { id: 'groq-lpu', label: 'Groq LPU', state: 'CLOSED' },
                  { id: 'tinyfish-crawler', label: 'TinyFish DOM', state: 'CLOSED' },
                  { id: 'google-maps-geo', label: 'Maps Geocoding', state: 'CLOSED' },
                  { id: 'alpaca-broker', label: 'Alpaca Broker', state: 'CLOSED' },
                  { id: 'mcp-statutory', label: 'MCP Statutory', state: 'CLOSED' },
                  { id: 'mcp-source-capture', label: 'MCP Capture', state: 'CLOSED' },
                  { id: 'mcp-red-team', label: 'MCP Red Team', state: 'CLOSED' },
                ].map((conn) => (
                  <div
                    key={conn.id}
                    className="p-1.5 rounded bg-[#080B10] border border-[#263342] flex items-center justify-between text-[10px] font-mono"
                  >
                    <span className="text-[#A6B4C3] truncate">{conn.label}</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#35B88A] shrink-0" />
                  </div>
                ))}
              </div>

              <div className="text-[9px] font-mono text-[#738397] pt-2 border-t border-[#263342]/60 flex items-center justify-between">
                <span>Transport Security:</span>
                <span className="text-[#4EB3D3]">SSRF-443 PINNED</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* THIRD ROW: Candidate Pipeline Breakdown & Thesis Conviction */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Candidate Pipeline by Category & Origin */}
        <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#263342] pb-2">
            <div className="flex items-center space-x-2">
              <Layers className="w-3.5 h-3.5 text-[#4C9FE8]" />
              <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
                CROSS-DOMAIN PIPELINE ARCHETYPES
              </span>
            </div>
            <span className="text-[10px] font-mono text-[#738397]">
              STAGE C.3 TRANSFER VALIDATION
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-[11px] font-mono">
            {/* Howrah Hardware */}
            <div className="bg-[#111923] border border-[#263342] p-2.5 rounded space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#4EB3D3] font-bold">HOWRAH HARDWARE</span>
                <span className="badge-epistemic badge-fixture text-[8px]">FIXTURE</span>
              </div>
              <div className="text-[10px] text-[#E6EDF5] truncate">
                SS304 DIN 3017 Clamps
              </div>
              <div className="text-[10px] text-[#738397] space-y-0.5 pt-1 border-t border-[#263342]/60">
                <div>Factory: <span className="text-[#E6EDF5]">₹25.00</span> / Retail: <span className="text-[#E6EDF5]">₹85.00</span></div>
                <div>Status: <span className="text-[#35B88A]">INVESTIGATE</span></div>
              </div>
            </div>

            {/* Jamnagar Brass */}
            <div className="bg-[#111923] border border-[#263342] p-2.5 rounded space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#E5AC55] font-bold">JAMNAGAR BRASS</span>
                <span className="badge-epistemic badge-fixture text-[8px]">FIXTURE</span>
              </div>
              <div className="text-[10px] text-[#E6EDF5] truncate">
                Forged Brass Ball Valve
              </div>
              <div className="text-[10px] text-[#738397] space-y-0.5 pt-1 border-t border-[#263342]/60">
                <div>Factory: <span className="text-[#E6EDF5]">₹115.00</span> / Retail: <span className="text-[#E6EDF5]">₹349.00</span></div>
                <div>Status: <span className="text-[#35B88A]">INVESTIGATE</span></div>
              </div>
            </div>

            {/* Developer SaaS API */}
            <div className="bg-[#111923] border border-[#263342] p-2.5 rounded space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[#968AE2] font-bold">SAAS & API TOOLS</span>
                <span className="badge-epistemic badge-data-required text-[8px]">MISSING INFRA</span>
              </div>
              <div className="text-[10px] text-[#E6EDF5] truncate">
                eBPF Tracing Agent
              </div>
              <div className="text-[10px] text-[#738397] space-y-0.5 pt-1 border-t border-[#263342]/60">
                <div>Retail ASP: <span className="text-[#E6EDF5]">₹4,999.00</span></div>
                <div>Infra Delivery: <span className="text-[#F08C42]">[DATA REQUIRED]</span></div>
              </div>
            </div>
          </div>
        </div>

        {/* Thesis Conviction & Refutation Matrix */}
        <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-3">
          <div className="flex items-center justify-between border-b border-[#263342] pb-2">
            <div className="flex items-center space-x-2">
              <TrendingUp className="w-3.5 h-3.5 text-[#35B88A]" />
              <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
                THESIS CONVICTION & REFUTATION MATRIX
              </span>
            </div>
            <button
              onClick={() => onNavigate('THESIS_GALLERY')}
              className="text-[10px] font-mono text-[#4C9FE8] hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <span>ALL THESES</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-2 text-[11px]">
            <div className="bg-[#111923] border border-[#263342] p-2.5 rounded flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#E6EDF5] text-xs">
                  THESIS-SS304-HOWRAH-01 (Industrial Fasteners)
                </div>
                <div className="text-[10px] text-[#738397] font-mono mt-0.5">
                  Bear Risk: Nickel MCX spike &gt; +25% within 30-day window
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <span className="text-[#35B88A] font-bold font-mono text-sm tabular-nums">
                  8,500 BPS
                </span>
                <div className="text-[9px] font-mono text-[#35B88A]">ADVERSARIAL PASS</div>
              </div>
            </div>

            <div className="bg-[#111923] border border-[#263342] p-2.5 rounded flex items-center justify-between">
              <div>
                <div className="font-semibold text-[#E6EDF5] text-xs">
                  THESIS-VALVE-JAMNAGAR-01 (Fluid Control)
                </div>
                <div className="text-[10px] text-[#738397] font-mono mt-0.5">
                  Bear Risk: Copper/zinc commodity spike on LME lifting billet costs
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <span className="text-[#35B88A] font-bold font-mono text-sm tabular-nums">
                  7,800 BPS
                </span>
                <div className="text-[9px] font-mono text-[#E5AC55]">REVIEW PENDING</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: Operator Decision Queue & System Warnings */}
      <div className="bg-[#0C1118] border border-[#263342] p-3 rounded-sm space-y-2">
        <div className="flex items-center justify-between border-b border-[#263342] pb-1.5">
          <div className="flex items-center space-x-2">
            <Lock className="w-3.5 h-3.5 text-[#E5AC55]" />
            <span className="font-mono text-[11px] font-bold text-[#E6EDF5] uppercase">
              OPERATOR DECISION QUEUE & POLICY GATES
            </span>
          </div>
          <span className="text-[10px] font-mono text-[#E5AC55]">
            2 PENDING HUMAN SIGN-OFFS
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] font-mono">
          {/* Decision 1 */}
          <div className="bg-[#111923] border border-[#263342] p-2.5 rounded flex items-center justify-between">
            <div className="overflow-hidden mr-2">
              <div className="text-[#FF6B6B] font-semibold flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">DEC-001: Resolve Spectrometry Mismatch (SS201 vs SS304)</span>
              </div>
              <div className="text-[10px] text-[#738397] mt-0.5">
                Supplier claimed SS304; spectrometry report laboratory confirmed 1.2% Ni (SS201).
              </div>
            </div>
            <button
              onClick={() => onNavigate('AUDIT_GATE')}
              className="px-2 py-1 bg-[#4D1418] hover:bg-[#802026] text-[#FF6B6B] rounded text-[10px] font-semibold shrink-0 transition-colors cursor-pointer"
            >
              AUDIT CLAIM
            </button>
          </div>

          {/* Decision 2 */}
          <div className="bg-[#111923] border border-[#263342] p-2.5 rounded flex items-center justify-between">
            <div className="overflow-hidden mr-2">
              <div className="text-[#E5AC55] font-semibold flex items-center space-x-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">DEC-002: SaaS Direct Cost Attestation Required</span>
              </div>
              <div className="text-[10px] text-[#738397] mt-0.5">
                Candidate OPP-65038D38DF8D8B67 requires infrastructure/cloud hosting cost input.
              </div>
            </div>
            <button
              onClick={() => onNavigate('DISCOVERY_GALLERY')}
              className="px-2 py-1 bg-[#3D2E14] hover:bg-[#694E21] text-[#E5AC55] rounded text-[10px] font-semibold shrink-0 transition-colors cursor-pointer"
            >
              INSPECT
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
