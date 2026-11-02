import React, { useState, useMemo } from 'react';
import {
  MapPin,
  Layers,
  Search,
  Compass,
  Navigation,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  SlidersHorizontal,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Play,
  Pause,
  ArrowRight,
  Radio,
  Building2,
  Cpu,
  FileText,
  AlertTriangle,
  Info,
  CheckCircle2
} from 'lucide-react';
import { GeoClusterNode, GeoEpistemicStatus, FacilityType } from '../types/geospatial';
import { GEO_CLUSTER_NODES, LOGISTICS_ROUTES } from '../services/geospatialData';
import { WorkspaceRouteId } from './shell/NavigationRail';

export interface IntelligenceAtlasProps {
  onNavigate: (route: WorkspaceRouteId, contextId?: string) => void;
  onLaunchInvestigation?: (candidateId: string) => void;
}

export const IntelligenceAtlas: React.FC<IntelligenceAtlasProps> = ({
  onNavigate,
  onLaunchInvestigation,
}) => {
  // Map viewport & pan/zoom state
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Layer toggles
  const [showClusters, setShowClusters] = useState<boolean>(true);
  const [showLogisticsCorridors, setShowLogisticsCorridors] = useState<boolean>(true);
  const [showCatchmentRadius, setShowCatchmentRadius] = useState<boolean>(true);
  const [showPortsAndICDs, setShowPortsAndICDs] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedEpistemicStatus, setSelectedEpistemicStatus] = useState<string>('ALL');

  // Selected Geo Node for Dossier Inspector
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const n = new URLSearchParams(window.location.search).get('node');
      if (n) return n;
    }
    return 'GEO-HOWRAH-BALTIKURI-01';
  });

  // Bitemporal timeline scrubber (2020 - 2026)
  const [timelineYear, setTimelineYear] = useState<number>(2026);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState<boolean>(false);

  // Selected Node Object
  const selectedNode = useMemo(() => {
    return GEO_CLUSTER_NODES.find((n) => n.id === selectedNodeId) || GEO_CLUSTER_NODES[0];
  }, [selectedNodeId]);

  // Filtered Nodes
  const filteredNodes = useMemo(() => {
    return GEO_CLUSTER_NODES.filter((node) => {
      if (node.is_unlocated_digital) return true; // always list digital node in sidebar
      if (selectedCategory !== 'ALL' && node.category !== selectedCategory) return false;
      if (selectedEpistemicStatus !== 'ALL' && node.epistemic_status !== selectedEpistemicStatus) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          node.name.toLowerCase().includes(q) ||
          node.hub_name.toLowerCase().includes(q) ||
          node.entity_name.toLowerCase().includes(q) ||
          node.product_name.toLowerCase().includes(q) ||
          node.city.toLowerCase().includes(q) ||
          node.state.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [selectedCategory, selectedEpistemicStatus, searchQuery]);

  // Map Coordinate Projection (Equirectangular onto SVG 800 x 600 canvas)
  // India Bounds: Lon 68.0 to 92.0, Lat 8.0 to 33.0
  const projectCoordinates = (lat: number, lon: number): { x: number; y: number } => {
    const minLon = 68.0;
    const maxLon = 92.0;
    const minLat = 8.0;
    const maxLat = 33.0;

    const width = 800;
    const height = 600;

    const x = ((lon - minLon) / (maxLon - minLon)) * (width - 120) + 60;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * (height - 120) + 60;
    return { x, y };
  };

  // Pan event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPanOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Reset zoom & pan
  const handleResetViewport = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  return (
    <div className="h-full flex flex-col bg-[#080B10] text-[#E6EDF5] select-none font-sans overflow-hidden">
      {/* 1. Sub-Ribbon: Geographic Breadcrumb & Quick Jump */}
      <div className="h-10 bg-[#0C1118] border-b border-[#263342] px-3 flex items-center justify-between shrink-0 text-xs font-mono">
        <div className="flex items-center space-x-2">
          <Compass className="w-3.5 h-3.5 text-[#5794D6]" />
          <span className="font-bold text-[#E6EDF5] uppercase tracking-wide">
            GEOSPATIAL INTELLIGENCE ATLAS
          </span>
          <span className="text-[#263342]">|</span>
          <span className="text-[#A6B4C3] hidden md:inline">
            SOURCING CLUSTERS, LOGISTICS CORRIDORS & STATUTORY NODES
          </span>
        </div>

        {/* Quick Cluster Buttons */}
        <div className="flex items-center space-x-1 overflow-x-auto">
          <button
            onClick={() => {
              setSelectedNodeId('GEO-HOWRAH-BALTIKURI-01');
              setZoomLevel(1.4);
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
              selectedNodeId === 'GEO-HOWRAH-BALTIKURI-01'
                ? 'bg-[#172230] text-[#35B88A] border-[#35B88A]'
                : 'bg-[#111923] text-[#A6B4C3] border-[#263342] hover:text-[#E6EDF5]'
            }`}
          >
            Howrah (Fasteners)
          </button>
          <button
            onClick={() => {
              setSelectedNodeId('GEO-JAMNAGAR-GIDC-02');
              setZoomLevel(1.4);
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
              selectedNodeId === 'GEO-JAMNAGAR-GIDC-02'
                ? 'bg-[#172230] text-[#E5AC55] border-[#E5AC55]'
                : 'bg-[#111923] text-[#A6B4C3] border-[#263342] hover:text-[#E6EDF5]'
            }`}
          >
            Jamnagar (Brass)
          </button>
          <button
            onClick={() => {
              setSelectedNodeId('GEO-SILVASSA-DADRA-05');
              setZoomLevel(1.4);
            }}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
              selectedNodeId === 'GEO-SILVASSA-DADRA-05'
                ? 'bg-[#172230] text-[#63A9E8] border-[#63A9E8]'
                : 'bg-[#111923] text-[#A6B4C3] border-[#263342] hover:text-[#E6EDF5]'
            }`}
          >
            Silvassa (Fragrance)
          </button>
          <button
            onClick={() => setSelectedNodeId('GEO-SAAS-SYNAPSE-10')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
              selectedNodeId === 'GEO-SAAS-SYNAPSE-10'
                ? 'bg-[#3D2512] text-[#F08C42] border-[#6E3F1D]'
                : 'bg-[#111923] text-[#738397] border-[#263342] hover:text-[#F08C42]'
            }`}
          >
            SaaS API [Digital]
          </button>
        </div>
      </div>

      {/* 2. Main Geospatial Tri-Pane Layout (Layers Left, Map Center, Dossier Right) */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT PANEL: Layer Controls & Search (Palantir Map pattern, image1.png) */}
        <aside className="w-64 bg-[#0C1118] border-r border-[#263342] flex flex-col shrink-0 text-xs">
          {/* Search Bar */}
          <div className="p-2.5 border-b border-[#263342] bg-[#111923]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#738397] absolute left-2 top-2" />
              <input
                type="text"
                placeholder="Search cluster, city, or product..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#080B10] border border-[#263342] text-[#E6EDF5] placeholder-[#738397] pl-7 pr-2 py-1 rounded text-[11px] font-mono focus:outline-hidden focus:border-[#5794D6]"
              />
            </div>
          </div>

          {/* Layer Management Section */}
          <div className="p-3 border-b border-[#263342] space-y-2.5 bg-[#0C1118]">
            <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#738397] font-semibold">
              <span className="flex items-center space-x-1.5">
                <Layers className="w-3 h-3 text-[#5794D6]" />
                <span>MAP LAYERS</span>
              </span>
              <span>4 ACTIVE</span>
            </div>

            <div className="space-y-1.5 text-[11px]">
              <label className="flex items-center justify-between cursor-pointer hover:text-[#E6EDF5] text-[#A6B4C3]">
                <span className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showClusters}
                    onChange={(e) => setShowClusters(e.target.checked)}
                    className="rounded bg-[#111923] border-[#263342] text-[#5794D6] focus:ring-0"
                  />
                  <span>Industrial Clusters</span>
                </span>
                <span className="font-mono text-[10px] text-[#738397]">8 nodes</span>
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:text-[#E6EDF5] text-[#A6B4C3]">
                <span className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showLogisticsCorridors}
                    onChange={(e) => setShowLogisticsCorridors(e.target.checked)}
                    className="rounded bg-[#111923] border-[#263342] text-[#5794D6] focus:ring-0"
                  />
                  <span>Logistics Corridors (NH)</span>
                </span>
                <span className="font-mono text-[10px] text-[#738397]">4 routes</span>
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:text-[#E6EDF5] text-[#A6B4C3]">
                <span className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showCatchmentRadius}
                    onChange={(e) => setShowCatchmentRadius(e.target.checked)}
                    className="rounded bg-[#111923] border-[#263342] text-[#5794D6] focus:ring-0"
                  />
                  <span>Geometric Radius (50km)</span>
                </span>
                <span className="font-mono text-[9px] text-[#738397]">Euclidean</span>
              </label>

              <label className="flex items-center justify-between cursor-pointer hover:text-[#E6EDF5] text-[#A6B4C3]">
                <span className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={showPortsAndICDs}
                    onChange={(e) => setShowPortsAndICDs(e.target.checked)}
                    className="rounded bg-[#111923] border-[#263342] text-[#5794D6] focus:ring-0"
                  />
                  <span>Sea Ports &amp; Dry ICDs</span>
                </span>
                <span className="font-mono text-[10px] text-[#738397]">4 ports</span>
              </label>
            </div>
          </div>

          {/* Sourcing Hubs List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#263342]/40">
            <div className="p-2 bg-[#111923] text-[10px] font-mono text-[#738397] uppercase font-semibold">
              SOURCING CLUSTERS ({filteredNodes.length})
            </div>

            {filteredNodes.map((node) => {
              const isSelected = node.id === selectedNodeId;
              const isDigital = node.is_unlocated_digital;

              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`p-2.5 transition-colors cursor-pointer text-xs ${
                    isSelected
                      ? 'bg-[#172230] border-l-2 border-[#5794D6]'
                      : 'hover:bg-[#111923] border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="font-semibold text-[#E6EDF5] truncate max-w-[140px]">
                      {node.city}, {node.state}
                    </div>
                    <span
                      className={`text-[8px] font-mono px-1 py-0.2 rounded font-bold uppercase ${
                        node.epistemic_status === 'CONTRADICTED'
                          ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                          : node.geographic_precision === 'INDUSTRIAL_ESTATE_CENTROID'
                          ? 'bg-[#172E3D] text-[#4EB3D3] border border-[#234E6B]'
                          : node.geographic_precision === 'DATA_REQUIRED'
                          ? 'bg-[#3D2512] text-[#F08C42] border border-[#6E3F1D]'
                          : 'bg-[#111923] text-[#A6B4C3] border border-[#263342]'
                      }`}
                    >
                      {node.epistemic_status === 'CONTRADICTED'
                        ? 'AUDIT REFUTED'
                        : node.geographic_precision === 'INDUSTRIAL_ESTATE_CENTROID'
                        ? 'ESTATE CENTROID'
                        : node.geographic_precision === 'DATA_REQUIRED'
                        ? 'DATA REQUIRED'
                        : 'LOCALITY REF'}
                    </span>
                  </div>

                  <div className="text-[10px] text-[#A6B4C3] truncate mt-0.5">
                    {node.name}
                  </div>

                  <div className="text-[9px] font-mono text-[#738397] truncate mt-1 flex items-center justify-between">
                    <span>
                      {isDigital ? (
                        <span className="text-[#F08C42]">[UNLOCATED DIGITAL]</span>
                      ) : (
                        `${node.lat?.toFixed(4)}°N, ${node.lon?.toFixed(4)}°E`
                      )}
                    </span>
                    {node.precision_radius_meters && (
                      <span className="text-[#5794D6]">±{(node.precision_radius_meters / 1000).toFixed(1)}km</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Spatial Coverage Footer */}
          <div className="p-2 border-t border-[#263342] bg-[#080B10] text-[10px] font-mono space-y-1">
            <div className="flex justify-between text-[#738397]">
              <span>ACTIVE CLUSTERS:</span>
              <span className="text-[#35B88A] font-bold">8 VERIFIED / OBSERVED</span>
            </div>
            <div className="flex justify-between text-[#738397]">
              <span>UNLOCATED DIGITAL:</span>
              <span className="text-[#F08C42]">1 [DATA REQUIRED]</span>
            </div>
          </div>
        </aside>

        {/* CENTER PANEL: Interactive SVG Cartographic Vector Canvas */}
        <div
          className="flex-1 relative bg-[#080B10] overflow-hidden cursor-grab active:cursor-grabbing flex flex-col justify-between"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          {/* Map Floating Controls */}
          <div className="absolute top-3 left-3 z-10 flex flex-col space-y-1.5 bg-[#0C1118]/90 backdrop-blur-xs border border-[#263342] p-1 rounded">
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, z + 0.2))}
              className="p-1.5 hover:bg-[#172230] text-[#A6B4C3] hover:text-[#E6EDF5] rounded transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.7, z - 0.2))}
              className="p-1.5 hover:bg-[#172230] text-[#A6B4C3] hover:text-[#E6EDF5] rounded transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetViewport}
              className="p-1.5 hover:bg-[#172230] text-[#A6B4C3] hover:text-[#E6EDF5] rounded transition-colors"
              title="Reset Viewport Bounds"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Map Top Status Pill */}
          <div className="absolute top-3 right-3 z-10 bg-[#0C1118]/90 backdrop-blur-xs border border-[#263342] px-3 py-1 rounded text-[10px] font-mono flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-[#35B88A] animate-pulse" />
            <span className="text-[#E6EDF5]">EPSG:4326 WGS-84 VECTOR PROJECTION</span>
            <span className="text-[#738397]">•</span>
            <span className="text-[#A6B4C3]">SCALE 1:{Math.round(2500000 / zoomLevel).toLocaleString()}</span>
          </div>

          {/* SVG Vector Canvas */}
          <div className="w-full h-full flex items-center justify-center overflow-hidden">
            <svg
              viewBox="0 0 800 600"
              className="w-full h-full select-none"
              style={{
                transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 180ms ease-out',
              }}
            >
              {/* Grid / Lat-Lon Reticle lines */}
              <defs>
                <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#111923" strokeWidth="0.5" />
                </pattern>
                {/* Glow Filter */}
                <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
                <filter id="glow-emerald" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feComposite in="SourceGraphic" in2="blur" operator="over" />
                </filter>
              </defs>

              <rect width="800" height="600" fill="#080B10" />
              <rect width="800" height="600" fill="url(#grid)" />

              {/* Indian Subcontinent Stylized Vector Coastline & Perimeter */}
              <path
                d="M 230,80 L 290,65 L 340,75 L 390,95 L 430,120 L 490,140 L 530,165 L 560,185 L 600,210 L 640,240 L 650,270 L 630,290 L 590,295 L 560,330 L 520,380 L 480,450 L 440,510 L 420,550 L 390,520 L 370,450 L 330,370 L 280,330 L 220,330 L 170,300 L 160,250 L 180,210 L 200,160 Z"
                fill="#0C1118"
                stroke="#263342"
                strokeWidth="1.2"
                strokeDasharray="4 2"
              />

              {/* Logistics Highways & Dedicated Freight Corridors */}
              {showLogisticsCorridors &&
                LOGISTICS_ROUTES.map((route) => {
                  const fromNode = GEO_CLUSTER_NODES.find((n) => n.id === route.from_hub_id);
                  const toNode = GEO_CLUSTER_NODES.find((n) => n.id === route.to_hub_id);
                  if (!fromNode || !toNode || fromNode.lat === null || toNode.lat === null) return null;

                  const p1 = projectCoordinates(fromNode.lat, fromNode.lon!);
                  const p2 = projectCoordinates(toNode.lat, toNode.lon!);

                  // Curve midpoint
                  const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.15;
                  const my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.15;

                  return (
                    <g key={route.id} className="transition-opacity">
                      <path
                        d={`M ${p1.x},${p1.y} Q ${mx},${my} ${p2.x},${p2.y}`}
                        fill="none"
                        stroke="#2D664E"
                        strokeWidth="1.8"
                        strokeDasharray="3 3"
                        opacity="0.8"
                      />
                      <circle cx={mx} cy={my} r="2.5" fill="#35B88A" />
                    </g>
                  );
                })}

              {/* Sourcing Nodes & Catchment Halos */}
              {showClusters &&
                filteredNodes.map((node) => {
                  if (node.lat === null || node.lon === null) return null;
                  const { x, y } = projectCoordinates(node.lat, node.lon);
                  const isSelected = node.id === selectedNodeId;

                  // Node color mapping
                  let nodeColor = '#63A9E8'; // blue default
                  if (node.epistemic_status === 'VERIFIED') nodeColor = '#35B88A';
                  if (node.epistemic_status === 'FIXTURE') nodeColor = '#968AE2';
                  if (node.epistemic_status === 'HISTORICAL') nodeColor = '#B07CE8';
                  if (node.epistemic_status === 'CONTRADICTED') nodeColor = '#FF6B6B';

                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer group"
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      {/* Catchment Radius Circle */}
                      {showCatchmentRadius && isSelected && (
                        <circle
                          cx={x}
                          cy={y}
                          r="45"
                          fill={nodeColor}
                          fillOpacity="0.12"
                          stroke={nodeColor}
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                      )}

                      {/* Radar Ping Halo */}
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelected ? '14' : '9'}
                        fill={nodeColor}
                        fillOpacity={isSelected ? '0.25' : '0.15'}
                        stroke={nodeColor}
                        strokeWidth={isSelected ? '1.5' : '0.8'}
                      />

                      {/* Center Point */}
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelected ? '5' : '3.5'}
                        fill={nodeColor}
                        stroke="#080B10"
                        strokeWidth="1"
                      />

                      {/* Label */}
                      <text
                        x={x + 10}
                        y={y + 3}
                        fill={isSelected ? '#E6EDF5' : '#A6B4C3'}
                        fontSize="9"
                        fontFamily="IBM Plex Mono"
                        fontWeight={isSelected ? '600' : '400'}
                        className="pointer-events-none select-none drop-shadow-md"
                      >
                        {node.city} ({node.name.split(' ')[0]})
                      </text>
                    </g>
                  );
                })}
            </svg>
          </div>

          {/* 3. Bottom Temporal Scrubber (Bitemporal Slider 2020 - 2026, image1.png) */}
          <div className="h-12 bg-[#0C1118] border-t border-[#263342] px-4 flex items-center justify-between text-xs font-mono z-10">
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setIsTimelinePlaying(!isTimelinePlaying)}
                className={`p-1.5 rounded border cursor-pointer transition-colors ${
                  isTimelinePlaying
                    ? 'bg-[#1B3D2F] text-[#35B88A] border-[#2D664E]'
                    : 'bg-[#111923] text-[#A6B4C3] border-[#263342] hover:text-[#E6EDF5]'
                }`}
                title={isTimelinePlaying ? 'Pause replay' : 'Replay observation timeline'}
              >
                {isTimelinePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>

              <div className="flex items-center space-x-1.5 text-[11px]">
                <Clock className="w-3.5 h-3.5 text-[#5794D6]" />
                <span className="text-[#738397]">OBSERVATION TIMELINE:</span>
                <span className="text-[#E6EDF5] font-bold">{timelineYear} STATE</span>
              </div>
            </div>

            {/* Scrubber slider */}
            <div className="flex-1 max-w-xl mx-6 flex items-center space-x-3">
              <span className="text-[10px] text-[#738397]">2020</span>
              <input
                type="range"
                min="2020"
                max="2026"
                step="1"
                value={timelineYear}
                onChange={(e) => setTimelineYear(parseInt(e.target.value, 10))}
                className="w-full accent-[#5794D6] h-1 bg-[#172230] rounded-lg cursor-pointer"
              />
              <span className="text-[10px] text-[#35B88A] font-bold">2026 (LIVE)</span>
            </div>

            <div className="text-[10px] text-[#738397] hidden xl:flex items-center space-x-2">
              <span>TEMPORAL MODE:</span>
              <span className="text-[#E5AC55] font-semibold">HISTORICAL SNAPSHOT DEMONSTRATION</span>
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Contextual Entity Dossier Inspector (Palantir Inspector pattern, image1.png) */}
        <aside className="w-84 bg-[#0C1118] border-l border-[#263342] flex flex-col justify-between shrink-0 overflow-y-auto text-xs">
          {/* Dossier Header */}
          <div className="p-3 border-b border-[#263342] bg-[#111923] space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-[10px] font-mono text-[#738397] uppercase">
                <Building2 className="w-3 h-3 text-[#5794D6]" />
                <span>ENTITY DOSSIER</span>
              </div>
              <span
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-bold uppercase ${
                  selectedNode.epistemic_status === 'CONTRADICTED'
                    ? 'bg-[#3D1B1B] text-[#FF6B6B] border border-[#802026]'
                    : selectedNode.geographic_precision === 'INDUSTRIAL_ESTATE_CENTROID'
                    ? 'bg-[#172E3D] text-[#4EB3D3] border border-[#234E6B]'
                    : selectedNode.geographic_precision === 'DATA_REQUIRED'
                    ? 'bg-[#3D2512] text-[#F08C42] border border-[#6E3F1D]'
                    : 'bg-[#111923] text-[#A6B4C3] border border-[#263342]'
                }`}
              >
                {selectedNode.epistemic_status === 'CONTRADICTED' ? 'AUDIT REFUTED' : selectedNode.geographic_precision}
              </span>
            </div>

            <div className="font-bold text-[#E6EDF5] text-sm leading-tight">
              {selectedNode.entity_name}
            </div>

            <div className="text-[10px] text-[#738397] font-mono">
              Hub: {selectedNode.hub_name}
            </div>
          </div>

          {/* Dossier Body Content */}
          <div className="p-3 space-y-3.5 flex-1 overflow-y-auto">
            {/* Digital Unlocated Notice if Applicable */}
            {selectedNode.is_unlocated_digital && (
              <div className="p-2.5 rounded bg-[#3D2512]/60 border border-[#6E3F1D] text-[11px] font-mono space-y-1">
                <div className="text-[#F08C42] font-semibold flex items-center space-x-1.5">
                  <Info className="w-3.5 h-3.5 shrink-0" />
                  <span>DIGITAL / CLOUD-NATIVE ASSET</span>
                </div>
                <div className="text-[#A6B4C3] text-[10px] leading-relaxed">
                  Geographic coordinates are omitted deliberately: SaaS API distribution relies on global multi-region Anycast/Cloudflare nodes with zero physical foundry gate.
                </div>
              </div>
            )}

            {/* Conviction Decoupling & Underwriting State (UIADR01-A Section 6) */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-[#738397] font-semibold flex justify-between">
                <span>CONVICTION &amp; UNDERWRITING</span>
                <span className={selectedNode.thesis_underwriting_state === 'QUARANTINED_PENDING_AUDIT' ? 'text-[#FF6B6B] font-bold' : 'text-[#35B88A]'}>
                  {selectedNode.thesis_underwriting_state}
                </span>
              </div>
              <div className="bg-[#111923] border border-[#263342] rounded p-2 text-[10px] font-mono space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[#738397]">Macro Opportunity Conviction:</span>
                  <span className="text-[#35B88A] font-bold">{selectedNode.opportunity_conviction_bps.toLocaleString()} BPS</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#738397]">Supplier Claim Confidence:</span>
                  <span className={`font-bold ${selectedNode.supplier_confidence_bps === 0 ? 'text-[#FF6B6B]' : 'text-[#E5AC55]'}`}>
                    {selectedNode.supplier_confidence_bps === 0 ? '0 BPS (REFUTED)' : `${selectedNode.supplier_confidence_bps.toLocaleString()} BPS`}
                  </span>
                </div>
                {selectedNode.thesis_underwriting_state === 'QUARANTINED_PENDING_AUDIT' && (
                  <div className="text-[9px] text-[#FF6B6B] bg-[#3D1B1B]/40 p-1.5 rounded border border-[#802026] leading-tight">
                    CAPITAL ALLOCATION BLOCKED: Sourcing batch failed spectrometry audit (SS201 alloy detected).
                  </div>
                )}
              </div>
            </div>

            {/* Conflict & Laboratory Notes if Applicable */}
            {selectedNode.conflict_notes && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-[#FF6B6B] font-semibold flex items-center space-x-1">
                  <AlertTriangle className="w-3 h-3 text-[#FF6B6B]" />
                  <span>CONTRADICTION &amp; AUDIT NOTES</span>
                </div>
                <div className="bg-[#3D1B1B]/40 border border-[#802026] rounded p-2 text-[10px] font-mono text-[#FF6B6B] leading-relaxed">
                  {selectedNode.conflict_notes}
                </div>
              </div>
            )}

            {/* Statutory & Statutory Verification Table */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-[#738397] font-semibold flex justify-between">
                <span>STATUTORY &amp; PROVENANCE</span>
                <span className="text-[#E5AC55] text-[9px]">{selectedNode.statutory_identifier_status}</span>
              </div>
              <div className="bg-[#111923] border border-[#263342] rounded p-2 text-[10px] font-mono space-y-1">
                {selectedNode.cin && (
                  <div className="flex justify-between">
                    <span className="text-[#738397]">CIN / REG:</span>
                    <span className="text-[#E6EDF5]">{selectedNode.cin}</span>
                  </div>
                )}
                {selectedNode.gstin && (
                  <div className="flex justify-between">
                    <span className="text-[#738397]">GSTIN:</span>
                    <span className="text-[#E6EDF5]">{selectedNode.gstin}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-[#738397]">STATUS:</span>
                  <span className="text-[#E5AC55]">{selectedNode.statutory_status}</span>
                </div>
                {selectedNode.registered_office_address && (
                  <div className="pt-1 border-t border-[#263342]/60">
                    <span className="text-[#738397]">Registered Domicile:</span>
                    <div className="text-[#A6B4C3] text-[9px]">{selectedNode.registered_office_address}</div>
                  </div>
                )}
                {selectedNode.physical_facility_address && (
                  <div className="pt-1 border-t border-[#263342]/60">
                    <span className="text-[#738397]">Facility Gate / Address:</span>
                    <div className="text-[#A6B4C3] text-[9px]">{selectedNode.physical_facility_address}</div>
                  </div>
                )}
                <div className="pt-1 border-t border-[#263342]/60">
                  <span className="text-[#738397]">Geographic Source &amp; Precision:</span>
                  <div className="text-[#5794D6] text-[9px]">{selectedNode.coordinate_source_description}</div>
                </div>
              </div>
            </div>

            {/* Commercial Opportunity & Financials */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-[#738397] font-semibold">
                PRODUCT &amp; COMMERCIAL THESIS
              </div>
              <div className="bg-[#111923] border border-[#263342] rounded p-2 text-[10px] font-mono space-y-1.5">
                <div className="text-[#E6EDF5] font-medium text-[11px]">
                  {selectedNode.product_name}
                </div>
                <div className="grid grid-cols-2 gap-1 pt-1 border-t border-[#263342]/60">
                  <div>
                    <span className="text-[#738397]">Factory Quote:</span>
                    <div className="text-[#E6EDF5] font-bold">
                      {selectedNode.factory_quote_inr ? `₹${selectedNode.factory_quote_inr.toFixed(2)}` : '[DATA REQUIRED]'}
                    </div>
                  </div>
                  <div>
                    <span className="text-[#738397]">Retail ASP:</span>
                    <div className="text-[#35B88A] font-bold">
                      {selectedNode.retail_asp_inr ? `₹${selectedNode.retail_asp_inr.toFixed(2)}` : '[DATA REQUIRED]'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Logistics & Corridor Metadata */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-[#738397] font-semibold flex justify-between">
                <span>LOGISTICS CORRIDOR &amp; PORTS</span>
                <span className="text-[#738397] text-[9px]">{selectedNode.logistics_corridor_type}</span>
              </div>
              <div className="bg-[#111923] border border-[#263342] rounded p-2 text-[10px] font-mono space-y-1">
                <div>
                  <span className="text-[#738397]">Corridor: </span>
                  <span className="text-[#A6B4C3]">{selectedNode.logistics_corridor}</span>
                </div>
                <div>
                  <span className="text-[#738397]">Port Terminal: </span>
                  <span className="text-[#5794D6]">{selectedNode.primary_port}</span>
                </div>
              </div>
            </div>

            {/* Observation Timeline Ticks */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-mono uppercase text-[#738397] font-semibold">
                OBSERVATION TIMELINE TICKS ({selectedNode.bitemporal_ticks.length})
              </div>
              <div className="space-y-1">
                {selectedNode.bitemporal_ticks.map((tick, idx) => (
                  <div
                    key={idx}
                    className="p-1.5 rounded bg-[#080B10] border border-[#263342] text-[9px] font-mono space-y-0.5"
                  >
                    <div className="flex justify-between text-[#738397]">
                      <span className="text-[#5794D6] font-semibold">{tick.year}</span>
                      <span className="text-[#E5AC55]">{tick.epistemic_class || tick.observation_type}</span>
                    </div>
                    <div className="text-[#E6EDF5] truncate">{tick.prevailing_metric}</div>
                    <div className="text-[#738397] text-[8px] truncate">Src: {tick.evidence_source}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Cross-Navigation Actions Footer */}
          <div className="p-3 border-t border-[#263342] bg-[#111923] space-y-2 shrink-0">
            <button
              onClick={() => onNavigate('DISCOVERY_GALLERY', selectedNode.candidate_id)}
              className="w-full py-1.5 px-2 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center space-x-1.5">
                <Search className="w-3 h-3 text-[#5794D6]" />
                <span>Inspect in Discovery Universe</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[#738397]" />
            </button>

            <button
              onClick={() => onNavigate('THESIS_GALLERY', selectedNode.thesis_id)}
              className="w-full py-1.5 px-2 rounded bg-[#172230] hover:bg-[#1C2938] border border-[#263342] hover:border-[#5794D6] text-[#E6EDF5] text-xs font-mono flex items-center justify-between transition-colors cursor-pointer"
            >
              <span className="flex items-center space-x-1.5">
                <FileText className="w-3 h-3 text-[#35B88A]" />
                <span>View Commercial Thesis</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-[#738397]" />
            </button>

            <button
              onClick={() => {
                if (onLaunchInvestigation) {
                  onLaunchInvestigation(selectedNode.candidate_id);
                } else {
                  onNavigate('INVESTIGATION_DESK', selectedNode.candidate_id);
                }
              }}
              className="w-full py-2 px-2 rounded bg-[#1B3D2F] hover:bg-[#2D664E] text-[#35B88A] text-xs font-mono font-bold flex items-center justify-center space-x-2 transition-colors cursor-pointer border border-[#2D664E]"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Launch Bounded Investigation (D.0)</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
};
