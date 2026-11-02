/**
 * POC-001: Stage C Acceptance Test Suite (Suite 63)
 *
 * Validates Living Product Gallery & Living Thesis Gallery:
 * 1. Product candidates persist across process restart.
 * 2. Theses persist across process restart independently of products.
 * 3. Actual discovery populates Product Gallery (not static cards).
 * 4. An investigation produces/updates an evidence-linked thesis.
 * 5. Evidence and contradictions update appropriate records.
 * 6. Stage B persistent memories are retrieved and traceably applied.
 * 7. Operator LLM interactions remain evidence-grounded and deterministic.
 * 8. Events update gallery projections idempotently without duplicate records.
 * 9. Reconnection and replay recover missed updates.
 * 10. Physical goods and software candidates coexist without assumption leaks.
 * 11. Existing workflows and prior suites continue passing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PersistentGalleryStore,
  GalleryIntelligenceAgent,
  DiscoveryGalleryPipeline
} from '../../src/gallery/index.js';
import {
  PersistentMemoryStore,
  DurableMemoryEventStore,
  ContextualMemoryRetriever,
  InvestigationMemoryBridge
} from '../../src/memory/index.js';
import { InvestigationTaskQueue } from '../../src/discovery/investigationTaskQueue.js';
import { NormalizedDiscoveryObservation } from '../../src/discovery/sourceAdapterContract.js';

describe('Suite 63: Stage C Living Product Gallery & Thesis Gallery', () => {
  const testBaseDir = path.join(process.cwd(), 'scratch', 'test_gallery_suite63');
  const memoryJournalPath = path.join(testBaseDir, 'test_memory.jsonl');
  const galleryJournalDir = path.join(testBaseDir, 'gallery_store');

  beforeEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testBaseDir)) {
      fs.rmSync(testBaseDir, { recursive: true, force: true });
    }
  });

  function createTestObservation(overrides: Partial<NormalizedDiscoveryObservation> = {}): NormalizedDiscoveryObservation {
    return {
      observation_id: 'OBS-TEST-' + Math.random().toString(36).substring(2, 7),
      capture_id: 'CAP-TEST-' + Math.random().toString(36).substring(2, 7),
      strategy_id: 'STRAT-REGIONAL-SOURCING',
      canonical_product_id: 'prod:test:item',
      candidate_name: 'Test Industrial Item',
      category: 'PHYSICAL_GOODS',
      source_connector_id: 'indiamart_b2b_connector',
      source_type: 'SUPPLIER_B2B_CATALOG',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      prevailing_retail_asp_inr: 500,
      factory_gate_quote_inr: null,
      unit_batch_moq: 100,
      observed_seller_count: 3,
      review_sentiment_summary: 'Positive feedback',
      raw_payload_snippet: '{"name":"Test Item"}',
      payload_sha256: '0'.repeat(64),
      source_observed_at_utc: new Date().toISOString(),
      ingestion_timestamp_utc: new Date().toISOString(),
      has_logistics_route: true,
      has_regulatory_clearance: true,
      normalization_notes: 'Standard test observation',
      ...overrides
    };
  }

  // ============================================================================
  // TEST-GAL-01: Product candidates persist across restart
  // ============================================================================
  it('TEST-GAL-01: Product candidates persist across restart with stable identity and JCS SHA-256', async () => {
    const store = new PersistentGalleryStore({ journalDir: galleryJournalDir });

    const cand = await store.ingestDiscoveredCandidate({
      candidate_id: 'CAND-COIMBATORE-PUMP-01',
      canonical_product_id: 'prod:coimbatore:submersible:5hp',
      name: 'Coimbatore 5HP Submersible Borewell Pump',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      source_url: 'https://trade.example.com/coimbatore-pump-01',
      relevant_locations: [{ cluster_id: 'COIMBATORE_IND', city: 'Coimbatore', state: 'Tamil Nadu' }],
      financial_summary: {
        factory_gate_quote_inr: null,
        prevailing_retail_asp_inr: 18500,
        estimated_gross_margin_bps: null,
        data_required_fields: ['factory_gate_quote_inr']
      },
      initial_supporting_evidence: ['EVID-PUMP-COIMBATORE-01']
    });

    expect(cand.candidate_id).toBe('CAND-COIMBATORE-PUMP-01');
    expect(cand.jcs_sha256).toHaveLength(64);
    expect(cand.lifecycle_state).toBe('NEW');

    // Simulate process restart by instantiating new store from disk journal
    const restartedStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    expect(restartedStore.getCandidateCount()).toBe(1);

    const reloaded = restartedStore.getCandidate('CAND-COIMBATORE-PUMP-01');
    expect(reloaded).toBeDefined();
    expect(reloaded?.name).toBe('Coimbatore 5HP Submersible Borewell Pump');
    expect(reloaded?.category).toBe('PHYSICAL_GOODS');
    expect(reloaded?.relevant_locations[0].city).toBe('Coimbatore');
    expect(reloaded?.supporting_evidence_ids).toContain('EVID-PUMP-COIMBATORE-01');
    expect(reloaded?.jcs_sha256).toBe(cand.jcs_sha256);
  });

  // ============================================================================
  // TEST-GAL-02: Theses persist across restart independently of products
  // ============================================================================
  it('TEST-GAL-02: Theses persist across restart independently of products', async () => {
    const store = new PersistentGalleryStore({ journalDir: galleryJournalDir });

    const thesis = await store.formulateThesis({
      thesis_id: 'THS-HOWRAH-FOUNDRY-CONSOLIDATION',
      title: 'Howrah Foundry and Stamping Cluster Margin Expansion',
      scope: 'GEOGRAPHIC_CLUSTER',
      hypothesis_statement:
        'Liluah and Baltikuri metal fabricators will see 200bps margin expansion as freight corridor electrification completes.',
      originating_observations: ['OBS-FREIGHT-ELECTRIFICATION-01'],
      supporting_evidence_ids: ['EVID-RAIL-TENDER-2026'],
      related_locations: ['Howrah', 'Liluah', 'Baltikuri'],
      uncertainty_rating: 'MEDIUM'
    });

    expect(thesis.thesis_id).toBe('THS-HOWRAH-FOUNDRY-CONSOLIDATION');
    expect(thesis.scope).toBe('GEOGRAPHIC_CLUSTER');
    expect(thesis.revisions.length).toBe(1);

    // Simulate process restart
    const restartedStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    expect(restartedStore.getThesisCount()).toBe(1);

    const reloadedThesis = restartedStore.getThesis('THS-HOWRAH-FOUNDRY-CONSOLIDATION');
    expect(reloadedThesis).toBeDefined();
    expect(reloadedThesis?.title).toBe('Howrah Foundry and Stamping Cluster Margin Expansion');
    expect(reloadedThesis?.scope).toBe('GEOGRAPHIC_CLUSTER');
    expect(reloadedThesis?.revisions[0].updated_statement).toContain('Liluah and Baltikuri');
    expect(reloadedThesis?.jcs_sha256).toBe(thesis.jcs_sha256);
  });

  // ============================================================================
  // TEST-GAL-03: Actual discovery can populate Product Gallery
  // ============================================================================
  it('TEST-GAL-03: Actual discovery can populate Product Gallery (not static/seeded cards)', async () => {
    const galleryStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    const memoryStore = new PersistentMemoryStore({ journalPath: memoryJournalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);
    const pipeline = new DiscoveryGalleryPipeline(galleryStore, memoryStore, retriever, bridge, taskQueue);

    const observation = createTestObservation({
      candidate_name: 'Jamnagar Forged Brass Ball Valve 1/2 Inch',
      category: 'PHYSICAL_GOODS',
      source_type: 'SUPPLIER_B2B_CATALOG',
      prevailing_retail_asp_inr: 285,
      factory_gate_quote_inr: null // Missing factory quote triggers investigation!
    });

    const result = await pipeline.processDiscovery({
      candidate_id: 'CAND-JAMNAGAR-VALVE-01',
      canonical_product_id: 'prod:jamnagar:brass:valve:1-2',
      observation,
      jurisdiction: 'IN',
      industry: 'BRASS_FOUNDRY_VALVES',
      initial_evidence_id: 'EVID-JAMNAGAR-PORTAL-01'
    });

    expect(result.candidate.candidate_id).toBe('CAND-JAMNAGAR-VALVE-01');
    expect(result.candidate.name).toBe('Jamnagar Forged Brass Ball Valve 1/2 Inch');
    expect(result.candidate.lifecycle_state).toBe('INVESTIGATE');
    expect(result.candidate.investigation_status).toBe('IN_PROGRESS');
    expect(result.planned_tasks_count).toBeGreaterThanOrEqual(1);

    // Verify candidate is immediately visible in Product Gallery
    const inGallery = galleryStore.getCandidate('CAND-JAMNAGAR-VALVE-01');
    expect(inGallery).toBeDefined();
    expect(inGallery?.financial_summary?.data_required_fields).toContain('factory_gate_quote_inr');
    expect(inGallery?.last_event_type).toBe('INVESTIGATION_QUEUED');
  });

  // ============================================================================
  // TEST-GAL-04: An investigation can produce or update a thesis
  // ============================================================================
  it('TEST-GAL-04: An investigation can produce or update a thesis', async () => {
    const galleryStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    const memoryStore = new PersistentMemoryStore({ journalPath: memoryJournalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);
    const pipeline = new DiscoveryGalleryPipeline(galleryStore, memoryStore, retriever, bridge, taskQueue);

    // Step 1: Formulate thesis regarding brass valve price inflation
    const thesis = await galleryStore.formulateThesis({
      thesis_id: 'THS-BRASS-COMPONENT-INFLATION',
      title: 'Western India Brass Valve Margin Spread Expansion',
      scope: 'SUPPLY_CHAIN_INEFFICIENCY',
      hypothesis_statement:
        'Jamnagar brass component makers will offer quotes under ₹120, yielding >50% gross margin against retail ASP of ₹285.',
      originating_observations: ['OBS-JAMNAGAR-CLUSTER-01'],
      uncertainty_rating: 'HIGH'
    });

    // Step 2: Discovery and initial candidate ingestion linked to thesis
    const obs = createTestObservation({
      candidate_name: 'Jamnagar Brass Valve',
      factory_gate_quote_inr: null,
      prevailing_retail_asp_inr: 285
    });

    await pipeline.processDiscovery({
      candidate_id: 'CAND-VALVE-01',
      canonical_product_id: 'prod:valve:brass',
      observation: obs,
      jurisdiction: 'IN',
      associated_thesis_id: thesis.thesis_id,
      initial_evidence_id: 'EVID-VALVE-INITIAL-01'
    });

    // Step 3: Investigation completes, returns factory gate quote of ₹115!
    const completion = await pipeline.completeInvestigationTask({
      candidate_id: 'CAND-VALVE-01',
      task_id: 'TASK-VALVE-QUOTE',
      evidence_id: 'EVID-JAMNAGAR-MFR-QUOTE-115',
      extracted_fields: {
        factory_gate_quote_inr: 115,
        prevailing_retail_asp_inr: 285
      },
      thesis_id_to_update: thesis.thesis_id,
      finding_summary: 'Confirmed verified factory gate quote of ₹115 from Jamnagar brass foundry.'
    });

    // Candidate should now be VERIFIED with estimated gross margin bps = (285 - 115)/285 = ~59.6% (5965 bps)
    expect(completion.candidate.lifecycle_state).toBe('VERIFIED');
    expect(completion.candidate.financial_summary?.factory_gate_quote_inr).toBe(115);
    expect(completion.candidate.financial_summary?.estimated_gross_margin_bps).toBeGreaterThanOrEqual(5900);

    // Thesis should now link evidence and have updated investigation history
    const updatedThesis = galleryStore.getThesis(thesis.thesis_id);
    expect(updatedThesis?.supporting_evidence_ids).toContain('EVID-JAMNAGAR-MFR-QUOTE-115');
    expect(updatedThesis?.investigation_history.length).toBe(1);
    expect(updatedThesis?.investigation_history[0].finding).toContain('₹115');

    // Revise thesis statement with the new empirical evidence
    await galleryStore.reviseThesis({
      thesis_id: thesis.thesis_id,
      updated_statement:
        'Empirical verification confirmed: Jamnagar brass foundry quotes at ₹115, delivering 59.6% gross margin against retail ASP ₹285.',
      rationale: 'Empirical quote of ₹115 verified via EVID-JAMNAGAR-MFR-QUOTE-115',
      triggering_evidence_id: 'EVID-JAMNAGAR-MFR-QUOTE-115',
      updated_uncertainty: 'LOW',
      updated_state: 'VALIDATED'
    });

    const validatedThesis = galleryStore.getThesis(thesis.thesis_id);
    expect(validatedThesis?.lifecycle_state).toBe('VALIDATED');
    expect(validatedThesis?.uncertainty_rating).toBe('LOW');
    expect(validatedThesis?.revisions.length).toBe(2);
  });

  // ============================================================================
  // TEST-GAL-05: Evidence and contradictions update the appropriate records
  // ============================================================================
  it('TEST-GAL-05: Evidence and contradictions update the appropriate records', async () => {
    const store = new PersistentGalleryStore({ journalDir: galleryJournalDir });

    const cand = await store.ingestDiscoveredCandidate({
      candidate_id: 'CAND-TEST-MDS',
      canonical_product_id: 'prod:test:mds',
      name: 'MDS Heavy Industrial Fitting',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE'
    });

    // Link supporting evidence
    await store.linkEvidenceToCandidate({
      candidate_id: cand.candidate_id,
      evidence_id: 'EVID-DIRECTORY-LISTING-01',
      is_contradiction: false
    });

    expect(store.getCandidate(cand.candidate_id)?.supporting_evidence_ids).toContain('EVID-DIRECTORY-LISTING-01');

    // Link contradictory evidence (e.g. MCA amalgamation discovering company is not independent manufacturer)
    await store.linkEvidenceToCandidate({
      candidate_id: cand.candidate_id,
      evidence_id: 'EVID-MCA-AMALGAMATED-01',
      is_contradiction: true,
      rationale: 'MCA21 filing confirms company status is Amalgamated; not standalone manufacturer.'
    });

    const updated = store.getCandidate(cand.candidate_id);
    expect(updated?.contradictory_evidence_ids).toContain('EVID-MCA-AMALGAMATED-01');
    expect(updated?.last_event_type).toBe('CONTRADICTION_DETECTED');

    // Link disconfirming evidence to a thesis
    const thesis = await store.formulateThesis({
      title: 'MDS Standalone Manufacturing Hypothesis',
      scope: 'PRODUCT',
      hypothesis_statement: 'MDS will act as primary anchor manufacturer.'
    });

    await store.linkEvidenceToThesis({
      thesis_id: thesis.thesis_id,
      evidence_id: 'EVID-MCA-AMALGAMATED-01',
      is_disconfirming: true,
      finding_summary: 'Corporate entity is amalgamated.'
    });

    const updatedThesis = store.getThesis(thesis.thesis_id);
    expect(updatedThesis?.disconfirming_evidence_ids).toContain('EVID-MCA-AMALGAMATED-01');
    expect(updatedThesis?.uncertainty_rating).toBe('HIGH');
  });

  // ============================================================================
  // TEST-GAL-06: Stage B memories are retrieved and traceably applied
  // ============================================================================
  it('TEST-GAL-06: Stage B memories are retrieved and traceably applied to newly discovered candidate', async () => {
    const galleryStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    const memoryStore = new PersistentMemoryStore({ journalPath: memoryJournalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);
    const pipeline = new DiscoveryGalleryPipeline(galleryStore, memoryStore, retriever, bridge, taskQueue);

    // Seed validated Stage B procedural memory
    const playbook = await memoryStore.proposeProcedural({
      investigation_id: 'INV-HOWRAH-FASTENERS',
      playbook_name: 'INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION',
      target_domain: 'ENGINEERING_FABRICATION',
      title: 'Indian SME Directory Verification Playbook',
      summary: 'B2B directory tags are unverified leads; check active MCA status and tooling.',
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
      supporting_evidence_ids: ['EVID-STAGE2D-HOWRAH'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });

    await memoryStore.validateProcedural({
      memory_id: playbook.memory_id,
      validator_role: 'LeadAuditor',
      validation_evidence_ids: ['EVID-STAGE2D-HOWRAH'],
      validation_notes: 'Validated empirically.'
    });

    // Ingest a candidate in a different product category (e.g. Ludhiana Fasteners)
    const obs = createTestObservation({
      candidate_name: 'Ludhiana High Tensile Grade 8.8 Hex Bolts',
      category: 'PHYSICAL_GOODS',
      source_type: 'SUPPLIER_B2B_CATALOG'
    });

    const result = await pipeline.processDiscovery({
      candidate_id: 'CAND-LUDHIANA-BOLTS',
      canonical_product_id: 'prod:ludhiana:bolts:8-8',
      observation: obs,
      jurisdiction: 'IN',
      industry: 'COLD_FORGED_FASTENERS'
    });

    expect(result.applied_playbooks).toContain('INDIAN_SME_DIRECTORY_CLASSIFICATION_VERIFICATION');

    const cand = galleryStore.getCandidate('CAND-LUDHIANA-BOLTS');
    expect(cand?.applicable_procedural_memories.length).toBe(1);
    expect(cand?.applicable_procedural_memories[0].memory_id).toBe(playbook.memory_id);
    expect(cand?.applicable_procedural_memories[0].applicability_reason).toContain('APPLICABLE');
  });

  // ============================================================================
  // TEST-GAL-07: LLM interactions remain evidence-grounded
  // ============================================================================
  it('TEST-GAL-07: LLM interactions remain evidence-grounded without floating point math', async () => {
    const galleryStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    const agent = new GalleryIntelligenceAgent(galleryStore);

    const cand = await galleryStore.ingestDiscoveredCandidate({
      candidate_id: 'CAND-PUMP-GROUNDED',
      canonical_product_id: 'prod:pump:5hp',
      name: 'Coimbatore 5HP Borewell Pump',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      source_url: 'https://trade.example.com/pump-5hp',
      financial_summary: {
        factory_gate_quote_inr: null,
        prevailing_retail_asp_inr: 18500,
        estimated_gross_margin_bps: null,
        data_required_fields: ['factory_gate_quote_inr', 'winding_insulation_spec']
      },
      initial_supporting_evidence: ['EVID-GROUNDED-01']
    });

    await galleryStore.linkEvidenceToCandidate({
      candidate_id: cand.candidate_id,
      evidence_id: 'EVID-CONFLICT-01',
      is_contradiction: true,
      rationale: 'Trader claiming in-house casting facility contrary to DIC industrial registry.'
    });

    const response = await agent.queryCandidate(cand.candidate_id, 'What is known about this pump candidate?');

    expect(response.target_id).toBe(cand.candidate_id);
    expect(response.target_type).toBe('CANDIDATE');
    expect(response.deterministic_guard_asserted).toBe(true);

    // Epistemic classification assertions
    expect(response.epistemic_breakdown.observed_facts.length).toBeGreaterThan(0);
    expect(response.cited_evidence_ids).toContain('EVID-GROUNDED-01');
    expect(response.cited_evidence_ids).toContain('EVID-CONFLICT-01');

    // Missing fields assertion
    expect(response.missing_data_fields).toContain('factory_gate_quote_inr');

    // Contradiction awareness
    expect(response.identified_contradictions.length).toBe(1);
    expect(response.identified_contradictions[0]).toContain('EVID-CONFLICT-01');

    // Natural language explanation contains required tags
    expect(response.natural_language_explanation).toContain('DATA_REQUIRED');
    expect(response.natural_language_explanation).toContain('CONTRADICTIONS');
  });

  // ============================================================================
  // TEST-GAL-08: Events update gallery projections without duplicate records
  // ============================================================================
  it('TEST-GAL-08: Events update gallery projections without duplicate records', async () => {
    const store = new PersistentGalleryStore({ journalDir: galleryJournalDir });

    await store.ingestDiscoveredCandidate({
      candidate_id: 'CAND-IDEMPOTENT-01',
      canonical_product_id: 'prod:idempotent',
      name: 'Idempotent Item',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE'
    });

    expect(store.getCandidateCount()).toBe(1);

    // Update candidate multiple times
    await store.updateCandidate('CAND-IDEMPOTENT-01', { lifecycle_state: 'INVESTIGATE' });
    await store.updateCandidate('CAND-IDEMPOTENT-01', { lifecycle_state: 'UNDER_REVIEW' });
    await store.updateCandidate('CAND-IDEMPOTENT-01', { lifecycle_state: 'VERIFIED' });

    // Candidate count must remain strictly 1 (no duplicate candidates spawned by updates!)
    expect(store.getCandidateCount()).toBe(1);
    expect(store.getCandidate('CAND-IDEMPOTENT-01')?.lifecycle_state).toBe('VERIFIED');
    expect(store.getEventCount()).toBe(4); // 1 discover + 3 updates
  });

  // ============================================================================
  // TEST-GAL-09: Reconnection and replay recover missed updates
  // ============================================================================
  it('TEST-GAL-09: Reconnection and replay recover missed updates', async () => {
    const store = new PersistentGalleryStore({ journalDir: galleryJournalDir });

    await store.ingestDiscoveredCandidate({
      candidate_id: 'CAND-REPLAY-01',
      canonical_product_id: 'prod:replay',
      name: 'Replay Test Item',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE'
    });

    await store.formulateThesis({
      thesis_id: 'THS-REPLAY-01',
      title: 'Replay Thesis',
      scope: 'PRODUCT',
      hypothesis_statement: 'Testing replay'
    });

    await store.updateCandidate('CAND-REPLAY-01', { lifecycle_state: 'INVESTIGATE' });

    const totalEvents = store.getEventCount();
    expect(totalEvents).toBe(3);

    // Client was connected up to sequence 1; missed sequences 2 and 3
    const replayed = store.replayEvents(1);
    expect(replayed.length).toBe(2);
    expect(replayed[0].sequence_number).toBe(2);
    expect(replayed[0].event_type).toBe('THESIS_FORMULATED');
    expect(replayed[1].sequence_number).toBe(3);
    expect(replayed[1].event_type).toBe('CANDIDATE_UPDATED');
  });

  // ============================================================================
  // TEST-GAL-10: Physical goods and software candidates coexist without category leaks
  // ============================================================================
  it('TEST-GAL-10: Physical goods and software candidates coexist without category-specific assumptions leaking', async () => {
    const galleryStore = new PersistentGalleryStore({ journalDir: galleryJournalDir });
    const memoryStore = new PersistentMemoryStore({ journalPath: memoryJournalPath });
    const retriever = new ContextualMemoryRetriever(memoryStore);
    const taskQueue = new InvestigationTaskQueue();
    const bridge = new InvestigationMemoryBridge(memoryStore, retriever, taskQueue);
    const pipeline = new DiscoveryGalleryPipeline(galleryStore, memoryStore, retriever, bridge, taskQueue);

    // 1. Ingest Physical Goods Candidate (Submersible Pump)
    const physicalObs = createTestObservation({
      candidate_name: 'Coimbatore 5HP Submersible Pump',
      category: 'PHYSICAL_GOODS',
      factory_gate_quote_inr: null,
      prevailing_retail_asp_inr: 18500
    });

    const physicalResult = await pipeline.processDiscovery({
      candidate_id: 'CAND-PHYSICAL-PUMP',
      canonical_product_id: 'prod:coimbatore:pump',
      observation: physicalObs,
      jurisdiction: 'IN'
    });

    // 2. Ingest Software / Digital Service Candidate (Developer OCR API Utility)
    const softwareObs = createTestObservation({
      candidate_name: 'Document Intelligence OCR Developer API (Monthly SaaS)',
      category: 'SOFTWARE_DIGITAL',
      source_type: 'SUPPLIER_B2B_CATALOG',
      factory_gate_quote_inr: null, // Software has NO factory gate quote!
      prevailing_retail_asp_inr: 4999 // Subscription billing
    });

    const softwareResult = await pipeline.processDiscovery({
      candidate_id: 'CAND-SOFTWARE-OCR',
      canonical_product_id: 'prod:saas:ocr:api',
      observation: softwareObs,
      jurisdiction: 'IN'
    });

    // Verify both coexist in the same Living Product Gallery
    expect(galleryStore.getCandidateCount()).toBe(2);
    expect(galleryStore.getCandidate('CAND-PHYSICAL-PUMP')?.category).toBe('PHYSICAL_GOODS');
    expect(galleryStore.getCandidate('CAND-SOFTWARE-OCR')?.category).toBe('SOFTWARE_DIGITAL');

    // Verify Category Insulation:
    // Physical goods require factory gate quote and logistics route
    expect(physicalResult.preserved_critical_fields).toContain('factory_gate_quote_inr');
    expect(physicalResult.preserved_critical_fields).toContain('logistics_freight_corridor');

    // Software DOES NOT require factory gate quote or physical freight!
    expect(softwareResult.preserved_critical_fields).not.toContain('factory_gate_quote_inr');
    expect(softwareResult.preserved_critical_fields).not.toContain('logistics_freight_corridor');
    expect(softwareResult.preserved_critical_fields).toContain('statutory_regulatory_clearance');

    // Inspect tasks generated for software candidate: MUST NOT contain factory quote task!
    const softwareCandidate = galleryStore.getCandidate('CAND-SOFTWARE-OCR');
    const softwareTaskTypes = softwareCandidate?.outstanding_tasks.map((t) => t.task_type) || [];
    expect(softwareTaskTypes).not.toContain('VERIFY_FACTORY_QUOTE');
    expect(softwareTaskTypes).not.toContain('VERIFY_LOGISTICS_AND_FREIGHT');
  });
});
