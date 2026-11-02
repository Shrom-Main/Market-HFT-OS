import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
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
  ShieldAlert,
  Sparkles,
  ArrowRight,
  X
} from 'lucide-react';
import { WorkspaceRouteId } from './NavigationRail';
import { ProductQueueCandidateItem } from '../../types/product';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRoute: (route: WorkspaceRouteId) => void;
  onOpenKillSwitch: () => void;
  onScreenFixture: (fixtureId: string) => void;
  candidates: ProductQueueCandidateItem[];
}

interface CommandItem {
  id: string;
  category: 'NAVIGATION' | 'CANDIDATE' | 'ACTION';
  title: string;
  subtitle?: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  action: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onSelectRoute,
  onOpenKillSwitch,
  onScreenFixture,
  candidates,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build command items list
  const baseCommands: CommandItem[] = [
    // Workspaces
    {
      id: 'nav-cmd',
      category: 'NAVIGATION',
      title: 'Command Centre',
      subtitle: 'System overview, live telemetry & active investigations',
      badge: 'NAV',
      icon: LayoutDashboard,
      action: () => {
        onSelectRoute('COMMAND_CENTRE');
        onClose();
      },
    },
    {
      id: 'nav-atlas',
      category: 'NAVIGATION',
      title: 'Intelligence Atlas',
      subtitle: 'Geospatial sourcing clusters, logistics corridors & statutory facilities',
      badge: 'NAV',
      icon: Compass,
      action: () => {
        onSelectRoute('INTELLIGENCE_ATLAS');
        onClose();
      },
    },
    {
      id: 'nav-cand',
      category: 'NAVIGATION',
      title: 'Candidate Gallery',
      subtitle: 'Living multi-domain opportunity candidates & screening queue',
      badge: 'NAV',
      icon: Layers,
      action: () => {
        onSelectRoute('DISCOVERY_GALLERY');
        onClose();
      },
    },
    {
      id: 'nav-ths',
      category: 'NAVIGATION',
      title: 'Thesis Gallery',
      subtitle: 'Formulated commercial theses & refutation tracking',
      badge: 'NAV',
      icon: FileText,
      action: () => {
        onSelectRoute('THESIS_GALLERY');
        onClose();
      },
    },
    {
      id: 'nav-inv',
      category: 'NAVIGATION',
      title: 'Investigation Desk',
      subtitle: 'Adaptive multi-agent reasoning loop & DAG task execution',
      badge: 'NAV',
      icon: Cpu,
      action: () => {
        onSelectRoute('INVESTIGATION_DESK');
        onClose();
      },
    },
    {
      id: 'nav-conn',
      category: 'NAVIGATION',
      title: 'Connector Gateway',
      subtitle: '6-layer gateway health, provider credentials & circuits',
      badge: 'NAV',
      icon: Activity,
      action: () => {
        onSelectRoute('CONNECTORS');
        onClose();
      },
    },
    {
      id: 'nav-gov',
      category: 'NAVIGATION',
      title: 'Autonomy & Budgets',
      subtitle: 'Stage D.0 concurrency-safe resource ledger & task limits',
      badge: 'NAV',
      icon: ShieldCheck,
      action: () => {
        onSelectRoute('BUDGETS_D0');
        onClose();
      },
    },
    // Operator Actions
    {
      id: 'act-ks',
      category: 'ACTION',
      title: 'Trigger Kill Switch Controller',
      subtitle: 'Emergency halt autonomous research or simulation',
      badge: 'EMERGENCY',
      icon: ShieldAlert,
      action: () => {
        onOpenKillSwitch();
        onClose();
      },
    },
    {
      id: 'act-screen-saas',
      category: 'ACTION',
      title: 'Screen DevTool SaaS Fixture',
      subtitle: 'Ingest and evaluate FIX-SAAS-DEVTOOL-001 through screening pipeline',
      badge: 'SCREENING',
      icon: Sparkles,
      action: () => {
        onScreenFixture('FIX-SAAS-DEVTOOL-001');
        onClose();
      },
    },
    {
      id: 'act-screen-howrah',
      category: 'ACTION',
      title: 'Screen Howrah Fastener Fixture',
      subtitle: 'Ingest and evaluate FIX-AMZ-SS304-001 through screening pipeline',
      badge: 'SCREENING',
      icon: Sparkles,
      action: () => {
        onScreenFixture('FIX-AMZ-SS304-001');
        onClose();
      },
    },
    {
      id: 'act-screen-jamnagar',
      category: 'ACTION',
      title: 'Screen Jamnagar Brass Valve Fixture',
      subtitle: 'Ingest and evaluate FIX-AMZ-BRASS-001 through screening pipeline',
      badge: 'SCREENING',
      icon: Sparkles,
      action: () => {
        onScreenFixture('FIX-AMZ-BRASS-001');
        onClose();
      },
    },
  ];

