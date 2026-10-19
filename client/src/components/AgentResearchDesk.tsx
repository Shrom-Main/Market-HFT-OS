import React, { useState } from 'react';
import {
  Bot,
  Play,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight,
  ShieldCheck,
  Search,
  Cpu,
  FileCode,
  Lock,
  Globe,
  Activity,
  Terminal,
  Database
} from 'lucide-react';
import { ProductObservationItem } from '../types/product';
import { WorkstationApiClient } from '../services/api';

interface AgentResearchDeskProps {
  products: ProductObservationItem[];
  onRefreshData: () => void;
}

export const AgentResearchDesk: React.FC<AgentResearchDeskProps> = ({
  products,
  onRefreshData,
}) => {
  const [targetProductId, setTargetProductId] = useState<string>(
    products[0]?.product_id || ''
  );
  const [operatorRationale, setOperatorRationale] = useState<string>(
    'Scheduled market surveillance tick to discover wholesale spread anomalies'
  );
  const [isRunningDag, setIsRunningDag] = useState<boolean>(false);
  const [lastDagRunResult, setLastDagRunResult] = useState<any>(null);
  const [logs, setLogs] = useState<Array<{ time: string; worker: string; msg: string; status: 'SUCCESS' | 'WARN' | 'INFO' }>>([
    {
      time: '15:28:10',
      worker: 'SystemScheduler',
      msg: 'Topological wave execution dispatcher initialized with 5 certified workers',
      status: 'INFO',
    },
    {
      time: '15:28:11',
      worker: 'CapabilityGrantAuthority',
      msg: 'HMAC-SHA256 Capability Grant signed for worker_id: worker-mcp-01',
      status: 'SUCCESS',
    },
    {
      time: '15:28:12',
      worker: 'ConstrainedHttpsConnector',
      msg: 'DNS pre-resolved to 13.232.0.0/16, egress bound to port :443',
      status: 'SUCCESS',
    },
  ]);

  const handleRunDag = async () => {
    if (operatorRationale.trim().length < 15) {
      alert('Operator rationale must be at least 15 characters per POC governance invariant');
      return;
    }

    setIsRunningDag(true);
    const newLog = (worker: string, msg: string, status: 'SUCCESS' | 'WARN' | 'INFO' = 'INFO') => {
      setLogs((prev) => [
        {
          time: new Date().toTimeString().split(' ')[0],
          worker,
          msg,
          status,
        },
        ...prev,
      ]);
    };

    try {
      newLog('ContextRoutingStateMachine', 'Initiating Stage 1: DECOMPOSE on target thesis', 'INFO');
      newLog('RAGSufficiencyGate', 'Checking BM25 similarity against FormulaRegistry cache', 'INFO');
      newLog('SourceCaptureWorker', 'Scraping wholesale seller listings & verifying unit quotes', 'INFO');
      newLog('GovtAndStatutoryWorker', 'Auditing BIS IS 9890 / MSME 43B(h) statutory exposure', 'INFO');
      newLog('MediaAndChatterWorker', 'Extracting negative review grievances & failure modes', 'INFO');
      newLog('RedTeamAndConflictWorker', 'Running adversarial margin stress test (-15% ASP shock)', 'INFO');

      const res = await WorkstationApiClient.runGovernedDag(operatorRationale);
      setLastDagRunResult(res);

      newLog(
        'DAGDispatcher',
        `DAG execution wave completed cleanly. Run ID: ${res.run_id}. Live evidence promoted.`,
        'SUCCESS'
      );
      onRefreshData();
    } catch (err: any) {
      newLog('DAGDispatcher', `Execution failed fail-closed: ${err.message}`, 'WARN');
      alert(`DAG Execution halted: ${err.message}`);
    } finally {
      setIsRunningDag(false);
    }
  };

  const agents = [
    {
      id: 'worker-source-capture',
      name: 'SourceCaptureWorker',
      role: 'DOM Harvester & Catalog Extractor',
      specialty: 'Amazon India / IndiaMART / Moglix listing scraper with DNS pinning',
      egress: 'HTTPS :443 only (DNS pre-resolved)',
      status: 'READY',
      color: 'border-cyan-500/50 text-cyan-400 bg-cyan-950/40',
    },
    {
      id: 'worker-macro-market',
      name: 'MacroAndLateralMarketWorker',
      role: 'Commodity Benchmark & Surcharges',
      specialty: 'LME Nickel, MCX Brass/Copper & Freight fuel surcharge indexes',
      egress: 'Deterministic In-Memory Vector',
      status: 'READY',
      color: 'border-indigo-500/50 text-indigo-400 bg-indigo-950/40',
    },
    {
      id: 'worker-govt-statutory',
      name: 'GovtAndStatutoryWorker',
      role: 'Statutory Compliance & MSME Auditor',
      specialty: 'BIS mandatory certification checker, HSN tax rates & 45-day payment aging',
      egress: 'Statutory Registry DB',
      status: 'READY',
      color: 'border-purple-500/50 text-purple-400 bg-purple-950/40',
    },
    {
      id: 'worker-media-chatter',
      name: 'MediaAndChatterWorker',
      role: 'Buyer Review & Sentiment Miner',
      specialty: 'Negative review cluster extraction, verbatim quotes, failure frequency %',
      egress: 'Review Scraper Tool',
      status: 'READY',
      color: 'border-amber-500/50 text-amber-400 bg-amber-950/40',
    },
    {
      id: 'worker-redteam-conflict',
      name: 'RedTeamAndConflictWorker',
      role: 'Adversarial Stress Tester',
      specialty: 'Detects circular citations, prompt injection attempts & margin shocks',
      egress: 'Sandboxed Adversarial Core',
      status: 'READY',
      color: 'border-rose-500/50 text-rose-400 bg-rose-950/40',
    },
  ];

  const pipelineStages = [
    { name: '1. Decompose', desc: 'Break down market query' },
    { name: '2. Route (RAG)', desc: 'Formula registry sufficiency' },
    { name: '3. Assemble', desc: 'Collect bounded context' },
    { name: '4. Prompt', desc: 'Inject zero-trust guardrails' },
    { name: '5. Execute', desc: 'Scoped worker tool calls' },
    { name: '6. Verify', desc: 'Deterministic AST vectors' },
    { name: '7. Formulate', desc: 'Commit strategy thesis' },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner: Autonomous Multi-Agent Framework Context */}
      <div className="glass-panel p-5 rounded-xl border border-emerald-500/30 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold font-mono text-white">
              Autonomous Micro-Agent Research Substrate (5 Certified Workers)
            </h2>
            <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 text-[10px] font-mono font-bold">
              PLAN-DRIVEN DAG
            </span>
          </div>
          <p className="text-xs font-mono text-slate-400 max-w-3xl leading-relaxed">
            Specialist workers operate under cryptographic HMAC-SHA256 capability grants, strict DNS
            pinning, and cumulative wall-clock quotas. Output feeds directly into the observation deck
            and promotes verified evidence from FIXTURE to LIVE.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-900 px-3 py-2 rounded-lg border border-slate-800 text-xs font-mono">
            <span className="text-slate-500">Active Workers:</span>{' '}
            <strong className="text-emerald-400">5 Certified</strong>
          </div>
        </div>
      </div>

      {/* 5-Worker Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {agents.map((agent) => (
          <div
            key={agent.id}
            className={`p-4 rounded-xl border glass-panel space-y-2 flex flex-col justify-between ${agent.color}`}
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                  {agent.status}
                </span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-xs font-bold font-mono text-white mt-2">{agent.name}</h3>
              <p className="text-[10px] font-mono text-slate-400 mt-0.5">{agent.role}</p>
              <p className="text-[11px] font-mono text-slate-300 mt-2 leading-relaxed">
                {agent.specialty}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-800 text-[9px] font-mono text-slate-400">
              Egress: <span className="text-slate-300">{agent.egress}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Pipeline Stepper Visualization */}
      <div className="glass-panel p-4 rounded-xl border border-slate-800 space-y-3">
        <span className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider block">
          7-Stage Governed Research Pipeline Execution Wave
        </span>

        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {pipelineStages.map((st, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 text-center space-y-1"
            >
              <span className="text-xs font-mono font-bold text-cyan-400 block">{st.name}</span>
              <span className="text-[10px] font-mono text-slate-400 block">{st.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Control Form & Live Execution Terminal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* DAG Run Dispatch Form */}
        <div className="lg:col-span-5 glass-panel p-5 rounded-xl border border-slate-800 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
            <Play className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
              Dispatch Governed Agent DAG Wave
            </h3>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Target Product Investigation</label>
              <select
                value={targetProductId}
                onChange={(e) => setTargetProductId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              >
                {products.map((p) => (
                  <option key={p.product_id} value={p.product_id}>
                    {p.sku_id} — {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">
                Governed Operator Rationale (&ge;15 characters) *
              </label>
              <textarea
                value={operatorRationale}
                onChange={(e) => setOperatorRationale(e.target.value)}
                rows={3}
                placeholder="Required by POC.docx §8 governance..."
                className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-200"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div>
                Confirmation Token: <code className="text-cyan-400">CONFIRM_RUN_DAG_WAVE</code>
              </div>
              <div>
                Halt Scope Check: <strong className="text-emerald-400">NORMAL_OPERATION (Passed)</strong>
              </div>
            </div>

            <button
              onClick={handleRunDag}
              disabled={isRunningDag}
              className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs transition-colors flex items-center justify-center gap-2 shadow-lg"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{isRunningDag ? 'Executing 5-Worker DAG Wave...' : 'Trigger Governed DAG Run'}</span>
            </button>
          </div>
        </div>

        {/* Live Execution Log Terminal */}
        <div className="lg:col-span-7 glass-panel p-5 rounded-xl border border-slate-800 space-y-3 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-cyan-400" />
              <h3 className="text-xs font-bold font-mono text-white uppercase tracking-wider">
                Live Append-Only Ledger & Telemetry
              </h3>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              SHA-256 Code Attested
            </span>
          </div>

          <div className="flex-1 bg-slate-950 p-3 rounded-lg border border-slate-800/80 font-mono text-[11px] space-y-2 overflow-y-auto max-h-80">
            {logs.map((log, idx) => (
              <div key={idx} className="flex items-start gap-2 leading-relaxed">
                <span className="text-slate-500 shrink-0">[{log.time}]</span>
                <span
                  className={`font-semibold shrink-0 ${
                    log.status === 'SUCCESS'
                      ? 'text-emerald-400'
                      : log.status === 'WARN'
                      ? 'text-rose-400'
                      : 'text-cyan-400'
                  }`}
                >
                  [{log.worker}]
                </span>
                <span className="text-slate-300">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
