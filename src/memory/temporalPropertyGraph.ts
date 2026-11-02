/**
 * POC-001: Typed Temporal Property Graph (Stage B)
 *
 * Implements a commercial property graph that:
 * 1. Permits cycles across natural commercial relationships (e.g. mutual supply,
 *    common directorships, cross-holdings, bidirectional trade).
 * 2. Enforces acyclicity strictly on relationship types that require it (e.g. CAUSAL_DEPENDENCY).
 * 3. Supports bitemporal filtering: valid_time (valid_from to valid_to) and
 *    observation_time (observed_at to superseded_at).
 * 4. Preserves source-level provenance, epistemic status, and edge properties.
 */

import { sha256 } from '../canonical/crypto.js';
import { canonicalizeJCS } from '../canonical/jcs.js';
import { EpistemicStatus, SourceReliability, CorroborationLevel } from './memoryTypes.js';

export type GraphNodeType = 'ENTITY' | 'FACILITY' | 'PRODUCT' | 'THESIS' | 'CONCEPT' | 'CLUSTER';

export type GraphEdgeType =
  | 'SUPPLIES_TO'
  | 'SUBSIDIARY_OF'
  | 'SHARES_DIRECTOR_WITH'
  | 'MANUFACTURES'
  | 'CONSUMES_INPUT'
  | 'LOCATED_IN'
  | 'APPLIES_TO'
  | 'COMPETES_WITH'
  | 'CAUSAL_DEPENDENCY'
  | 'SUPERSEDES';

export interface GraphNode {
  readonly node_id: string;
  readonly node_type: GraphNodeType;
  readonly label: string;
  readonly properties: Record<string, unknown>;
  readonly epistemic_status: EpistemicStatus;
  readonly source_reliability: SourceReliability;
  readonly valid_from_utc: string;
  readonly valid_to_utc: string | null;
  readonly observed_at_utc: string;
  readonly superseded_at_utc: string | null;
  readonly jcs_sha256: string;
}

export interface GraphEdge {
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly edge_type: GraphEdgeType;
  readonly properties: Record<string, unknown>;
  readonly epistemic_status: EpistemicStatus;
  readonly source_reliability: SourceReliability;
  readonly valid_from_utc: string;
  readonly valid_to_utc: string | null;
  readonly observed_at_utc: string;
  readonly superseded_at_utc: string | null;
  readonly jcs_sha256: string;
}