  // Map candidates to command items
  const candidateCommands: CommandItem[] = candidates.map((c) => ({
    id: `cand-${c.candidate_id}`,
    category: 'CANDIDATE',
    title: c.name,
    subtitle: `${c.candidate_id} | ${c.category} | ${c.origin_class}`,
    badge: c.lifecycle_state,
    icon: Layers,
    action: () => {
      onSelectRoute('DISCOVERY_GALLERY');
      onClose();
    },
  }));

  const allItems = [...baseCommands, ...candidateCommands];

  const filteredItems = searchQuery.trim() === ''
    ? allItems
    : allItems.filter(
        (item) =>
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (item.subtitle && item.subtitle.toLowerCase().includes(searchQuery.toLowerCase()))
      );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredItems, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/75 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-2xl bg-[#0C1118] border border-[#394B5E] shadow-2xl rounded-lg overflow-hidden flex flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3 border-b border-[#263342] bg-[#111923]">
          <Search className="w-4 h-4 text-[#738397] mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command, candidate ID, thesis, or action..."
            className="w-full bg-transparent text-[#E6EDF5] placeholder-[#738397] text-sm focus:outline-hidden font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="p-1 text-[#738397] hover:text-[#E6EDF5] mr-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="bg-[#172230] border border-[#263342] text-[#738397] px-2 py-0.5 rounded font-mono text-[10px]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 divide-y divide-[#263342]/40">
          {filteredItems.length === 0 ? (
            <div className="py-8 text-center text-[#738397] text-xs font-mono">
              No matching commands or entities found for "{searchQuery}".
            </div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              const IconComp = item.icon;

              return (
                <div
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between px-3 py-2 rounded text-xs cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-[#172230] text-[#E6EDF5]'
                      : 'text-[#A6B4C3] hover:bg-[#111923] hover:text-[#E6EDF5]'
                  }`}
                >
                  <div className="flex items-center space-x-3 overflow-hidden mr-2">
                    <IconComp
                      className={`w-4 h-4 shrink-0 ${
                        isSelected ? 'text-[#4C9FE8]' : 'text-[#738397]'
                      }`}
                    />
                    <div className="overflow-hidden">
                      <div className="font-medium text-[#E6EDF5] truncate flex items-center space-x-2">
                        <span>{item.title}</span>
                        {item.badge && (
                          <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-[#080B10] text-[#738397] border border-[#263342]">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <div className="text-[11px] text-[#738397] truncate font-mono">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </div>

                  <ArrowRight
                    className={`w-3.5 h-3.5 shrink-0 transition-opacity ${
                      isSelected ? 'opacity-100 text-[#4C9FE8]' : 'opacity-0'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="px-4 py-2 bg-[#080B10] border-t border-[#263342] flex items-center justify-between text-[10px] text-[#738397] font-mono">
          <div className="flex items-center space-x-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span>Market HFT OS Institutional Launcher</span>
        </div>
      </div>
    </div>
  );
};
