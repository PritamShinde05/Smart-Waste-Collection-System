export interface RoutePoint {
  sensorId?: number;
  binId?: string;
  label: string;
  latitude: number;
  longitude: number;
  fillPercent?: number | null;
}

export interface OptimizedRouteResult {
  orderedStops: Array<RoutePoint & { stopOrder: number }>;
  routeGeometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  totalDistanceMeters: number;
  estimatedTimeSeconds: number;
}

const OSRM_BASE = 'https://router.project-osrm.org';

async function fetchJsonWithTimeout(url: string, timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Routing service responded with status ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function tourDuration(order: number[], matrix: number[][]): number {
  let total = 0;
  let prev = 0; // start point is index 0
  for (const idx of order) {
    total += matrix[prev]?.[idx] ?? 0;
    prev = idx;
  }
  return total;
}

function solveNearestNeighborAndTwoOpt(numStops: number, durations: number[][]): number[] {
  const unvisited = new Set<number>();
  for (let i = 1; i <= numStops; i++) unvisited.add(i);

  const order: number[] = [];
  let current = 0;
  while (unvisited.size > 0) {
    let bestNext = -1;
    let bestCost = Infinity;
    for (const candidate of unvisited) {
      const cost = durations[current]?.[candidate] ?? Infinity;
      if (cost < bestCost) {
        bestCost = cost;
        bestNext = candidate;
      }
    }
    if (bestNext === -1) break;
    order.push(bestNext);
    unvisited.delete(bestNext);
    current = bestNext;
  }

  // 2-opt improvement (open path starting from 0)
  if (order.length >= 3) {
    let improved = true;
    let iterations = 0;
    while (improved && iterations < 200) {
      improved = false;
      iterations++;
      let bestCost = tourDuration(order, durations);
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidateOrder = [
            ...order.slice(0, i),
            ...order.slice(i, j + 1).reverse(),
            ...order.slice(j + 1),
          ];
          const candidateCost = tourDuration(candidateOrder, durations);
          if (candidateCost + 0.01 < bestCost) {
            order.splice(0, order.length, ...candidateOrder);
            bestCost = candidateCost;
            improved = true;
          }
        }
      }
    }
  }

  return order;
}

export async function optimizeRoadRoute(
  startPoint: RoutePoint,
  bins: RoutePoint[]
): Promise<OptimizedRouteResult> {
  if (bins.length === 0) {
    throw new Error('At least one bin must be selected to generate a route');
  }

  const allPoints = [startPoint, ...bins];

  let orderedIndices: number[];
  if (bins.length === 1) {
    orderedIndices = [1];
  } else {
    const coordsStr = allPoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const tableUrl = `${OSRM_BASE}/table/v1/driving/${coordsStr}?annotations=duration,distance`;
    const tableData = await fetchJsonWithTimeout(tableUrl);
    if (tableData.code !== 'Ok' || !Array.isArray(tableData.durations)) {
      throw new Error('Road routing matrix unavailable. Please retry.');
    }
    orderedIndices = solveNearestNeighborAndTwoOpt(bins.length, tableData.durations);
  }

  const orderedBins = orderedIndices.map((idx, pos) => ({
    ...allPoints[idx],
    stopOrder: pos + 1,
  }));

  const routePoints = [startPoint, ...orderedBins];
  const routeCoordsStr = routePoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const routeUrl = `${OSRM_BASE}/route/v1/driving/${routeCoordsStr}?overview=full&geometries=geojson&steps=false`;
  const routeData = await fetchJsonWithTimeout(routeUrl);

  if (routeData.code !== 'Ok' || !Array.isArray(routeData.routes) || routeData.routes.length === 0) {
    throw new Error('Could not compute a valid road-following route. Please verify pin locations and retry.');
  }

  const bestRoute = routeData.routes[0];
  if (!bestRoute.geometry || !Array.isArray(bestRoute.geometry.coordinates)) {
    throw new Error('Road routing geometry missing from provider response.');
  }

  return {
    orderedStops: orderedBins,
    routeGeometry: {
      type: 'LineString',
      coordinates: bestRoute.geometry.coordinates,
    },
    totalDistanceMeters: Math.round(bestRoute.distance || 0),
    estimatedTimeSeconds: Math.round(bestRoute.duration || 0),
  };
}
