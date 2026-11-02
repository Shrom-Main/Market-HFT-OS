import React from 'react';
import {
  LayoutDashboard,
  Compass,
  Layers,
  FileText,
  Cpu,
  Building2,
  Activity,
  Radio,
  ShieldCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database
} from 'lucide-react';

export type WorkspaceRouteId =
  | 'COMMAND_CENTRE'
  | 'INTELLIGENCE_ATLAS'
  | 'DISCOVERY_GALLERY'
  | 'THESIS_GALLERY'
  | 'INVESTIGATION_DESK'
  | 'ENTITY_DOSSIERS'
  | 'CONNECTORS'
  | 'SIGNALS_STREAM'
  | 'BUDGETS_D0'
  | 'AUDIT_GATE';

export interface NavigationRailProps {
  currentRoute: WorkspaceRouteId;
  onSelectRoute: (route: WorkspaceRouteId) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  candidatesCount?: number;
  thesesCount?: number;
  eventsCount?: number;
}

interface NavItemConfig {
  id: WorkspaceRouteId;
  label: string;
  shortLabel: string;
  section: 'OVERVIEW' | 'RESEARCH' | 'OPERATIONS' | 'GOVERNANCE';
  icon: React.ComponentType<{ className?: string }>;
  shortcutKey: string;
  badge?: number | string;
}

export const NavigationRail: React.FC<NavigationRailProps> = ({
  currentRoute,
  onSelectRoute,
  isCollapsed,
  onToggleCollapse,
  candidatesCount = 3,
  thesesCount = 1,
  eventsCount = 9,
}) => {
  const navItems: NavItemConfig[] = [
    // OVERVIEW
    {
      id: 'COMMAND_CENTRE',
      label: 'Command Centre',
      shortLabel: 'CMD',
      section: 'OVERVIEW',
      icon: LayoutDashboard,
      shortcutKey: '1',
    },
    // RESEARCH
    {
      id: 'INTELLIGENCE_ATLAS',
      label: 'Intelligence Atlas',
      shortLabel: 'MAP',
      section: 'RESEARCH',
      icon: Compass,
      shortcutKey: '2',
      badge: '8 Hubs',
    },
    {
      id: 'DISCOVERY_GALLERY',
      label: 'Discovery Universe',
      shortLabel: 'CAND',
      section: 'RESEARCH',
      icon: Layers,
      shortcutKey: '3',
      badge: candidatesCount,
    },
    {
      id: 'THESIS_GALLERY',
      label: 'Thesis Intelligence',
      shortLabel: 'THS',
      section: 'RESEARCH',
      icon: FileText,
      shortcutKey: '4',
      badge: thesesCount,
    },
    {
      id: 'INVESTIGATION_DESK',
      label: 'Investigation Workbench',
      shortLabel: 'INV',
      section: 'RESEARCH',
      icon: Cpu,
      shortcutKey: '5',
    },
    {
      id: 'ENTITY_DOSSIERS',
      label: 'Entity Intelligence',
      shortLabel: 'ENT',
      section: 'RESEARCH',
      icon: Building2,
      shortcutKey: '6',
    },
    // OPERATIONS
    {
      id: 'CONNECTORS',
      label: 'Connector Gateway',
      shortLabel: 'CONN',
      section: 'OPERATIONS',
      icon: Activity,
      shortcutKey: '7',
      badge: '19/19',
    },
    {
      id: 'SIGNALS_STREAM',
      label: 'Surveillance Stream',
      shortLabel: 'SURV',
      section: 'OPERATIONS',
      icon: Radio,
      shortcutKey: '8',
      badge: eventsCount,
    },
    // GOVERNANCE
    {
      id: 'BUDGETS_D0',
      label: 'Autonomy & Budgets',
      shortLabel: 'GOV',
      section: 'GOVERNANCE',
      icon: ShieldCheck,
      shortcutKey: '9',
    },
    {
      id: 'AUDIT_GATE',
      label: 'Evidence & Audits',
      shortLabel: 'AUD',
      section: 'GOVERNANCE',
      icon: CheckCircle2,
      shortcutKey: '0',
    },
  ];

  const sections: ('OVERVIEW' | 'RESEARCH' | 'OPERATIONS' | 'GOVERNANCE')[] = [
    'OVERVIEW',
    'RESEARCH',
    'OPERATIONS',
    'GOVERNANCE',
  ];

  return (
    <aside
      className={`bg-[#0C1118] border-r border-[#263342] flex flex-col justify-between transition-all duration-200 select-none z-20 shrink-0 ${
        isCollapsed ? 'w-14' : 'w-56'
      }`}
    >
      {/* Top Navigation Items */}
      <div className="py-2 overflow-y-auto overflow-x-hidden space-y-4">
        {sections.map((section) => {
          const itemsInSection = navItems.filter((item) => item.section === section);
          return (
            <div key={section} className="space-y-0.5">
              {!isCollapsed && (
                <div className="px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-[#738397] font-semibold">
                  {section}
                </div>
              )}

              {itemsInSection.map((item) => {
                const isActive = currentRoute === item.id;
                const IconComponent = item.icon;

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectRoute(item.id)}
                    title={`${item.label} (Alt+${item.shortcutKey})`}
                    className={`w-full flex items-center px-3 py-2 text-[12px] font-sans text-left transition-colors relative group cursor-pointer ${
                      isActive
                        ? 'bg-[#172230] text-[#E6EDF5] font-semibold border-l-2 border-[#4C9FE8]'
                        : 'text-[#A6B4C3] hover:text-[#E6EDF5] hover:bg-[#111923] border-l-2 border-transparent'
                    }`}
                  >
                    <IconComponent
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isActive ? 'text-[#4C9FE8]' : 'text-[#738397] group-hover:text-[#A6B4C3]'
                      }`}
                    />

                    {!isCollapsed && (
                      <div className="ml-2.5 flex-1 flex items-center justify-between overflow-hidden">
                        <span className="truncate">{item.label}</span>
                        <div className="flex items-center space-x-1.5 shrink-0 ml-1">
                          {item.badge !== undefined && (
                            <span
                              className={`px-1.5 py-0.2 rounded font-mono text-[9px] font-medium ${
                                isActive
                                  ? 'bg-[#4C9FE8]/20 text-[#63A9E8] border border-[#4C9FE8]/30'
                                  : 'bg-[#111923] text-[#738397] border border-[#263342]'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                          <span className="text-[9px] font-mono text-[#4F6072] group-hover:text-[#738397]">
                            [{item.shortcutKey}]
                          </span>
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer: Database & Collapse Toggle */}
      <div className="p-2 border-t border-[#263342] space-y-1 bg-[#080B10]">
        {!isCollapsed && (
          <div className="px-2 py-1.5 rounded bg-[#111923] border border-[#263342] flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center space-x-1.5">
              <Database className="w-3 h-3 text-[#35B88A]" />
              <span className="text-[#A6B4C3]">POSTGRES</span>
            </div>
            <span className="text-[#35B88A] font-semibold">2,861 ROWS</span>
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          className="w-full flex items-center justify-center p-1.5 rounded bg-[#111923] hover:bg-[#172230] border border-[#263342] text-[#738397] hover:text-[#E6EDF5] transition-colors cursor-pointer text-[11px]"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <div className="flex items-center space-x-1.5">
              <ChevronLeft className="w-3.5 h-3.5" />
              <span className="text-[11px] font-mono">COLLAPSE RAIL</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  );
};
