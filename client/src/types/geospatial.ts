export type GeoEpistemicStatus =
  | 'VERIFIED'
  | 'CORROBORATED'
  | 'OBSERVED'
  | 'HISTORICAL'
  | 'FIXTURE'
  | 'CONTRADICTED'
  | 'DATA_REQUIRED';

export type GeographicPrecisionType =
  | 'VERIFIED_PHYSICAL_FACILITY'
  | 'VERIFIED_REGISTERED_OFFICE'
  | 'INDUSTRIAL_ESTATE_CENTROID'
  | 'CITY_OR_LOCALITY_REFERENCE'
  | 'PORT_OR_LOGISTICS_REFERENCE'
  | 'APPROXIMATE_LOCATION'
  | 'UNVERIFIED_LOCATION'
  | 'DATA_REQUIRED';

export type IdentifierVerificationStatus =
  | 'PRIMARY_SOURCE_VERIFIED'
  | 'REGISTRY_LOOKUP_CORROBORATED'
  | 'SYNTHETIC_DEMO_FIXTURE'
  | 'FORMAT_VALID_ONLY'
  | 'UNVERIFIED_CLAIM'
  | 'DATA_REQUIRED';

export type FacilityType =
  | 'MANUFACTURING_FOUNDRY'
  | 'CNC_MACHINING_PLANT'
  | 'HANDICRAFT_ARTISAN_WORKSHOP'
  | 'CHEMICAL_FRAGRANCE_COMPOUNDING'
  | 'SWITCHGEAR_FABRICATION'
  | 'WHOLESALE_TRADER_DEPOT'
  | 'CLOUD_SOFTWARE_PROVIDER';

export interface BitemporalObservationTick {
  readonly timestamp_utc: string;
  readonly year: number;
  readonly observation_type: string;
  readonly prevailing_metric: string;
  readonly evidence_source: string;
  readonly valid_from_utc?: string;
  readonly valid_to_utc?: string | null;
  readonly transaction_recorded_at_utc?: string;
  readonly epistemic_class?: 'PRIMARY_OBSERVATION' | 'HISTORICAL_CACHE' | 'DEMO_FIXTURE' | 'USER_ASSUMPTION';
}

export interface GeoClusterNode {
  readonly id: string;
  readonly name: string;
  readonly hub_name: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly is_unlocated_digital: boolean;
  readonly geographic_precision: GeographicPrecisionType;
  readonly coordinate_source_description: string;
  readonly precision_radius_meters: number | null;
  readonly entity_name: string;
  readonly registered_office_address?: string;
  readonly physical_facility_address?: string;
  readonly cin?: string;
  readonly gstin?: string;
  readonly statutory_identifier_status: IdentifierVerificationStatus;
  readonly facility_type: FacilityType;
  readonly statutory_status: string;
  readonly product_name: string;
  readonly canonical_product_id: string;
  readonly candidate_id: string;
  readonly thesis_id: string;
  readonly category: string;
  readonly epistemic_status: GeoEpistemicStatus;
  readonly opportunity_conviction_bps: number;
  readonly supplier_confidence_bps: number;
  readonly thesis_underwriting_state: 'QUARANTINED_PENDING_AUDIT' | 'UNDER_REVIEW' | 'VERIFIED_ROBUST' | 'DATA_REQUIRED';
  readonly logistics_corridor: string;
  readonly logistics_corridor_type: 'PRIMARY_SOURCE_VERIFIED' | 'APPROXIMATE_GEOGRAPHIC_REFERENCE' | 'ILLUSTRATIVE_OVERLAY';
  readonly primary_port: string;
  readonly factory_quote_inr: number | null;
  readonly retail_asp_inr: number | null;
  readonly conflict_notes?: string;
  readonly historical_first_seen: string;
  readonly bitemporal_ticks: readonly BitemporalObservationTick[];
}

export interface LogisticsRouteOverlay {
  readonly id: string;
  readonly name: string;
  readonly from_hub_id: string;
  readonly to_hub_id: string;
  readonly distance_km: number;
  readonly highway_corridor: string;
  readonly transit_lead_time_days: number;
  readonly freight_cost_per_kg_inr: number;
  readonly route_classification: 'APPROXIMATE_GEOGRAPHIC_REFERENCE' | 'ILLUSTRATIVE_OVERLAY' | 'PRIMARY_SOURCE_VERIFIED';
}
