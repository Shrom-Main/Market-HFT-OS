import React, { useState } from 'react';
import { TopStatusBar } from './TopStatusBar';
import { NavigationRail, WorkspaceRouteId } from './NavigationRail';
import { CommandPalette } from './CommandPalette';
import { TerminalSnapshot } from '../../types/workstation';
import { ProductQueueCandidateItem } from '../../types/product';

export interface ApplicationShellProps {
  currentRoute: WorkspaceRouteId;
  onSelectRoute: (route: WorkspaceRouteId) => void;
  snapshot: TerminalSnapshot | null;
  wsStatus: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  isRefreshing: boolean;
  onRefreshData: () => void;
  onOpenKillSwitch: () => void;
  onScreenFixture: (fixtureId: string) => void;
  candidates: ProductQueueCandidateItem[];
  thesesCount?: number;
  eventsCount?: number;
  children: React.ReactNode;
}

export const ApplicationShell: React.FC<ApplicationShellProps> = ({
  currentRoute,
  onSelectRoute,
  snapshot,
  wsStatus,
  isRefreshing,
  onRefreshData,
  onOpenKillSwitch,
  onScreenFixture,
  candidates,
  thesesCount = 1,
  eventsCount = 9,
  children,
}) => {
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('palette') === '1';
    }
    return false;
  });

  // Global keyboard shortcuts (Ctrl+K, Alt+1..9)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+K / Cmd+K Command Palette
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // Alt+Number route shortcuts
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const routeMap: Record<string, WorkspaceRouteId> = {
          '1': 'COMMAND_CENTRE',
          '2': 'INTELLIGENCE_ATLAS',
          '3': 'DISCOVERY_GALLERY',
          '4': 'THESIS_GALLERY',
          '5': 'INVESTIGATION_DESK',
          '6': 'ENTITY_DOSSIERS',
          '7': 'CONNECTORS',
          '8': 'SIGNALS_STREAM',
          '9': 'BUDGETS_D0',
          '0': 'AUDIT_GATE',
        };
        if (routeMap[e.key]) {
          e.preventDefault();
          onSelectRoute(routeMap[e.key]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectRoute]);

  // Route Titles & Sections
  const routeMeta: Record<WorkspaceRouteId, { title: string; section: string }> = {
    COMMAND_CENTRE: { title: 'Command Centre', section: 'OVERVIEW' },
    INTELLIGENCE_ATLAS: { title: 'Intelligence Atlas', section: 'RESEARCH' },
    DISCOVERY_GALLERY: { title: 'Discovery Universe', section: 'RESEARCH' },
    THESIS_GALLERY: { title: 'Thesis Intelligence', section: 'RESEARCH' },
    INVESTIGATION_DESK: { title: 'Investigation Workbench', section: 'RESEARCH' },
    ENTITY_DOSSIERS: { title: 'Entity Intelligence', section: 'RESEARCH' },
    CONNECTORS: { title: 'Connector Gateway', section: 'OPERATIONS' },
    SIGNALS_STREAM: { title: 'Surveillance Stream', section: 'OPERATIONS' },
    BUDGETS_D0: { title: 'Autonomy & Budgets', section: 'GOVERNANCE' },
    AUDIT_GATE: { title: 'Evidence & Audits', section: 'GOVERNANCE' },
  };

  const currentMeta = routeMeta[currentRoute] || { title: 'Workstation', section: 'SYSTEM' };

  return (
    <div className="min-h-screen bg-[#080B10] text-[#E6EDF5] flex flex-col font-sans overflow-hidden">
      {/* Persistent Top Operational Status Ribbon */}
      <TopStatusBar
        activeViewTitle={currentMeta.title}
        activeViewSection={currentMeta.section}
        snapshot={snapshot}
        wsStatus={wsStatus}
        isRefreshing={isRefreshing}
        onRefreshData={onRefreshData}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenKillSwitchModal={onOpenKillSwitch}
      />

      {/* Main Layout: Collapsible Rail + Dynamic Workspace Viewport */}
      <div className="flex-1 flex overflow-hidden">
        <NavigationRail
          currentRoute={currentRoute}
          onSelectRoute={onSelectRoute}
          isCollapsed={isRailCollapsed}
          onToggleCollapse={() => setIsRailCollapsed((prev) => !prev)}
          candidatesCount={candidates.length}
          thesesCount={thesesCount}
          eventsCount={eventsCount}
        />

        {/* Workspace Canvas */}
        <main className="flex-1 bg-[#080B10] overflow-y-auto overflow-x-hidden flex flex-col">
          {children}
        </main>
      </div>

      {/* Global Command Palette (Ctrl+K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectRoute={onSelectRoute}
        onOpenKillSwitch={onOpenKillSwitch}
        onScreenFixture={onScreenFixture}
        candidates={candidates}
      />
    </div>
  );
};
