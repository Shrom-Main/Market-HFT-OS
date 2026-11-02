/**
 * POC-001: Stage B Acceptance Test Suite (Suite 62)
 *
 * Validates persistent knowledge, layered memory (Episodic, Semantic, Procedural, Strategic),
 * non-destructive revision, strict applicability gates, cross-category procedural transfer,
 * category insulation (zero assumption leakage), and durable event logging.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PersistentMemoryStore,
  DurableMemoryEventStore,
  TemporalPropertyGraph,
  ContextualMemoryRetriever,
  InvestigationMemoryBridge,
  InvestigationRetrievalContext
} from '../../src/memory/index.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { NormalizedDiscoveryObservation } from '../../src/discovery/sourceAdapterContract.js';

describe('Suite 62: Stage B Persistent Knowledge & Cross-Domain Learning', () => {
  const testDir = path.join(process.cwd(), 'scratch', 'test_memory_suite62');
  const journalPath = path.join(testDir, 'test_memory_journal.jsonl');
  const eventJournalPath = path.join(testDir, 'test_event_journal.jsonl');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // MEM-01: Episodic memory survives process restart
  // ============================================================================
  it('MEM-01: Episodic memory survives process restart with identical cryptographic digest', async () => {
    const eventStore = new DurableMemoryEventStore({ journalPath: eventJournalPath });
    const memoryStore = new PersistentMemoryStore({ journalPath, eventStore });

    const episodic = await memoryStore.recordEpisodic({
      investigation_id: 'INV-HOWRAH-001',
      candidate_id: 'CAND-MODERN-METAL-01',
      title: 'Overpass & Local Directory Spatial Scan',
      summary: 'Executed 9 spatial queries across 4km grid; discovered 6 entities with 4 duplicate encounters.',
      execution_trace: {
        tool_name: 'OverpassSpatialScanner',
        input_params: { bbox: { minLat: 22.56, maxLat: 22.66, minLon: 88.25, maxLon: 88.37 }, cellSizeKm: 4 },
        output_digest: 'sha256-b049d5678a',
        success: true,
        latency_ms: 18360,
        query_count: 9
      },
      supporting_evidence_ids: ['EVID-STG2C-001', 'EVID-STG2C-002'],
      source_reliability: 'DIRECT_SUPPLIER_DISCLOSURE'
    });

    expect(episodic.memory_id).toBeDefined();
    expect(episodic.jcs_sha256).toHaveLength(64);
    expect(episodic.execution_trace.query_count).toBe(9);

    // Simulate process restart: instantiate a brand new store from the same disk journal
    const restartedStore = new PersistentMemoryStore({ journalPath });
    expect(restartedStore.getMemoryCount()).toBe(1);

    const reloaded = restartedStore.getMemory(episodic.memory_id) as any;
    expect(reloaded).toBeDefined();
    expect(reloaded.memory_id).toBe(episodic.memory_id);
    expect(reloaded.tier).toBe('EPISODIC');
    expect(reloaded.execution_trace.query_count).toBe(9);
    expect(reloaded.execution_trace.tool_name).toBe('OverpassSpatialScanner');
    expect(reloaded.jcs_sha256).toBe(episodic.jcs_sha256);
  });

  // ============================================================================
  // MEM-02: A subsequent investigation retrieves relevant procedural memory
  // ============================================================================
  it('MEM-02: A subsequent investigation retrieves relevant procedural memory', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);

    // Propose and validate procedural memory learned from Indian SME directories
    const proposed = await memoryStore.proposeProcedural({
      investigation_id: 'INV-HOWRAH-001',
      playbook_name: 'INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION',
      target_domain: 'ENGINEERING_FABRICATION',
      title: 'Indian SME Directory Classification Verification Playbook',
      summary: 'Directory manufacturer tags are self-reported. Audit active MCA21 corporate status and GST registration before RFQ.',
      applicability: {
        jurisdictions: ['IN'],
        categories: ['PHYSICAL_GOODS', 'B2B_DISTRIBUTION'],
        archetypes: ['SME_FABRICATOR', 'JOB_WORK_SHOP'],
        required_signals: ['B2B_DIRECTORY_LISTING']
      },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [
        {
          step_number: 1,
          action_name: 'VERIFY_MCA21_ACTIVE_STATUS',
          target_role: 'UnitEconomicsTaskAgent',
          required_tool: 'Mca21CompanySearchTool',
          parameters_template: { cin: '{{cin}}' },
          expected_output_schema: 'mca_status'
        },
        {
          step_number: 2,
          action_name: 'AUDIT_IN_HOUSE_TOOLING',
          target_role: 'AdversarialTaskAgent',
          required_tool: 'PlantMachineryInspector',
          parameters_template: { required_machinery: '{{machinery}}' },
          expected_output_schema: 'tooling_verdict'
        }
      ],
      known_failure_modes: [
        {
          failure_pattern: 'Heavy mining tool makers listing replacement air fittings as general hose clamps',
          preventive_action: 'Check primary machine catalog for product category alignment'
        }
      ],
      supporting_evidence_ids: ['EVID-HOWRAH-MDS-AMALGAMATED'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });

    await memoryStore.validateProcedural({
      memory_id: proposed.memory_id,
      validator_role: 'AdversarialTaskAgent',
      validation_evidence_ids: ['EVID-MCA-U27101WB1995PTC074027'],
      validation_notes: 'Validated against empirical Howrah cluster findings; successfully caught amalgamated status.'
    });

    // Subsequent investigation in another city with matching signals
    const context: InvestigationRetrievalContext = {
      investigation_id: 'INV-COIMBATORE-001',
      candidate_id: 'CAND-COIMBATORE-PUMPS',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'IN',
      archetype: 'SME_FABRICATOR',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    };

    const result = await retriever.retrieveApplicableProcedural(context);

    expect(result.applicablePlaybooks.length).toBe(1);
    expect(result.applicablePlaybooks[0].memory.playbook_name).toBe(
      'INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION'
    );
    expect(result.applicablePlaybooks[0].is_applicable).toBe(true);
    expect(result.applicablePlaybooks[0].applicability_reason).toContain('APPLICABLE');
    expect(result.mismatchedPlaybooks.length).toBe(0);
  });

  // ============================================================================
  // MEM-03: Contradictory evidence creates a new revision without deleting historical memory
  // ============================================================================
  it('MEM-03: Contradictory evidence creates a new revision without deleting historical memory', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });

    // Initial claim: MDS was active
    const oldMem = await memoryStore.proposeSemantic({
      investigation_id: 'INV-STG2C-PRELIM',
      subject_name: 'MDS Pneumatic Tools Private Limited',
      subject_entity_id: 'ENT-MDS-PNEUMATIC',
      title: 'MDS Pneumatic Tools Corporate Profile',
      summary: 'Classified as active manufacturer based on directory listing',
      attributes: {
        corporate_status: 'ACTIVE',
        claimed_category: 'MANUFACTURER'
      },
      epistemic_status: 'SOURCE_CLAIM',
      source_reliability: 'PUBLIC_DIRECTORY_SELF_REPORTED',
      corroboration_level: 'SINGLE_SOURCE',
      inference_type: 'DIRECT_OBSERVATION',
      supporting_evidence_ids: ['EVID-JUSTDIAL-MDS'],
      valid_from_utc: '1995-09-06T00:00:00.000Z'
    });

    await memoryStore.validateSemantic({
      memory_id: oldMem.memory_id,
      validator_role: 'LeadResearcher',
      validation_evidence_ids: ['EVID-JUSTDIAL-MDS']
    });

    // Contradictory evidence arrives: MCA21 reports company is AMALGAMATED
    const revisedMem = await memoryStore.supersedeMemory(
      oldMem.memory_id,
      {
        tier: 'SEMANTIC',
        subject_name: 'MDS Pneumatic Tools Private Limited',
        subject_entity_id: 'ENT-MDS-PNEUMATIC',
        title: 'MDS Pneumatic Tools Corporate Profile (Revised Post-MCA Audit)',
        summary: 'MCA21 registry confirms corporate status is AMALGAMATED (CIN: U27101WB1995PTC074027).',
        attributes: {
          corporate_status: 'AMALGAMATED',
          cin: 'U27101WB1995PTC074027',
          roc: 'ROC Kolkata',
          claimed_category: 'EQUIPMENT_BUILDER'
        },
        epistemic_status: 'OBSERVED_FACT',
        validation_state: 'VALIDATED',
        originating_investigation_id: 'INV-HOWRAH-STG2D',
        supporting_evidence_ids: ['EVID-MCA-CIN-U27101WB1995PTC074027', 'EVID-ZAUBA-AMALGAMATED'],
        source_reliability: 'OFFICIAL_REGISTRY',
        corroboration_level: 'MULTI_SOURCE_INDEPENDENT',
        inference_type: 'DIRECT_OBSERVATION'
      },
      'INV-HOWRAH-STG2D',
      'MCA official corporate filing confirms company status is Amalgamated, superseding self-reported directory claim.'
    );

    // Verify non-destructive persistence
    const oldRecord = memoryStore.getMemory(oldMem.memory_id);
    expect(oldRecord).toBeDefined();
    expect(oldRecord?.superseded_at_utc).not.toBeNull();
    expect(oldRecord?.valid_to_utc).not.toBeNull();

    expect(revisedMem.supersedes_memory_id).toBe(oldMem.memory_id);
    expect(revisedMem.superseded_at_utc).toBeNull();
    expect((revisedMem as any).attributes.corporate_status).toBe('AMALGAMATED');

    // Total memories stored should be 2; active memories should be 1
    expect(memoryStore.getAllMemories('SEMANTIC').length).toBe(2);
    expect(memoryStore.getActiveMemories('SEMANTIC').length).toBe(1);
    expect(memoryStore.getActiveMemories('SEMANTIC')[0].memory_id).toBe(revisedMem.memory_id);
  });

  // ============================================================================
  // MEM-04: Cross-category transfer retrieves and applies a reusable verification procedure
  // ============================================================================
  it('MEM-04: Cross-category transfer retrieves and applies a reusable verification procedure', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);

    // Step 1: Establish procedural memory from Howrah hose clamps
    const playbook = await memoryStore.proposeProcedural({
      investigation_id: 'INV-HOWRAH-CLAMPS',
      playbook_name: 'INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION',
      target_domain: 'ENGINEERING_FABRICATION',
      title: 'Indian SME Directory Verification',
      summary: 'B2B directory classification is unverified; audit MCA active status and tooling before quote dispatch.',
      applicability: {
        jurisdictions: ['IN'],
        categories: ['PHYSICAL_GOODS', 'B2B_DISTRIBUTION'],
        required_signals: ['B2B_DIRECTORY_LISTING']
      },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [
        {
          step_number: 1,
          action_name: 'AUDIT_REGULATORY_AND_TAX',
          target_role: 'UnitEconomicsTaskAgent',
          required_tool: 'Mca21RegistryTool',
          parameters_template: {},
          expected_output_schema: 'mca_status'
        }
      ],
      known_failure_modes: [],
      supporting_evidence_ids: ['EVID-HOWRAH-SS304'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });

    await memoryStore.validateProcedural({
      memory_id: playbook.memory_id,
      validator_role: 'LeadResearcher',
      validation_evidence_ids: ['EVID-HOWRAH-SS304'],
      validation_notes: 'Validated empirically.'
    });

    // Step 2: Run controlled demonstration in Coimbatore submersible pumps
    const clusterCandidates = [
      { name: 'Apex Pump Industries', claimed_type: 'Manufacturer', actual_mca_status: 'ACTIVE' as const, actual_tooling: 'IN_HOUSE' as const },
      { name: 'Kovai Submersible Works', claimed_type: 'Manufacturer', actual_mca_status: 'ACTIVE' as const, actual_tooling: 'IN_HOUSE' as const },
      { name: 'Ganga Electro Spares', claimed_type: 'Manufacturer', actual_mca_status: 'STRUCK_OFF' as const, actual_tooling: 'TRADER_STOCKIST' as const },
      { name: 'Maruti Motor Traders', claimed_type: 'Manufacturer', actual_mca_status: 'AMALGAMATED' as const, actual_tooling: 'TRADER_STOCKIST' as const },
      { name: 'Deccan Pump Agencies', claimed_type: 'Manufacturer', actual_mca_status: 'ACTIVE' as const, actual_tooling: 'TRADER_STOCKIST' as const }
    ];

    // Baseline Run (No Memory)
    const baseline = await bridge.executeControlledDemonstration({
      investigation_id: 'INV-COIMBATORE-BASELINE',
      candidate_id: 'CAND-COIMBATORE-PUMPS',
      candidate_name: 'Coimbatore Submersible Pumps Cohort',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'IN',
      industry: 'ROTATING_MACHINERY',
      candidates_in_cluster: clusterCandidates,
      target_category_fields: ['winding_insulation_class', 'impeller_casting', 'flow_head_curve'],
      with_memory: false
    });

    // Treated Run (With Persistent Memory Retrieved)
    const treated = await bridge.executeControlledDemonstration({
      investigation_id: 'INV-COIMBATORE-TREATED',
      candidate_id: 'CAND-COIMBATORE-PUMPS',
      candidate_name: 'Coimbatore Submersible Pumps Cohort',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'IN',
      industry: 'ROTATING_MACHINERY',
      candidates_in_cluster: clusterCandidates,
      target_category_fields: ['winding_insulation_class', 'impeller_casting', 'flow_head_curve'],
      with_memory: true
    });

    // Verifications:
    expect(treated.used_memory_id).toBe(playbook.memory_id);
    expect(treated.disqualified_at_registry_stage).toBe(3); // 1 struck off, 1 amalgamated, 1 trader disqualified early!
    expect(treated.rfq_quotes_dispatched).toBe(2); // Only the 2 true manufacturers received RFQs!
    expect(baseline.rfq_quotes_dispatched).toBe(5); // Baseline sent quotes to all 5 blindly!
    expect(treated.total_queries_executed).toBeLessThan(baseline.total_queries_executed); // 9 vs 15 queries!
  });

  // ============================================================================
  // MEM-05: Category-specific assumptions do not leak into the second investigation
  // ============================================================================
  it('MEM-05: Category-specific assumptions do not leak into the second investigation', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);

    // Seed procedural memory from Howrah hose clamps
    const playbook = await memoryStore.proposeProcedural({
      investigation_id: 'INV-HOWRAH-CLAMPS',
      playbook_name: 'INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION',
      target_domain: 'ENGINEERING_FABRICATION',
      title: 'Indian SME Directory Verification',
      summary: 'B2B directory verification',
      applicability: {
        jurisdictions: ['IN'],
        categories: ['PHYSICAL_GOODS']
      },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [
        {
          step_number: 1,
          action_name: 'AUDIT_REGULATORY_AND_TAX',
          target_role: 'UnitEconomicsTaskAgent',
          required_tool: 'Mca21Tool',
          parameters_template: {},
          expected_output_schema: 'mca_status'
        }
      ],
      known_failure_modes: [],
      supporting_evidence_ids: ['EVID-001'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });
    await memoryStore.validateProcedural({
      memory_id: playbook.memory_id,
      validator_role: 'Researcher',
      validation_evidence_ids: ['EVID-001'],
      validation_notes: 'Validated'
    });

    // Observation for a submersible pump
    const pumpObservation = {
      observation_id: 'OBS-PUMP-01',
      capture_id: 'CAP-PUMP-01',
      strategy_id: 'STRAT-REGIONAL-SOURCING',
      canonical_product_id: 'prod:coimbatore:pump:5hp',
      candidate_name: 'Coimbatore 5HP Submersible Borewell Pump',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'indiamart_b2b_connector',
      source_type: 'SUPPLIER_B2B_CATALOG' as const,
      origin_class: 'LIVE_VERIFIED_CAPTURE' as const,
      factory_gate_quote_inr: null,
      prevailing_retail_asp_inr: 18500,
      unit_batch_moq: 10,
      observed_seller_count: 5,
      review_sentiment_summary: 'Positive',
      raw_payload_snippet: '{}',
      payload_sha256: '0'.repeat(64),
      source_observed_at_utc: new Date().toISOString(),
      ingestion_timestamp_utc: new Date().toISOString(),
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Normalized test observation'
    } as unknown as NormalizedDiscoveryObservation;

    const plan = await bridge.planWithMemory('CAND-PUMP-01', pumpObservation, {
      jurisdiction: 'IN',
      industry: 'ROTATING_ELECTRICAL_MACHINERY',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    });

    expect(plan.adapted_from_memory_id).toBe(playbook.memory_id);

    // Stringify entire plan to inspect for data leaks
    const planText = JSON.stringify(plan).toLowerCase();

    // MUST NOT leak hose clamp specific concepts into pump plan:
    expect(planText).not.toContain('din 3017');
    expect(planText).not.toContain('din3017');
    expect(planText).not.toContain('hose clamp');
    expect(planText).not.toContain('band width');
    expect(planText).not.toContain('worm drive');
    expect(planText).not.toContain('ss304'); // pump could be cast iron/brass/copper
  });

  // ============================================================================
  // MEM-06: An unverified agent proposal cannot become validated semantic or procedural memory
  // ============================================================================
  it('MEM-06: An unverified agent proposal cannot become validated semantic or procedural memory without explicit validation gate', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);

    const proposed = await memoryStore.proposeProcedural({
      investigation_id: 'INV-UNVERIFIED-01',
      playbook_name: 'UNVERIFIED_AGENT_HEURISTIC',
      target_domain: 'FASTENERS',
      title: 'Agent Heuristic on Fastener Pricing',
      summary: 'Agent suggests assuming 40% margin on all fastener listings',
      applicability: { jurisdictions: ['IN'], categories: ['PHYSICAL_GOODS'] },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [],
      known_failure_modes: [],
      supporting_evidence_ids: [],
      source_reliability: 'UNVERIFIED_WEB'
    });

    expect(proposed.validation_state).toBe('PROPOSED');

    // Retrieval must NOT return proposed/unvalidated playbooks for active execution
    const retrieval = await retriever.retrieveApplicableProcedural({
      investigation_id: 'INV-TEST-02',
      candidate_id: 'CAND-01',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'IN',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    });

    expect(retrieval.applicablePlaybooks.length).toBe(0);

    // Attempting to validate without supporting evidence must throw error
    await expect(
      memoryStore.validateProcedural({
        memory_id: proposed.memory_id,
        validator_role: 'LeadAuditor',
        validation_evidence_ids: [], // EMPTY EVIDENCE!
        validation_notes: 'Trying to promote without proof'
      })
    ).rejects.toThrow('E-VALIDATION-INSUFFICIENT-EVIDENCE');

    // Rejecting the proposal transitions validation state to REJECTED
    const rejected = await memoryStore.rejectProcedural({
      memory_id: proposed.memory_id,
      rejector_role: 'ChiefRiskOfficer',
      rejection_reason: 'Unsubstantiated margin assumption violates RT-06 zero-cost substitution ban'
    });

    expect(rejected.validation_state).toBe('REJECTED');
    expect(rejected.validation_notes).toContain('violates RT-06');
  });

  // ============================================================================
  // MEM-07: Inapplicable or stale memories are excluded or explicitly qualified during retrieval
  // ============================================================================
  it('MEM-07: Inapplicable or stale memories are excluded or explicitly qualified during retrieval', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);

    // Playbook valid ONLY in jurisdiction 'IN' (India) for 'PHYSICAL_GOODS'
    const indiaPlaybook = await memoryStore.proposeProcedural({
      investigation_id: 'INV-IND-01',
      playbook_name: 'INDIAN_GSTN_MCA_AUDIT_PLAYBOOK',
      target_domain: 'INDIAN_MANUFACTURING',
      title: 'Indian Regulatory Verification Playbook',
      summary: 'Checks MCA21 and GSTN portal',
      applicability: {
        jurisdictions: ['IN'],
        categories: ['PHYSICAL_GOODS']
      },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [],
      known_failure_modes: [],
      supporting_evidence_ids: ['EVID-IND-01'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });
    await memoryStore.validateProcedural({
      memory_id: indiaPlaybook.memory_id,
      validator_role: 'Auditor',
      validation_evidence_ids: ['EVID-IND-01'],
      validation_notes: 'Validated'
    });

    // Case A: Query for Germany ('DE')
    const deContext: InvestigationRetrievalContext = {
      investigation_id: 'INV-GERMANY-01',
      candidate_id: 'CAND-BERLIN-FASTENERS',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'DE',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    };

    const deResult = await retriever.retrieveApplicableProcedural(deContext);
    expect(deResult.applicablePlaybooks.length).toBe(0);
    expect(deResult.mismatchedPlaybooks.length).toBe(1);
    expect(deResult.mismatchedPlaybooks[0].is_applicable).toBe(false);
    expect(deResult.mismatchedPlaybooks[0].applicability_reason).toContain('jurisdiction_mismatch');

    // Case B: Query for Indian Software ('SOFTWARE_DIGITAL')
    const saasContext: InvestigationRetrievalContext = {
      investigation_id: 'INV-BANGALORE-SAAS',
      candidate_id: 'CAND-SAAS-01',
      category: 'SOFTWARE_DIGITAL',
      jurisdiction: 'IN',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    };

    const saasResult = await retriever.retrieveApplicableProcedural(saasContext);
    expect(saasResult.applicablePlaybooks.length).toBe(0);
    expect(saasResult.mismatchedPlaybooks.length).toBe(1);
    expect(saasResult.mismatchedPlaybooks[0].applicability_reason).toContain('category_mismatch');
  });

  // ============================================================================
  // MEM-08: Retrieval, proposal, validation and supersession produce durable, traceable events
  // ============================================================================
  it('MEM-08: Retrieval, proposal, validation and supersession produce durable, traceable events', async () => {
    const eventStore = new DurableMemoryEventStore({ journalPath: eventJournalPath });
    const memoryStore = new PersistentMemoryStore({ journalPath, eventStore });
    const retriever = new ContextualMemoryRetriever(memoryStore);

    // 1. Propose
    const prop = await memoryStore.proposeProcedural({
      investigation_id: 'INV-EVENT-TEST',
      playbook_name: 'TEST_PLAYBOOK',
      target_domain: 'TEST',
      title: 'Test Playbook',
      summary: 'Testing event logging',
      applicability: { jurisdictions: ['IN'], categories: ['PHYSICAL_GOODS'] },
      prerequisite_signals: ['SIG_TEST'],
      execution_steps: [],
      known_failure_modes: [],
      supporting_evidence_ids: ['EVID-EVT-01'],
      source_reliability: 'DIRECT_SUPPLIER_DISCLOSURE'
    });

    // 2. Validate
    await memoryStore.validateProcedural({
      memory_id: prop.memory_id,
      validator_role: 'Auditor',
      validation_evidence_ids: ['EVID-EVT-01'],
      validation_notes: 'Validated'
    });

    // 3. Retrieve (Matching)
    await retriever.retrieveApplicableProcedural({
      investigation_id: 'INV-EVENT-TEST',
      candidate_id: 'CAND-TEST-01',
      category: 'PHYSICAL_GOODS',
      jurisdiction: 'IN',
      signals_observed: ['SIG_TEST']
    });

    // 4. Retrieve (Mismatching)
    await retriever.retrieveApplicableProcedural({
      investigation_id: 'INV-EVENT-TEST',
      candidate_id: 'CAND-TEST-02',
      category: 'SOFTWARE_DIGITAL',
      jurisdiction: 'US',
      signals_observed: []
    });

    // 5. Supersede
    await memoryStore.supersedeMemory(
      prop.memory_id,
      {
        ...prop,
        title: 'Test Playbook Revision 2'
      },
      'INV-EVENT-TEST',
      'Upgraded test playbook'
    );

    const allEvents = await eventStore.query();
    expect(allEvents.length).toBeGreaterThanOrEqual(5);

    const eventTypes = allEvents.map((e) => e.event_type);
    expect(eventTypes).toContain('MEMORY_PROPOSED');
    expect(eventTypes).toContain('MEMORY_VALIDATED');
    expect(eventTypes).toContain('MEMORY_RETRIEVED');
    expect(eventTypes).toContain('MEMORY_APPLICABILITY_MISMATCH');
    expect(eventTypes).toContain('MEMORY_SUPERSEDED');

    // Replay capability test: verify sequence numbers are strictly monotonic
    for (let i = 1; i < allEvents.length; i++) {
      expect(allEvents[i].sequence_number).toBeGreaterThan(allEvents[i - 1].sequence_number);
      expect(allEvents[i].jcs_sha256).toHaveLength(64);
    }
  });

  // ============================================================================
  // MEM-09: Existing investigation workflows continue to operate
  // ============================================================================
  it('MEM-09: Existing investigation workflows continue to operate', async () => {
    const memoryStore = new PersistentMemoryStore({ journalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);

    // Empty memory store: planWithMemory should cleanly fall back to default plan
    const obs = {
      observation_id: 'OBS-FALLBACK-01',
      capture_id: 'CAP-FALLBACK-01',
      strategy_id: 'STRAT-DEFAULT',
      canonical_product_id: 'prod:raw:unmatched',
      candidate_name: 'Raw Unmatched Component',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'default_connector',
      source_type: 'SUPPLIER_B2B_CATALOG' as const,
      origin_class: 'LIVE_VERIFIED_CAPTURE' as const,
      factory_gate_quote_inr: null,
      prevailing_retail_asp_inr: null,
      unit_batch_moq: null,
      observed_seller_count: null,
      review_sentiment_summary: null,
      raw_payload_snippet: '{}',
      payload_sha256: '0'.repeat(64),
      source_observed_at_utc: new Date().toISOString(),
      ingestion_timestamp_utc: new Date().toISOString(),
      has_logistics_route: false,
      has_regulatory_clearance: false,
      normalization_notes: 'Fallback test'
    } as unknown as NormalizedDiscoveryObservation;

    const plan = await bridge.planWithMemory('CAND-FALLBACK-01', obs, {
      jurisdiction: 'IN',
      signals_observed: []
    });

    expect(plan.candidate_id).toBe('CAND-FALLBACK-01');
    expect(plan.tasks.length).toBeGreaterThanOrEqual(2);
    expect(plan.adapted_from_memory_id).toBeUndefined(); // Fallback confirmed!

    // Verify task queue lease fencing continues to work
    await taskQueue.enqueueTasks(plan.tasks);
    const claimed = await taskQueue.claimNextTask('WORKER-01', {
      candidateId: 'CAND-FALLBACK-01',
      targetRole: 'SupplyTaskAgent'
    });
    expect(claimed).toBeDefined();
    expect(claimed?.fencing_token).toBe(1);
    expect(claimed?.state).toBe('LEASED');
  });

  // ============================================================================
  // MEM-10: Repeated execution produces deterministic outcomes for identical inputs
  // ============================================================================
  it('MEM-10: Repeated execution produces deterministic outcomes for identical inputs', async () => {
    const graph1 = new TemporalPropertyGraph();
    const graph2 = new TemporalPropertyGraph();

    const nodeParams = {
      node_id: 'ENT-MODERN-METAL',
      node_type: 'ENTITY' as const,
      label: 'Modern Metal Works',
      properties: { gstin: '19AANFM7599P1ZV', cluster: 'Liluah' },
      valid_from_utc: '2008-01-01T00:00:00.000Z',
      observed_at_utc: '2026-01-01T00:00:00.000Z'
    };

    const n1 = graph1.addNode(nodeParams);
    const n2 = graph2.addNode(nodeParams);

    expect(n1.jcs_sha256).toBe(n2.jcs_sha256);

    const edgeParams = {
      edge_id: 'EDGE-MODERN-SELF-01',
      from_node_id: 'ENT-MODERN-METAL',
      to_node_id: 'ENT-MODERN-METAL', // self/cyclic edge permitted
      edge_type: 'SUPPLIES_TO' as const,
      properties: { volume_tier: 'WHOLESALE' },
      valid_from_utc: '2008-01-01T00:00:00.000Z',
      observed_at_utc: '2026-01-01T00:00:00.000Z'
    };

    const e1 = graph1.addEdge(edgeParams);
    const e2 = graph2.addEdge(edgeParams);

    expect(e1.jcs_sha256).toBe(e2.jcs_sha256);
  });
});