export class TemporalPropertyGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  // Adjacency index: from_node_id -> set of edge_ids
  private outEdges: Map<string, Set<string>> = new Map();
  // Reverse adjacency index: to_node_id -> set of edge_ids
  private inEdges: Map<string, Set<string>> = new Map();

  // Edge types that strictly forbid cycles
  private static readonly STRICTLY_ACYCLIC_EDGE_TYPES: ReadonlySet<GraphEdgeType> = new Set([
    'CAUSAL_DEPENDENCY',
    'SUPERSEDES'
  ]);

  /**
   * Adds or updates a graph node.
   */
  public addNode(params: {
    node_id: string;
    node_type: GraphNodeType;
    label: string;
    properties?: Record<string, unknown>;
    epistemic_status?: EpistemicStatus;
    source_reliability?: SourceReliability;
    valid_from_utc?: string;
    valid_to_utc?: string | null;
    observed_at_utc?: string;
  }): GraphNode {
    const nowUtc = new Date().toISOString();
    const raw = {
      node_id: params.node_id,
      node_type: params.node_type,
      label: params.label,
      properties: params.properties ?? {},
      epistemic_status: params.epistemic_status ?? 'OBSERVED_FACT',
      source_reliability: params.source_reliability ?? 'DIRECT_SUPPLIER_DISCLOSURE',
      valid_from_utc: params.valid_from_utc ?? nowUtc,
      valid_to_utc: params.valid_to_utc ?? null,
      observed_at_utc: params.observed_at_utc ?? nowUtc,
      superseded_at_utc: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const node: GraphNode = Object.freeze({ ...raw, jcs_sha256: hash });

    this.nodes.set(node.node_id, node);
    if (!this.outEdges.has(node.node_id)) this.outEdges.set(node.node_id, new Set());
    if (!this.inEdges.has(node.node_id)) this.inEdges.set(node.node_id, new Set());

    return node;
  }

  /**
   * Adds a directed edge between two existing nodes.
   * Allows commercial cycles (e.g. A supplies B, B supplies A).
   * Checks acyclicity ONLY for causal or supersession edges.
   */
  public addEdge(params: {
    edge_id?: string;
    from_node_id: string;
    to_node_id: string;
    edge_type: GraphEdgeType;
    properties?: Record<string, unknown>;
    epistemic_status?: EpistemicStatus;
    source_reliability?: SourceReliability;
    valid_from_utc?: string;
    valid_to_utc?: string | null;
    observed_at_utc?: string;
  }): GraphEdge {
    if (!this.nodes.has(params.from_node_id)) {
      throw new Error(`E-GRAPH-NODE-NOT-FOUND: from_node_id '${params.from_node_id}' does not exist`);
    }
    if (!this.nodes.has(params.to_node_id)) {
      throw new Error(`E-GRAPH-NODE-NOT-FOUND: to_node_id '${params.to_node_id}' does not exist`);
    }

    // Enforce acyclicity ONLY if this edge type strictly forbids cycles
    if (TemporalPropertyGraph.STRICTLY_ACYCLIC_EDGE_TYPES.has(params.edge_type)) {
      if (this.reachesNode(params.to_node_id, params.from_node_id, params.edge_type)) {
        throw new Error(
          `E-GRAPH-CYCLE-DETECTED: Acyclic relationship '${params.edge_type}' from '${params.from_node_id}' to '${params.to_node_id}' would create an illegal cycle`
        );
      }
    }

    const nowUtc = new Date().toISOString();
    const edgeId = params.edge_id ?? `EDGE-${params.from_node_id}-${params.edge_type}-${params.to_node_id}`;

    const raw = {
      edge_id: edgeId,
      from_node_id: params.from_node_id,
      to_node_id: params.to_node_id,
      edge_type: params.edge_type,
      properties: params.properties ?? {},
      epistemic_status: params.epistemic_status ?? 'OBSERVED_FACT',
      source_reliability: params.source_reliability ?? 'DIRECT_SUPPLIER_DISCLOSURE',
      valid_from_utc: params.valid_from_utc ?? nowUtc,
      valid_to_utc: params.valid_to_utc ?? null,
      observed_at_utc: params.observed_at_utc ?? nowUtc,
      superseded_at_utc: null
    };

    const hash = sha256(canonicalizeJCS(raw));
    const edge: GraphEdge = Object.freeze({ ...raw, jcs_sha256: hash });

    this.edges.set(edge.edge_id, edge);
    this.outEdges.get(params.from_node_id)!.add(edge.edge_id);
    this.inEdges.get(params.to_node_id)!.add(edge.edge_id);

    return edge;
  }

  /**
   * Checks if targetId is reachable from startId via edges of a specific edgeType.
   */
  public reachesNode(startId: string, targetId: string, edgeType?: GraphEdgeType): boolean {
    if (startId === targetId) return true;
    const visited = new Set<string>();
    const queue: string[] = [startId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === targetId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const outEdgeIds = this.outEdges.get(current);
      if (!outEdgeIds) continue;

      for (const eId of outEdgeIds) {
        const edge = this.edges.get(eId);
        if (edge && (!edgeType || edge.edge_type === edgeType) && edge.superseded_at_utc === null) {
          queue.push(edge.to_node_id);
        }
      }
    }

    return false;
  }

  /**
   * Retrieves active neighbors of a node.
   */
  public getNeighbors(nodeId: string, direction: 'OUT' | 'IN' | 'BOTH' = 'OUT'): { node: GraphNode; edge: GraphEdge }[] {
    const results: { node: GraphNode; edge: GraphEdge }[] = [];
    if (direction === 'OUT' || direction === 'BOTH') {
      const outEdgeIds = this.outEdges.get(nodeId);
      if (outEdgeIds) {
        for (const eId of outEdgeIds) {
          const edge = this.edges.get(eId);
          if (edge && edge.superseded_at_utc === null) {
            const targetNode = this.nodes.get(edge.to_node_id);
            if (targetNode && targetNode.superseded_at_utc === null) {
              results.push({ node: targetNode, edge });
            }
          }
        }
      }
    }
    if (direction === 'IN' || direction === 'BOTH') {
      const inEdgeIds = this.inEdges.get(nodeId);
      if (inEdgeIds) {
        for (const eId of inEdgeIds) {
          const edge = this.edges.get(eId);
          if (edge && edge.superseded_at_utc === null) {
            const sourceNode = this.nodes.get(edge.from_node_id);
            if (sourceNode && sourceNode.superseded_at_utc === null) {
              results.push({ node: sourceNode, edge });
            }
          }
        }
      }
    }
    return results;
  }

  /**
   * Temporal graph slice: returns nodes and edges valid as of a specific timestamp.
   */
  public snapshotAsOf(asOfUtc: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const asOfTime = new Date(asOfUtc).getTime();

    const activeNodes = Array.from(this.nodes.values()).filter((n) => {
      const validFrom = new Date(n.valid_from_utc).getTime();
      const validTo = n.valid_to_utc ? new Date(n.valid_to_utc).getTime() : Infinity;
      const isObservationActive = n.superseded_at_utc === null || new Date(n.superseded_at_utc).getTime() > asOfTime;
      return validFrom <= asOfTime && asOfTime <= validTo && isObservationActive;
    });

    const activeNodeIds = new Set(activeNodes.map((n) => n.node_id));

    const activeEdges = Array.from(this.edges.values()).filter((e) => {
      const validFrom = new Date(e.valid_from_utc).getTime();
      const validTo = e.valid_to_utc ? new Date(e.valid_to_utc).getTime() : Infinity;
      const isObservationActive = e.superseded_at_utc === null || new Date(e.superseded_at_utc).getTime() > asOfTime;
      return (
        validFrom <= asOfTime &&
        asOfTime <= validTo &&
        isObservationActive &&
        activeNodeIds.has(e.from_node_id) &&
        activeNodeIds.has(e.to_node_id)
      );
    });

    return { nodes: activeNodes, edges: activeEdges };
  }

  public getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  public getEdge(edgeId: string): GraphEdge | undefined {
    return this.edges.get(edgeId);
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getEdgeCount(): number {
    return this.edges.size;
  }
}
