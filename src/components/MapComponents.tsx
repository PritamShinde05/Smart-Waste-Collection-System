import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { RouteGeometry, Sensor, SensorStatus } from '../types';

const STATUS_COLORS: Record<SensorStatus, { bg: string; border: string }> = {
  NORMAL: { bg: '#16A34A', border: '#14532D' },
  MEDIUM: { bg: '#D97706', border: '#78350F' },
  FULL: { bg: '#DC2626', border: '#7F1D1D' },
  OFFLINE: { bg: '#64748B', border: '#334155' },
};

function buildBinIcon(sensor: Sensor, selected = false): L.DivIcon {
  const colors = STATUS_COLORS[sensor.status] || STATUS_COLORS.OFFLINE;
  const pct = sensor.status === 'OFFLINE' || sensor.lastFillPercent === null ? 'OFF' : `${Math.round(sensor.lastFillPercent)}%`;
  const ring = selected ? 'box-shadow: 0 0 0 3px #0F172A, 0 4px 10px rgba(0,0,0,0.3);' : 'box-shadow: 0 2px 6px rgba(0,0,0,0.28);';

  return L.divIcon({
    className: 'vr-bin-marker',
    iconSize: [52, 30],
    iconAnchor: [26, 15],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:52px;height:28px;border-radius:8px;background:${colors.bg};border:2px solid #fff;color:#fff;font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:700;${ring}">${pct}</div>`,
  });
}

function buildNumberedStopIcon(stopOrder: number, collected: boolean, highlighted: boolean): L.DivIcon {
  const bg = collected ? '#64748B' : highlighted ? '#059669' : '#0F172A';
  const size = highlighted ? 34 : 28;
  const ring = highlighted ? 'box-shadow: 0 0 0 4px rgba(5,150,105,0.28), 0 3px 8px rgba(0,0,0,0.3);' : 'box-shadow: 0 2px 6px rgba(0,0,0,0.25);';
  return L.divIcon({
    className: 'vr-bin-marker',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;border-radius:9999px;background:${bg};border:2px solid #fff;color:#fff;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;${ring}">${stopOrder}</div>`,
  });
}

function buildDepotIcon(): L.DivIcon {
  return L.divIcon({
    className: 'vr-bin-marker',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;background:#0F172A;border:2px solid #fff;color:#fff;font-family:'Plus Jakarta Sans',sans-serif;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(0,0,0,0.3);">D</div>`,
  });
}

function buildEmployeeIcon(): L.DivIcon {
  return L.divIcon({
    className: 'vr-bin-marker',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    html: `<div style="width:20px;height:20px;border-radius:9999px;background:#0284C7;border:3px solid #fff;box-shadow:0 0 0 4px rgba(2,132,199,0.25);"></div>`,
  });
}

// ==================== 1. LOCATION PICKER MAP (C2, A4, A5, A11) ====================
export const LocationPickerMap: React.FC<{
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
  heightClass?: string;
}> = ({ lat, lng, onChange, heightClass = 'h-64' }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([lat, lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const pinIcon = L.divIcon({
      className: 'vr-bin-marker',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      html: `<div style="width:28px;height:28px;border-radius:9999px;background:#059669;border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.32);"></div>`,
    });

    const marker = L.marker([lat, lng], { draggable: true, icon: pinIcon }).addTo(map);
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onChangeRef.current(Number(pos.lat.toFixed(6)), Number(pos.lng.toFixed(6)));
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      onChangeRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (markerRef.current && mapRef.current) {
      const curr = markerRef.current.getLatLng();
      if (Math.abs(curr.lat - lat) > 0.00001 || Math.abs(curr.lng - lng) > 0.00001) {
        markerRef.current.setLatLng([lat, lng]);
        mapRef.current.panTo([lat, lng]);
      }
    }
  }, [lat, lng]);

  return <div ref={containerRef} className={`w-full rounded-xl border border-slate-200 overflow-hidden ${heightClass}`} />;
};

