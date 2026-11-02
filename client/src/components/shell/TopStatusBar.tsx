import React, { useState, useEffect } from 'react';
import { 
  Terminal, 
  Search, 
  RefreshCw, 
  ShieldAlert, 
  Wifi, 
  WifiOff, 
  Coins, 
  Clock, 
  ChevronRight,
  SlidersHorizontal,
  Lock
} from 'lucide-react';
import { TerminalSnapshot } from '../../types/workstation';

export interface TopStatusBarProps {
  activeViewTitle: string;
  activeViewSection: string;
  snapshot: TerminalSnapshot | null;
  wsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  isRefreshing: boolean;
  onRefreshData: () => void;
  onOpenCommandPalette: () => void;
  onOpenKillSwitchModal: () => void;
}

export const TopStatusBar: React.FC<TopStatusBarProps> = ({
  activeViewTitle,
  activeViewSection,
  snapshot,
  wsStatus,
  isRefreshing,
  onRefreshData,
  onOpenCommandPalette,
  onOpenKillSwitchModal,
}) => {
  const [currentUtcTime, setCurrentUtcTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentUtcTime(now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const killSwitchTier = snapshot?.kill_switch?.current_tier || 'NORMAL_OPERATION';
  const isKillSwitchActive = killSwitchTier !== 'NORMAL_OPERATION';

  return (
    <header className="h-10 bg-[#0C1118] border-b border-[#263342] px-3 flex items-center justify-between select-none text-[12px] font-sans shrink-0 z-30">
      {/* Left: Branding, Environment & Breadcrumb */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 font-bold tracking-wider text-[#E6EDF5]">
          <Terminal className="w-3.5 h-3.5 text-[#4C9FE8]" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-[#E6EDF5]">
            Market HFT <span className="text-[#4C9FE8]">OS</span>
          </span>
        </div>

        <div className="h-3.5 w-[1px] bg-[#263342]" />

        {/* Operating Mode Tag */}
        <div className="flex items-center space-x-1">
          <span className="badge-epistemic badge-verified text-[9px] px-1.5 py-0.5">
            PAPER SIMULATION
          </span>
          <span className="text-[10px] text-[#738397] hidden xl:inline font-mono">
            ZERO REAL CAPITAL
          </span>
        </div>

        <div className="h-3.5 w-[1px] bg-[#263342] hidden sm:block" />

        {/* Breadcrumb */}
        <div className="hidden sm:flex items-center space-x-1 text-[11px] text-[#738397]">
          <span>{activeViewSection}</span>
          <ChevronRight className="w-3 h-3 text-[#4F6072]" />
          <span className="text-[#E6EDF5] font-medium">{activeViewTitle}</span>
        </div>
      </div>

      {/* Center: Command Palette Trigger & Time */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenCommandPalette}
          className="flex items-center space-x-2 bg-[#080B10] border border-[#263342] hover:border-[#394B5E] text-[#A6B4C3] hover:text-[#E6EDF5] px-2.5 py-1 rounded text-[11px] transition-colors group cursor-pointer"
          title="Open global command launcher (Ctrl+K)"
        >
          <Search className="w-3 h-3 text-[#738397] group-hover:text-[#4C9FE8]" />
          <span className="hidden md:inline text-[11px]">Search candidates, theses, actions...</span>
          <span className="inline md:hidden text-[11px]">Search...</span>
          <kbd className="hidden lg:inline bg-[#172230] border border-[#263342] text-[#738397] group-hover:text-[#A6B4C3] px-1.5 py-0.2 rounded font-mono text-[9px]">
            Ctrl K
          </kbd>
        </button>

        <div className="hidden 2xl:flex items-center space-x-1 text-[11px] text-[#A6B4C3] font-mono tabular-nums">
          <Clock className="w-3 h-3 text-[#738397]" />
          <span>{currentUtcTime}</span>
        </div>
      </div>

      {/* Right: Telemetry, Autonomy Governors, Kill Switch & Controls */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* WebSocket Connection Latency */}
        <div 
          className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[#080B10] border border-[#263342] text-[10px] font-mono"
          title={`WebSocket Status: ${wsStatus}`}
        >
          {wsStatus === 'CONNECTED' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#35B88A] animate-pulse" />
              <span className="text-[#35B88A] font-semibold">LIVE</span>
              <span className="text-[#738397] hidden md:inline">75ms</span>
            </>
          ) : wsStatus === 'CONNECTING' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#E5AC55] animate-ping" />
              <span className="text-[#E5AC55]">SYNC</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#E36C73]" />
              <span className="text-[#E36C73]">OFFLINE</span>
            </>
          )}
        </div>

        {/* Autonomy Budget Meter (Stage D.0) */}
        <div 
          className="hidden lg:flex items-center space-x-2 px-2 py-0.5 rounded bg-[#080B10] border border-[#263342] text-[10px] font-mono"
          title="Daily compute spend ledger with +20% conservative safety reserve buffer"
        >
          <Coins className="w-3 h-3 text-[#E5AC55]" />
          <span className="text-[#738397]">COMPUTE:</span>
          <span className="text-[#E6EDF5] font-semibold tabular-nums">$1.42</span>
          <span className="text-[#738397]">/ $10.00</span>
          <span className="text-[#35B88A] text-[9px]">(14%)</span>
        </div>

        {/* Task Boundary Indicator */}
        <div 
          className="hidden xl:flex items-center space-x-1.5 px-2 py-0.5 rounded bg-[#080B10] border border-[#263342] text-[10px] font-mono"
          title="Task ceilings: Soft limit 6, hard ceiling 8, max replans 3"
        >
          <span className="text-[#738397]">TASKS:</span>
          <span className="text-[#4C9FE8] font-semibold">4</span>
          <span className="text-[#738397]">/6 soft [8 max]</span>
        </div>

        {/* Kill Switch Status Trigger */}
        <button
          onClick={onOpenKillSwitchModal}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors cursor-pointer border ${
            isKillSwitchActive
              ? 'bg-[#4D1418] border-[#802026] text-[#FF6B6B] animate-pulse'
              : 'bg-[#111923] border-[#263342] hover:border-[#394B5E] text-[#8A9AAC] hover:text-[#E6EDF5]'
          }`}
          title="Operator Kill Switch: Halt autonomous research or simulations"
        >
          <ShieldAlert className={`w-3 h-3 ${isKillSwitchActive ? 'text-[#FF6B6B]' : 'text-[#738397]'}`} />
          <span className="hidden sm:inline">
            {isKillSwitchActive ? 'HALTED' : 'KILL SWITCH: DISARMED'}
          </span>
          <span className="inline sm:hidden">
            {isKillSwitchActive ? 'HALT' : 'ARMED'}
          </span>
        </button>

        {/* Manual Refresh */}
        <button
          onClick={onRefreshData}
          disabled={isRefreshing}
          className="p-1 rounded bg-[#080B10] border border-[#263342] hover:border-[#394B5E] text-[#A6B4C3] hover:text-[#E6EDF5] transition-colors cursor-pointer disabled:opacity-50"
          title="Force refresh telemetry snapshot"
        >
          <RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin text-[#4C9FE8]' : ''}`} />
        </button>
      </div>
    </header>
  );
};
