import React from 'react';
import {
  Shield,
  Activity,
  Layers,
  BarChart3,
  Bot,
  Radio,
  FileCheck2,
  Lock,
  Cpu,
  RefreshCw,
  AlertTriangle
} from 'lucide-react';
import { TerminalSnapshot, KillSwitchTier } from '../types/workstation';

interface HeaderProps {
  activeView: 'COCKPIT' | 'BLOOMBERG_TERMINAL' | 'AGENTS_DESK' | 'SIGNALS_STREAM' | 'AUDIT_GATE';
  onSelectView: (view: 'COCKPIT' | 'BLOOMBERG_TERMINAL' | 'AGENTS_DESK' | 'SIGNALS_STREAM' | 'AUDIT_GATE') => void;
  snapshot: TerminalSnapshot | null;
  wsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  onOpenKillSwitchModal: () => void;
  onRefreshData: () => void;
  isRefreshing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onSelectView,
  snapshot,
  wsStatus,
  onOpenKillSwitchModal,
  onRefreshData,
  isRefreshing,
}) => {
  const currentTier: KillSwitchTier = snapshot?.kill_switch?.current_tier || 'NORMAL_OPERATION';
  const isHalted = currentTier !== 'NORMAL_OPERATION';

  return (
    <header className="sticky top-0 z-40 bg-slate-950/90 backdrop-blur-md border-b border-slate-800 shadow-xl">
      {/* Topmost System Telemetry Strip */}
      <div className="px-4 py-1.5 bg-slate-900/60 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-cyan-400 font-bold tracking-wider">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            MARKET HFT OS // AUTONOMOUS WORKSTATION
          </div>
          <span className="text-slate-600">|</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 text-[10px]">
            GATE M7.2 CERTIFIED
          </span>
          <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 text-[10px]">
            PAPER SIMULATION ONLY
          </span>
        </div>

        <div className="flex items-center gap-4 text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Origin Class:</span>
            <span className="text-cyan-300 font-semibold">
              {snapshot?.origin_breakdown?.live_verified_capture_pct ?? 0}% Live
            </span>
            <span className="text-slate-600">/</span>
            <span className="text-amber-300">
              {snapshot?.origin_breakdown?.recorded_golden_fixture_pct ?? 100}% Fixture
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500">Conserved Capital:</span>
            <span className="text-emerald-400 font-bold">
              ₹{((snapshot?.conserved_working_capital_inr ?? 2500000) / 100000).toFixed(2)} Lakhs
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                wsStatus === 'CONNECTED'
                  ? 'bg-emerald-400 shadow-[0_0_8px_#10b981]'
                  : wsStatus === 'CONNECTING'
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-rose-500'
              }`}
            ></span>
            <span className="text-[10px] text-slate-400">
              {wsStatus === 'CONNECTED' ? 'WS LIVE (4310)' : wsStatus}
            </span>
          </div>

          <button
            onClick={onRefreshData}
            disabled={isRefreshing}
            className="hover:text-cyan-400 transition-colors p-1"
            title="Refresh State"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Navigation & Control Tower Bar */}
      <div className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5" role="tablist">
          <button
            role="tab"
            aria-selected={activeView === 'COCKPIT'}
            onClick={() => onSelectView('COCKPIT')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium font-mono transition-all ${
              activeView === 'COCKPIT'
                ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>Opportunity & Grievance Cockpit</span>
          </button>

          <button
            role="tab"
            aria-selected={activeView === 'BLOOMBERG_TERMINAL'}
            onClick={() => onSelectView('BLOOMBERG_TERMINAL')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium font-mono transition-all ${
              activeView === 'BLOOMBERG_TERMINAL'
                ? 'bg-indigo-950/80 text-indigo-200 border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-indigo-400" />
            <span>Bloomberg Split-Terminal</span>
          </button>

          <button
            role="tab"
            aria-selected={activeView === 'AGENTS_DESK'}
            onClick={() => onSelectView('AGENTS_DESK')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium font-mono transition-all ${
              activeView === 'AGENTS_DESK'
                ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Bot className="w-4 h-4 text-emerald-400" />
            <span>Agent Research Desk</span>
          </button>

          <button
            role="tab"
            aria-selected={activeView === 'SIGNALS_STREAM'}
            onClick={() => onSelectView('SIGNALS_STREAM')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium font-mono transition-all ${
              activeView === 'SIGNALS_STREAM'
                ? 'bg-amber-950/80 text-amber-200 border border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <Radio className="w-4 h-4 text-amber-400" />
            <span>Surveillance Feed</span>
          </button>

          <button
            role="tab"
            aria-selected={activeView === 'AUDIT_GATE'}
            onClick={() => onSelectView('AUDIT_GATE')}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium font-mono transition-all ${
              activeView === 'AUDIT_GATE'
                ? 'bg-slate-800 text-white border border-slate-600 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
            }`}
          >
            <FileCheck2 className="w-4 h-4 text-purple-400" />
            <span>Release Gate</span>
          </button>
        </nav>

        {/* Action Controls & Kill-Switch Button */}
        <div className="flex items-center gap-3">
          <button
            onClick={onOpenKillSwitchModal}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
              isHalted
                ? 'bg-rose-950 text-rose-200 border-rose-600 animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                : 'bg-slate-900 hover:bg-rose-950/40 text-slate-300 hover:text-rose-300 border-slate-700 hover:border-rose-700/60'
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${isHalted ? 'text-rose-400' : 'text-slate-400'}`} />
            <span>KILL SWITCH: {currentTier.replace(/_/g, ' ')}</span>
          </button>
        </div>
      </div>
    </header>
  );
};