// ==================== 2. LIVE BINS MAP WITH CLUSTERING & IN-PLACE UPDATES (A2) ====================
export const LiveBinsMap: React.FC<{
  sensors: Sensor[];
  centerLat: number;
  centerLng: number;
  selectedSensorId: number | null;
  focusSensorId?: number | null;
  userLocation?: [number, number] | null;
  onSelectSensor: (sensor: Sensor) => void;
  heightClass?: string;
}> = ({
  sensors,
  centerLat,
  centerLng,
  selectedSensorId,
  focusSensorId,
  userLocation,
  onSelectSensor,
  heightClass = 'h-[calc(100vh-13rem)] md:h-[calc(100vh-9rem)]',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const userMarkerRef = useRef<L.Marker | null>(null);
  const lastFocusedRef = useRef<number | null>(null);
  const onSelectRef = useRef(onSelectSensor);
  onSelectRef.current = onSelectSensor;
  const sensorsRef = useRef<Map<number, Sensor>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([centerLat, centerLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 48,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Update markers in-place without destroying the map
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

    const incomingIds = new Set<number>();
    sensorsRef.current.clear();
    for (const s of sensors) {
      incomingIds.add(s.id);
      sensorsRef.current.set(s.id, s);
      const existing = markersRef.current.get(s.id);
      const icon = buildBinIcon(s, s.id === selectedSensorId);
      if (existing) {
        const cur = existing.getLatLng();
        if (Math.abs(cur.lat - s.latitude) > 0.00001 || Math.abs(cur.lng - s.longitude) > 0.00001) {
          existing.setLatLng([s.latitude, s.longitude]);
        }
        existing.setIcon(icon);
      } else {
        const m = L.marker([s.latitude, s.longitude], { icon });
        m.on('click', () => {
          const latest = sensorsRef.current.get(s.id);
          if (latest) onSelectRef.current(latest);
        });
        markersRef.current.set(s.id, m);
        cluster.addLayer(m);
      }
    }

    // Remove deleted or filtered-out markers
    for (const [id, marker] of markersRef.current.entries()) {
      if (!incomingIds.has(id)) {
        cluster.removeLayer(marker);
        markersRef.current.delete(id);
      }
    }
  }, [sensors, selectedSensorId]);

  useEffect(() => {
    if (!mapRef.current || !focusSensorId) {
      lastFocusedRef.current = null;
      return;
    }
    if (lastFocusedRef.current === focusSensorId) return;
    const target = sensors.find((s) => s.id === focusSensorId);
    if (target) {
      lastFocusedRef.current = focusSensorId;
      mapRef.current.setView([target.latitude, target.longitude], 16, { animate: true });
    }
  }, [focusSensorId, sensors]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (userLocation) {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(userLocation);
      } else {
        userMarkerRef.current = L.marker(userLocation, { icon: buildEmployeeIcon() }).addTo(mapRef.current);
      }
      mapRef.current.setView(userLocation, 15, { animate: true });
    }
  }, [userLocation]);

  return <div ref={containerRef} className={`w-full rounded-2xl border border-slate-200 overflow-hidden ${heightClass}`} />;
};

// ==================== 3. ROUTE MAP (A7, A8, E2, E3) ====================
export interface RouteMapStop {
  sensorId: number;
  stopOrder: number;
  binId: string;
  label: string;
  latitude: number;
  longitude: number;
  collected?: boolean;
  isNext?: boolean;
}

export const RouteMap: React.FC<{
  startLat: number;
  startLng: number;
  startLabel?: string;
  stops: RouteMapStop[];
  routeGeometry: RouteGeometry | null;
  employeeLocation?: [number, number] | null;
  heightClass?: string;
  onStopClick?: (stop: RouteMapStop) => void;
}> = ({
  startLat,
  startLng,
  startLabel = 'Start Point',
  stops,
  routeGeometry,
  employeeLocation,
  heightClass = 'h-72',
  onStopClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const empMarkerRef = useRef<L.Marker | null>(null);
  const lastRouteKeyRef = useRef<string>('');
  const onStopClickRef = useRef(onStopClick);
  onStopClickRef.current = onStopClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView([startLat, startLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
      empMarkerRef.current = null;
      lastRouteKeyRef.current = '';
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();
    const boundsPoints: L.LatLngExpression[] = [[startLat, startLng]];

    // Draw saved OSRM road polyline
    if (routeGeometry && Array.isArray(routeGeometry.coordinates) && routeGeometry.coordinates.length > 0) {
      const latLngs: L.LatLngExpression[] = routeGeometry.coordinates.map(([lng, lat]) => [lat, lng]);
      L.polyline(latLngs, {
        color: '#059669',
        weight: 5,
        opacity: 0.88,
      }).addTo(group);
      for (const ll of latLngs) boundsPoints.push(ll);
    }

    // Start marker
    const startMarker = L.marker([startLat, startLng], { icon: buildDepotIcon() }).addTo(group);
    startMarker.bindTooltip(startLabel, { direction: 'top' });

    // Ordered stop markers
    for (const s of stops) {
      boundsPoints.push([s.latitude, s.longitude]);
      const m = L.marker([s.latitude, s.longitude], {
        icon: buildNumberedStopIcon(s.stopOrder, Boolean(s.collected), Boolean(s.isNext)),
      }).addTo(group);
      m.bindTooltip(`#${s.stopOrder} ${s.binId} · ${s.label}`, { direction: 'top' });
      m.on('click', () => {
        if (onStopClickRef.current) onStopClickRef.current(s);
      });
    }

    const routeKey = `${startLat.toFixed(5)},${startLng.toFixed(5)}|${stops.map((s) => `${s.sensorId}:${s.stopOrder}`).join(',')}|${routeGeometry?.coordinates?.length ?? 0}`;
    if (lastRouteKeyRef.current !== routeKey && boundsPoints.length > 1) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [36, 36] });
      lastRouteKeyRef.current = routeKey;
    }
  }, [startLat, startLng, startLabel, stops, routeGeometry]);

  // Update live employee GPS marker without resetting zoom
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (employeeLocation) {
      if (empMarkerRef.current) {
        empMarkerRef.current.setLatLng(employeeLocation);
      } else {
        empMarkerRef.current = L.marker(employeeLocation, { icon: buildEmployeeIcon() })
          .bindTooltip('Your GPS location', { direction: 'top' })
          .addTo(map);
      }
    }
  }, [employeeLocation]);

  return <div ref={containerRef} className={`w-full rounded-xl border border-slate-200 overflow-hidden ${heightClass}`} />;
};
