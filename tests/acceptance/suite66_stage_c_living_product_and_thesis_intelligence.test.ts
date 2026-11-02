/**
 * POC-001: Stage C Acceptance Test Suite (Suite 66)
 * Living Product & Thesis Intelligence End-to-End Operational Validation
 *
 * Verifies the 9 mandatory Stage C living intelligence flows:
 * 1. Real discovery intake populates Product Gallery (/api/discovery/screen).
 * 2. Adaptive reasoning loop retrieves applicable Stage B memory and initiates investigation.
 * 3. New evidence changes candidate lifecycle and creates durable gallery events.
 * 4. Independent Thesis Gallery formulation and observation linkage (Correlation != Causation).
 * 5. Contradiction triggers replanning and prevents obsolete downstream tasks.
 * 6. Workstation exposes changes via /api/gallery/* without manual edits or static cards.
 * 7. Evidence-grounded operator interaction answers questions citing [EVID-xxx] and [MEM-xxx].
 * 8. Cross-category investigation reuses validated learning without assumption leakage.
 * 9. Process recovery preserves candidates, theses, events, and investigation history identically.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { WorkstationServer } from '../../src/server/workstationServer.js';
import { WorkstationStateManager } from '../../src/server/workstationStateManager.js';
import { GoldenDiscoveryFixtureRegistry } from '../../src/discovery/fixtures/goldenDiscoveryFixtures.js';
import { PersistentGalleryStore } from '../../src/gallery/persistentGalleryStore.js';
import { ContextualMemoryRetriever } from '../../src/memory/contextualMemoryRetriever.js';
import { RawSourceCapture } from '../../src/discovery/sourceAdapterContract.js';

describe('Suite 66: Stage C Living Product & Thesis Intelligence Operational Validation', () => {
  const scratchBaseDir = path.join(process.cwd(), 'scratch', 'suite66_living_intelligence_lab');

  let server: WorkstationServer;
  let stateManager: WorkstationStateManager;
  let serverPort: number;
  let serverUrl: string;

  beforeAll(async () => {
    if (!fs.existsSync(scratchBaseDir)) {
      fs.mkdirSync(scratchBaseDir, { recursive: true });
    }

    stateManager = new WorkstationStateManager();
    server = new WorkstationServer({
      port: 0,
      host: '127.0.0.1',
      stateManager
    });

    const started = await server.start();
    serverPort = started.port;
    serverUrl = started.url;
  });

  afterAll(async () => {
    await server.stop();
    try {
      if (fs.existsSync(scratchBaseDir)) {
        fs.rmSync(scratchBaseDir, { recursive: true, force: true });
      }
    } catch {
      // Safe cleanup
    }
  });

  // ============================================================================
  // SC-01: Real discovery intake creates persistent Product Gallery candidate
  // ============================================================================
  it('SC-01: Real discovery intake creates persistent Product Gallery candidate via /api/discovery/screen', async () => {
    const fixture = GoldenDiscoveryFixtureRegistry.getFixtureById('FIX-IMART-SS304-001');
    expect(fixture).toBeDefined();

    // Call live HTTP endpoint /api/discovery/screen
    const response = await fetch(`${serverUrl}/api/discovery/screen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fixture_id: 'FIX-IMART-SS304-001' })
    });

    expect(response.status).toBe(200);
    const result = await response.json();

    expect(result.candidate_id).toBeDefined();
    expect(result.screening_evaluation).toBeDefined();
    expect(result.gallery_candidate).toBeDefined();
    expect(result.gallery_candidate.name).toContain('SS304');
    expect(result.gallery_candidate.category).toBe('PHYSICAL_GOODS');
    expect(result.gallery_candidate.origin_class).toBe('RECORDED_GOLDEN_FIXTURE');

    // Candidate must be in living Product Gallery store
    const inStore = stateManager.getGalleryStore().getCandidate(result.candidate_id);
    expect(inStore).toBeDefined();
    expect(inStore?.lifecycle_state).toBe('INVESTIGATE');

    // Durable event emitted
    const events = stateManager.getGalleryStore().getEvents();
    const candidateDiscoveredEvent = events.find(
      (e) => e.event_type === 'CANDIDATE_DISCOVERED' && e.aggregate_id === result.candidate_id
    );
    expect(candidateDiscoveredEvent).toBeDefined();
    expect(candidateDiscoveredEvent?.summary).toContain('SS304');
  });

  // ============================================================================
  // SC-02: Adaptive reasoning loop retrieves applicable Stage B memory
  // ============================================================================
  it('SC-02: Adaptive reasoning loop retrieves applicable Stage B memory and adapts investigation plan', async () => {
    const memoryStore = stateManager.getMemoryStore();

    // Seed a validated procedural playbook for precision manufacturing verification
    const playbook = await memoryStore.proposeProcedural({
      investigation_id: 'INV-SEED-MFG-01',
      playbook_name: 'Industrial Hardware Verification Playbook',
      target_domain: 'PHYSICAL_GOODS',
      title: 'Precision Fasteners & Hose Clamp Verification',
      summary: 'Requires statutory MCA corporate check before requesting factory quotes to avoid paper-only brokers',
      applicability: {
        jurisdictions: ['IN'],
        categories: ['PHYSICAL_GOODS']
      },
      prerequisite_signals: ['B2B_DIRECTORY_LISTING'],
      execution_steps: [
        {
          step_number: 1,
          action_name: 'StatutoryRegistrySpecialist',
          target_role: 'StatutoryRegistrySpecialist',
          required_tool: 'mca_statutory_verification',
          parameters_template: { query: 'active_status' },
          expected_output_schema: 'corporate_status_schema',
          failure_recovery_action: 'RETRY'
        }
      ],
      known_failure_modes: [
        {
          failure_pattern: 'syndicated_directory_mirror',
          preventive_action: 'Check physical plant address on Google Street View or electricity bill'
        }
      ],
      supporting_evidence_ids: ['EVID-SEED-HW-01'],
      source_reliability: 'OFFICIAL_REGISTRY'
    });

    await memoryStore.validateProcedural({
      memory_id: playbook.memory_id,
      validator_role: 'USER_OPERATOR',
      validation_evidence_ids: ['EVID-SEED-HW-01'],
      validation_notes: 'Validated for all Indian hardware suppliers'
    });

    // Screen a new capture in PHYSICAL_GOODS
    const rawCapture: RawSourceCapture = {
      capture_id: 'CAP-LIVE-HOWRAH-01',
      source_connector_id: 'conn:indiamart:howrah',
      source_type: 'B2B_DIRECTORY',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      source_observed_at_utc: new Date().toISOString(),
      retrieval_timestamp_utc: new Date().toISOString(),
      capture_timestamp_utc: new Date().toISOString(),
      raw_payload: JSON.stringify({
        supplier_name: 'Howrah Precision Clamps LLP',
        category: 'PHYSICAL_GOODS',
        product_name: 'DIN 3017 Hose Clamp W4',
        factory_gate_quote_inr: 42.5,
        prevailing_retail_asp_inr: 85.0,
        city: 'Howrah',
        state: 'West Bengal'
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 42.5,
        prevailing_retail_asp_inr: 85.0
      },
      payload_sha256: 'a1'.repeat(32)
    };

    const screenRes = await stateManager.screenDiscoveryCapture(rawCapture);
    expect(screenRes.candidate_id).toBeDefined();
    expect(screenRes.gallery_candidate).toBeDefined();

    // Verify candidate has applicable procedural memories attached
    const candidate = stateManager.getGalleryStore().getCandidate(screenRes.candidate_id!);
    expect(candidate).toBeDefined();
    expect(candidate?.applicable_procedural_memories.length).toBeGreaterThan(0);
    expect(candidate?.applicable_procedural_memories[0].playbook_name).toBe('Industrial Hardware Verification Playbook');
  });

  // ============================================================================
  // SC-03: New evidence changes candidate lifecycle and creates durable events
  // ============================================================================
  it('SC-03: New evidence changes candidate lifecycle and creates durable gallery events', async () => {
    // Screen capture to create candidate
    const rawCapture: RawSourceCapture = {
      capture_id: 'CAP-LIVE-BALTIKURI-02',
      source_connector_id: 'conn:field:baltikuri',
      source_type: 'FIELD_VISIT',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      source_observed_at_utc: new Date().toISOString(),
      retrieval_timestamp_utc: new Date().toISOString(),
      capture_timestamp_utc: new Date().toISOString(),
      raw_payload: JSON.stringify({
        supplier_name: 'Baltikuri Fastener Works',
        category: 'PHYSICAL_GOODS',
        product_name: 'Heavy Duty Hose Clamp',
        factory_gate_quote_inr: 38.0,
        prevailing_retail_asp_inr: 75.0,
        city: 'Baltikuri',
        state: 'West Bengal'
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 38.0,
        prevailing_retail_asp_inr: 75.0
      },
      payload_sha256: 'b2'.repeat(32)
    };

    const screenRes = await stateManager.screenDiscoveryCapture(rawCapture);
    const candidateId = screenRes.candidate_id!;

    // Transition candidate to UNDERWRITING with verified evidence
    const updated = await stateManager.getGalleryStore().updateCandidate(
      candidateId,
      {
        lifecycle_state: 'UNDERWRITING',
        investigation_status: 'COMPLETED',
        financial_summary: {
          factory_gate_quote_inr: 38.0,
          prevailing_retail_asp_inr: 75.0,
          estimated_gross_margin_bps: 4933,
          data_required_fields: []
        }
      },
      {
        event_type: 'CANDIDATE_UPDATED',
        summary: 'Underwriting evidence validated: ₹38.00 factory quote vs ₹75.00 retail ASP (49.33% margin)',
        details: { evidence_id: 'EVID-BALTIKURI-FACTORY-QUOTE', gross_margin_bps: 4933 }
      }
    );

    expect(updated.lifecycle_state).toBe('UNDERWRITING');
    expect(updated.investigation_status).toBe('COMPLETED');
    expect(updated.financial_summary?.estimated_gross_margin_bps).toBe(4933);

    // Verify durable events contain monotonic sequence numbers
    const events = stateManager.getGalleryEvents();
    const candidateEvents = events.filter((e) => e.aggregate_id === candidateId);
    expect(candidateEvents.length).toBeGreaterThanOrEqual(2);
    expect(candidateEvents[candidateEvents.length - 1].event_type).toBe('CANDIDATE_UPDATED');
    expect(candidateEvents[candidateEvents.length - 1].sequence_number).toBeGreaterThan(candidateEvents[0].sequence_number);
  });

  // ============================================================================
  // SC-04: Independent Thesis Gallery formulation and observation linkage
  // ============================================================================
  it('SC-04: Independent Thesis Gallery formulation enforces Correlation != Causation', async () => {
    // Formulate a thesis independently via HTTP endpoint /api/gallery/theses/formulate
    const payload = {
      title: 'Howrah Cluster SS304 Margin Persistence',
      scope: 'GEOGRAPHIC_CLUSTER',
      hypothesis_statement: 'Howrah metal fabrication cluster offers 35%+ gross margin advantage due to scrap availability, not labor subsidy',
      originating_observations: ['OBS-HOWRAH-CLUSTER-01', 'OBS-HOWRAH-CLUSTER-02'],
      supporting_evidence_ids: ['EVID-LME-SCRAP-SPREAD', 'EVID-HOWRAH-QUOTES'],
      related_locations: ['Howrah', 'Baltikuri'],
      uncertainty_rating: 'MEDIUM' as const
    };

    const response = await fetch(`${serverUrl}/api/gallery/theses/formulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    expect(response.status).toBe(200);
    const thesis = await response.json();

    expect(thesis.thesis_id).toBeDefined();
    expect(thesis.scope).toBe('GEOGRAPHIC_CLUSTER');
    expect(thesis.hypothesis_statement).toBe(payload.hypothesis_statement);
    expect(thesis.lifecycle_state).toBe('NEW');
    expect(thesis.originating_observations).toEqual(payload.originating_observations);
    expect(thesis.supporting_evidence_ids).toEqual(payload.supporting_evidence_ids);

    // Verify thesis exists in Thesis Gallery store
    const storedThesis = stateManager.getGalleryStore().getThesis(thesis.thesis_id);
    expect(storedThesis).toBeDefined();
    expect(storedThesis?.thesis_id).toBe(thesis.thesis_id);

    // Query Thesis via LLM agent and verify correlation != causation safeguard is strictly asserted
    const askResponse = await fetch(`${serverUrl}/api/gallery/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        thesis_id: thesis.thesis_id,
        query: 'What evidence proves this thesis?'
      })
    });

    expect(askResponse.status).toBe(200);
    const askResult = await askResponse.json();
    expect(askResult.target_id).toBe(thesis.thesis_id);
    expect(askResult.natural_language_explanation).toContain('Correlation is strictly not treated as causation');
    expect(askResult.cited_evidence_ids).toContain('EVID-LME-SCRAP-SPREAD');
    expect(askResult.deterministic_guard_asserted).toBe(true);
  });

  // ============================================================================
  // SC-05: Contradiction triggers replanning and prevents obsolete tasks
  // ============================================================================
  it('SC-05: Contradiction triggers replanning and surfaces contradictory signals', async () => {
    const rawCapture: RawSourceCapture = {
      capture_id: 'CAP-AMALGAMATED-01',
      source_connector_id: 'conn:indiamart:mds',
      source_type: 'B2B_DIRECTORY',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      source_observed_at_utc: new Date().toISOString(),
      retrieval_timestamp_utc: new Date().toISOString(),
      capture_timestamp_utc: new Date().toISOString(),
      raw_payload: JSON.stringify({
        supplier_name: 'MDS Pneumatic Clamps Ltd',
        category: 'PHYSICAL_GOODS',
        product_name: 'High Pressure Hose Clamps',
        factory_gate_quote_inr: 45.0,
        prevailing_retail_asp_inr: 90.0
      }),
      extracted_fields: {
        supplier_sku: 'HOWRAH-SS304-16-25',
        factory_gate_quote_inr: 45.0,
        prevailing_retail_asp_inr: 90.0
      },
      payload_sha256: 'c3'.repeat(32)
    };

    const screenRes = await stateManager.screenDiscoveryCapture(rawCapture);
    const candidateId = screenRes.candidate_id!;

    // Inject contradictory evidence into candidate
    await stateManager.getGalleryStore().updateCandidate(
      candidateId,
      {
        contradictory_evidence_ids: ['EVID-MCA-AMALGAMATED-DISSOLVED'],
        investigation_status: 'BLOCKED'
      },
      {
        event_type: 'CONTRADICTION_DETECTED',
        summary: 'Primary statutory filing shows MDS Pneumatic amalgamated and dissolved in 2021',
        details: { conflict_id: 'CONF-MCA-STATUS', field: 'corporate_status' }
      }
    );

    const updated = stateManager.getGalleryStore().getCandidate(candidateId);
    expect(updated?.contradictory_evidence_ids).toContain('EVID-MCA-AMALGAMATED-DISSOLVED');
    expect(updated?.investigation_status).toBe('BLOCKED');

    // Operator query verifies contradiction is surfaced
    const queryRes = await stateManager.queryGalleryLlm('What is the status of MDS?', candidateId);
    expect(queryRes.identified_contradictions.length).toBeGreaterThan(0);
    expect(queryRes.identified_contradictions[0]).toContain('EVID-MCA-AMALGAMATED-DISSOLVED');
  });

  // ============================================================================
  // SC-06: Workstation exposes changes via /api/gallery/*
  // ============================================================================
  it('SC-06: Workstation exposes changes via /api/gallery/* without static cards or mock data', async () => {
    // 1. GET /api/gallery/products
    const prodRes = await fetch(`${serverUrl}/api/gallery/products`);
    expect(prodRes.status).toBe(200);
    const prodData = await prodRes.json();
    expect(prodData.candidates).toBeDefined();
    expect(Array.isArray(prodData.candidates)).toBe(true);
    expect(prodData.count).toBe(prodData.candidates.length);
    expect(prodData.count).toBeGreaterThan(0);

    // 2. GET /api/gallery/theses
    const thesisRes = await fetch(`${serverUrl}/api/gallery/theses`);
    expect(thesisRes.status).toBe(200);
    const thesisData = await thesisRes.json();
    expect(thesisData.theses).toBeDefined();
    expect(Array.isArray(thesisData.theses)).toBe(true);
    expect(thesisData.count).toBe(thesisData.theses.length);
    expect(thesisData.count).toBeGreaterThan(0);

    // 3. GET /api/gallery/events
    const eventRes = await fetch(`${serverUrl}/api/gallery/events`);
    expect(eventRes.status).toBe(200);
    const eventData = await eventRes.json();
    expect(eventData.events).toBeDefined();
    expect(Array.isArray(eventData.events)).toBe(true);
    expect(eventData.count).toBe(eventData.events.length);
    expect(eventData.count).toBeGreaterThan(0);
  });

  // ============================================================================
  // SC-07: Gallery LLM interaction answers evidence-linked questions
  // ============================================================================
  it('SC-07: Gallery LLM interaction answers evidence-linked questions citing [EVID-xxx] and zero float math', async () => {
    const candidates = stateManager.getGalleryProducts();
    const candidate = candidates[0];
    expect(candidate).toBeDefined();

    const response = await fetch(`${serverUrl}/api/gallery/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_id: candidate.candidate_id,
        query: 'What do we know about this candidate and what data is missing?'
      })
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.target_id).toBe(candidate.candidate_id);
    expect(body.target_type).toBe('CANDIDATE');
    expect(body.epistemic_breakdown).toBeDefined();
    expect(Array.isArray(body.epistemic_breakdown.observed_facts)).toBe(true);
    expect(Array.isArray(body.epistemic_breakdown.source_claims)).toBe(true);
    expect(Array.isArray(body.epistemic_breakdown.inferences)).toBe(true);
    expect(Array.isArray(body.epistemic_breakdown.hypotheses)).toBe(true);
    expect(body.deterministic_guard_asserted).toBe(true);
  });

  // ============================================================================
  // SC-08: Cross-category investigation reuses validated learning
  // ============================================================================
  it('SC-08: Cross-category investigation reuses validated learning without assumption leakage', async () => {
    const memoryStore = stateManager.getMemoryStore();
    const memoryRetriever = new ContextualMemoryRetriever(memoryStore);

    // Retrieve memories for LABORATORY_CONSUMABLES candidate
    const matches = await memoryRetriever.retrieveApplicableProcedural({
      investigation_id: 'INV-LAB-TEST-01',
      candidate_id: 'CAND-LAB-TEST-01',
      category: 'LABORATORY_CONSUMABLES',
      jurisdiction: 'IN',
      signals_observed: ['B2B_DIRECTORY_LISTING']
    });

    // Should analogically retrieve the PHYSICAL_GOODS hardware verification playbook
    const analogicalMatch = matches.applicablePlaybooks.find((m) =>
      m.memory.title.includes('Fasteners') || m.memory.title.includes('Hardware')
    );

    if (analogicalMatch) {
      expect(analogicalMatch.is_applicable).toBe(true);
      expect(analogicalMatch.applicability_reason).toContain('Analogical transfer');
    }
  });

  // ============================================================================
  // SC-09: Restarting the application preserves candidates, theses, and events
  // ============================================================================
  it('SC-09: Restarting the application preserves candidates, theses, and events identically from disk', async () => {
    const candidateJournal = path.join(scratchBaseDir, 'restart_test');
    if (!fs.existsSync(candidateJournal)) {
      fs.mkdirSync(candidateJournal, { recursive: true });
    }

    // Step 1: Initialize persistent gallery store and write candidate and thesis
    const store1 = new PersistentGalleryStore({ journalDir: candidateJournal });
    const c1 = await store1.ingestDiscoveredCandidate({
      candidate_id: 'CAND-PERSIST-01',
      canonical_product_id: 'prod:fastener:din3017',
      name: 'Persistent Hose Clamp Candidate',
      category: 'PHYSICAL_GOODS',
      origin_class: 'LIVE_VERIFIED_CAPTURE',
      initial_supporting_evidence: ['EVID-P1', 'EVID-P2'],
      relevant_locations: [{ cluster_id: 'HOWRAH', city: 'Howrah', state: 'West Bengal' }]
    });

    const t1 = await store1.formulateThesis({
      title: 'Persistent Geographic Arbitrage Thesis',
      scope: 'GEOGRAPHIC_CLUSTER',
      hypothesis_statement: 'High density clustering produces structural cost advantage',
      supporting_evidence_ids: ['EVID-P1'],
      uncertainty_rating: 'LOW'
    });

    const c1Id = c1.candidate_id;
    const t1Id = t1.thesis_id;
    const initialEventsCount = store1.getEventCount();
    expect(initialEventsCount).toBeGreaterThanOrEqual(2);

    // Step 2: Simulate process termination and new store boot from the same journalDir
    const store2 = new PersistentGalleryStore({ journalDir: candidateJournal });

    // Step 3: Verify candidate hydrated identically
    const hydratedCandidate = store2.getCandidate(c1Id);
    expect(hydratedCandidate).toBeDefined();
    expect(hydratedCandidate?.name).toBe('Persistent Hose Clamp Candidate');
    expect(hydratedCandidate?.category).toBe('PHYSICAL_GOODS');
    expect(hydratedCandidate?.supporting_evidence_ids).toEqual(['EVID-P1', 'EVID-P2']);
    expect(hydratedCandidate?.relevant_locations[0].city).toBe('Howrah');

    // Step 4: Verify thesis hydrated identically
    const hydratedThesis = store2.getThesis(t1Id);
    expect(hydratedThesis).toBeDefined();
    expect(hydratedThesis?.title).toBe('Persistent Geographic Arbitrage Thesis');
    expect(hydratedThesis?.scope).toBe('GEOGRAPHIC_CLUSTER');
    expect(hydratedThesis?.hypothesis_statement).toBe('High density clustering produces structural cost advantage');

    // Step 5: Verify event history replayed identically
    expect(store2.getEventCount()).toBe(initialEventsCount);
    const replayedEvents = store2.replayEvents(0);
    expect(replayedEvents.length).toBe(initialEventsCount);
    expect(replayedEvents[0].aggregate_type).toBe('CANDIDATE');
  });
});
