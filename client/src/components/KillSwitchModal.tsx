import React, { useState } from 'react';
import {
  AlertTriangle,
  X,
  ShieldAlert,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { KillSwitchTier } from '../types/workstation';
import { WorkstationApiClient } from '../services/api';

interface KillSwitchModalProps {
  currentTier: KillSwitchTier;
  onClose: () => void;
  onRefreshData: () => void;
}

export const KillSwitchModal: React.FC<KillSwitchModalProps> = ({
  currentTier,
  onClose,
  onRefreshData,
}) => {
  const [selectedTier, setSelectedTier] = useState<KillSwitchTier>(currentTier);
  const [operatorRationale, setOperatorRationale] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const tiers: Array<{ id: KillSwitchTier; title: string; desc: string; color: string }> = [
    {
      id: 'NORMAL_OPERATION',
      title: 'NORMAL OPERATION',
      desc: 'All simulation, DAG execution, and allocation processing permitted.',
      color: 'border-emerald-500 text-emerald-400 bg-emerald-950/20',
    },
    {
      id: 'HALT_NEW_ALLOCATIONS',
      title: 'TIER 1: HALT NEW ALLOCATIONS',
      desc: 'Halts committing new capital or purchase orders while preserving active research.',
      color: 'border-amber-500 text-amber-400 bg-amber-950/20',
    },
    {
      id: 'HALT_ALL_SIMULATION_PROCESSING',
      title: 'TIER 2: HALT ALL SIMULATION PROCESSING',
      desc: 'Suspends DAG dispatcher waves, worker tools, and live price feeds.',
      color: 'border-orange-500 text-orange-400 bg-orange-950/20',
    },
    {
      id: 'ENTER_RECOVERY_ONLY_MODE',
      title: 'TIER 3: ENTER RECOVERY ONLY MODE',
      desc: 'Restricts operations strictly to reconciliation and state inspection.',
      color: 'border-rose-500 text-rose-400 bg-rose-950/20',
    },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (operatorRationale.trim().length < 15) {
      alert('Operator rationale must be at least 15 characters per POC governance invariant');
      return;
    }

    setIsSubmitting(true);
    try {
      await WorkstationApiClient.setKillSwitch(selectedTier, operatorRationale);
      onRefreshData();
      onClose();
    } catch (err: any) {
      alert(`Kill switch transition failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="glass-panel w-full max-w-xl rounded-2xl border border-rose-500/40 shadow-2xl flex flex-col font-mono text-xs animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400 font-bold">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="text-sm">3-Tier Kill Switch Safety Gate</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-slate-300 font-bold block">Select Target Operational Halt Scope:</label>
            <div className="space-y-2">
              {tiers.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedTier(t.id)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedTier === t.id
                      ? `${t.color} ring-1 ring-offset-1 ring-offset-slate-950`
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold">{t.title}</span>
                    {selectedTier === t.id && <CheckCircle2 className="w-4 h-4" />}
                  </div>
                  <p className="text-[11px] mt-1 text-slate-300 leading-relaxed">{t.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1 pt-2">
            <label className="text-slate-300 font-bold block">
              Governed Operator Rationale (&ge;15 characters) *
            </label>
            <textarea
              value={operatorRationale}
              onChange={(e) => setOperatorRationale(e.target.value)}
              rows={3}
              placeholder="Explain rationale for this halt scope transition..."
              className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 focus:outline-none focus:border-rose-500"
              required
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold transition-colors shadow-lg"
            >
              {isSubmitting ? 'Committing...' : 'Commit Halt Scope'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
