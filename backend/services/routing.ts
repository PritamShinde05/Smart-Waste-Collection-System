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
  returnToDepot: boolean;
}

export const MAX_ROUTE_WAYPOINTS = 50;

function getOsrmBaseUrl(): string {
  return process.env.OSRM_BASE_URL?.trim().replace(/\/$/, '') || 'https://router.project-osrm.org';
}

async function fetchJsonWithRetry(url: string, timeoutMs = 12000, maxRetries = 2): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
        continue;
      }
      if (!res.ok) {
        throw new Error(`Routing service responded with status ${res.status}`);
      }
      return await res.json();
    } catch (err: any) {
      lastError = err;
      const isAbortOrNetwork =
        err?.name === 'AbortError' || err?.code === 'ECONNRESET' || err instanceof TypeError;
      if (attempt < maxRetries && isAbortOrNetwork) {
        await new Promise((r) => setTimeout(r, 350 * Math.pow(2, attempt)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Routing service request failed');
}

export function tourDuration(order: number[], matrix: number[][], returnToDepot = false): number {
  let total = 0;
  let prev = 0; // start point is index 0
  for (const idx of order) {
    total += matrix[prev]?.[idx] ?? 0;
    prev = idx;
  }
  if (returnToDepot && order.length > 0) {
    total += matrix[prev]?.[0] ?? 0;
  }
  return total;
}

function buildNearestNeighborOrder(numStops: number, firstStop: number, durations: number[][]): number[] {
  const unvisited = new Set<number>();
  for (let i = 1; i <= numStops; i++) unvisited.add(i);

  const order: number[] = [firstStop];
  unvisited.delete(firstStop);
  let current = firstStop;

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

  return order;
}

function improveWithTwoOptAndOrOpt(order: number[], durations: number[][], returnToDepot: boolean): number[] {
  const best = [...order];
  if (best.length < 2) return best;

  let bestCost = tourDuration(best, durations, returnToDepot);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < 250) {
    improved = false;
    iterations++;

    // 2-opt segment reversal
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const candidate = [
          ...best.slice(0, i),
          ...best.slice(i, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const candidateCost = tourDuration(candidate, durations, returnToDepot);
        if (candidateCost + 0.01 < bestCost) {
          best.splice(0, best.length, ...candidate);
          bestCost = candidateCost;
          improved = true;
        }
      }
    }

    // Or-opt: single-stop relocation
    for (let i = 0; i < best.length; i++) {
      const node = best[i];
      const without = [...best.slice(0, i), ...best.slice(i + 1)];
      for (let pos = 0; pos <= without.length; pos++) {
        if (pos === i) continue;
        const candidate = [...without.slice(0, pos), node, ...without.slice(pos)];
        const candidateCost = tourDuration(candidate, durations, returnToDepot);
        if (candidateCost + 0.01 < bestCost) {
          best.splice(0, best.length, ...candidate);
          bestCost = candidateCost;
          improved = true;
          break;
        }
      }
    }
  }

  return best;
}

/**
 * Multi-start Nearest Neighbor + 2-opt + Or-opt tour optimization.
 * Exported for unit tests.
 */
export function solveRouteOrder(
  numStops: number,
  durations: number[][],
  returnToDepot: boolean = false
): number[] {
  if (numStops <= 0) return [];
  if (numStops === 1) return [1];

  // Try starting from closest stops first (up to min(numStops, 8) multi-start seeds)
  const candidatesByStart = Array.from({ length: numStops }, (_, i) => i + 1).sort(
    (a, b) => (durations[0]?.[a] ?? Infinity) - (durations[0]?.[b] ?? Infinity)
  );
  const seedLimit = Math.min(numStops, 8);

  let globalBestOrder: number[] = [];
  let globalBestCost = Infinity;

  for (let s = 0; s < seedLimit; s++) {
    const initial = buildNearestNeighborOrder(numStops, candidatesByStart[s], durations);
    const refined = improveWithTwoOptAndOrOpt(initial, durations, returnToDepot);
    const cost = tourDuration(refined, durations, returnToDepot);
    if (cost < globalBestCost) {
      globalBestCost = cost;
      globalBestOrder = refined;
    }
  }

  return globalBestOrder;
}

export async function optimizeRoadRoute(
  startPoint: RoutePoint,
  bins: RoutePoint[],
  options: { returnToDepot?: boolean } = {}
): Promise<OptimizedRouteResult> {
  const returnToDepot = Boolean(options.returnToDepot);

  if (bins.length === 0) {
    throw new Error('At least one bin must be selected to generate a route');
  }
  const totalWaypoints = 1 + bins.length + (returnToDepot ? 1 : 0);
  if (totalWaypoints > MAX_ROUTE_WAYPOINTS) {
    throw new Error(`Maximum ${MAX_ROUTE_WAYPOINTS} waypoints allowed per optimized route (including start/return depot).`);
  }

  const osrmBase = getOsrmBaseUrl();
  const allPoints = [startPoint, ...bins];

  let orderedIndices: number[];
  if (bins.length === 1) {
    orderedIndices = [1];
  } else {
    const coordsStr = allPoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const tableUrl = `${osrmBase}/table/v1/driving/${coordsStr}?annotations=duration,distance`;
    const tableData = await fetchJsonWithRetry(tableUrl);
    if (tableData.code !== 'Ok' || !Array.isArray(tableData.durations)) {
      throw new Error('Road routing matrix unavailable. Please retry.');
    }
    orderedIndices = solveRouteOrder(bins.length, tableData.durations, returnToDepot);
  }

  const orderedBins = orderedIndices.map((idx, pos) => ({
    ...allPoints[idx],
    stopOrder: pos + 1,
  }));

  const routePoints = returnToDepot ? [startPoint, ...orderedBins, startPoint] : [startPoint, ...orderedBins];
  const routeCoordsStr = routePoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const routeUrl = `${osrmBase}/route/v1/driving/${routeCoordsStr}?overview=full&geometries=geojson&steps=false`;
  const routeData = await fetchJsonWithRetry(routeUrl);

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
    returnToDepot,
  };
}
