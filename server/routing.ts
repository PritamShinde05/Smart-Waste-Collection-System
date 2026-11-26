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

export class RoutingError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.statusCode = statusCode;
  }
}

const UNREACHABLE_PENALTY = 1e9;
const MAX_WAYPOINTS = Math.max(2, Math.min(95, Number(process.env.OSRM_MAX_WAYPOINTS || 50)));
const TIMEOUT_MS = Math.max(3000, Number(process.env.OSRM_TIMEOUT_SECONDS || 12) * 1000);

function getOsrmBase(): string {
  return (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/+$/, '');
}

async function fetchJsonWithTimeout(url: string, timeoutMs = TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new RoutingError(`Routing service responded with status ${res.status}`, 503);
    }
    return await res.json();
  } catch (err: any) {
    if (err instanceof RoutingError) throw err;
    throw new RoutingError('Road routing service temporarily unavailable. Please retry.', 503);
  } finally {
    clearTimeout(timer);
  }
}

export function tourDuration(order: number[], matrix: number[][], returnToDepot = false): number {
  let total = 0;
  let prev = 0; // start point is index 0
  for (const idx of order) {
    total += matrix[prev]?.[idx] ?? UNREACHABLE_PENALTY;
    prev = idx;
  }
  if (returnToDepot && order.length > 0) {
    total += matrix[prev]?.[0] ?? UNREACHABLE_PENALTY;
  }
  return total;
}

function buildNearestNeighborOrder(numStops: number, durations: number[][], firstStop: number): number[] {
  const unvisited = new Set<number>();
  for (let i = 1; i <= numStops; i++) {
    if (i !== firstStop) unvisited.add(i);
  }

  const order: number[] = [firstStop];
  let current = firstStop;
  while (unvisited.size > 0) {
    let bestNext = -1;
    let bestCost = Infinity;
    for (const candidate of unvisited) {
      const cost = durations[current]?.[candidate] ?? UNREACHABLE_PENALTY;
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

function refineTwoOptAndOrOpt(initialOrder: number[], durations: number[][], returnToDepot: boolean): number[] {
  let order = [...initialOrder];
  if (order.length < 2) return order;

  let improved = true;
  let iterations = 0;
  let bestCost = tourDuration(order, durations, returnToDepot);

  while (improved && iterations < 200) {
    improved = false;
    iterations++;

    if (order.length >= 3) {
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidateOrder = [
            ...order.slice(0, i),
            ...order.slice(i, j + 1).reverse(),
            ...order.slice(j + 1),
          ];
          const candidateCost = tourDuration(candidateOrder, durations, returnToDepot);
          if (candidateCost + 0.01 < bestCost) {
            order = candidateOrder;
            bestCost = candidateCost;
            improved = true;
          }
        }
      }
    }

    // Or-opt 1-node relocation for asymmetric directed road networks
    for (let from = 0; from < order.length; from++) {
      const node = order[from];
      const base = [...order.slice(0, from), ...order.slice(from + 1)];
      for (let to = 0; to <= base.length; to++) {
        if (to === from) continue;
        const candidateOrder = [...base.slice(0, to), node, ...base.slice(to)];
        const candidateCost = tourDuration(candidateOrder, durations, returnToDepot);
        if (candidateCost + 0.01 < bestCost) {
          order = candidateOrder;
          bestCost = candidateCost;
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }

  return order;
}

export function solveOptimizedTour(numStops: number, durations: number[][], returnToDepot = false): number[] {
  if (numStops <= 0) return [];
  if (numStops === 1) return [1];

  const rankedStarts = Array.from({ length: numStops }, (_, i) => i + 1).sort(
    (a, b) => (durations[0]?.[a] ?? UNREACHABLE_PENALTY) - (durations[0]?.[b] ?? UNREACHABLE_PENALTY)
  );
  const numStarts = Math.min(numStops, 6);

  let globalBestOrder: number[] = [];
  let globalBestCost = Infinity;

  for (let s = 0; s < numStarts; s++) {
    const initial = buildNearestNeighborOrder(numStops, durations, rankedStarts[s]);
    const refined = refineTwoOptAndOrOpt(initial, durations, returnToDepot);
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
  returnToDepot = false
): Promise<OptimizedRouteResult> {
  if (bins.length === 0) {
    throw new RoutingError('At least one bin must be selected to generate a route', 400);
  }
  if (bins.length > MAX_WAYPOINTS) {
    throw new RoutingError(`A route can include at most ${MAX_WAYPOINTS} bins at a time.`, 400);
  }

  const osrmBase = getOsrmBase();
  const allPoints = [startPoint, ...bins];

  let orderedIndices: number[];
  if (bins.length === 1) {
    orderedIndices = [1];
  } else {
    const coordsStr = allPoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
    const tableUrl = `${osrmBase}/table/v1/driving/${coordsStr}?annotations=duration,distance`;
    const tableData = await fetchJsonWithTimeout(tableUrl);
    if (tableData.code !== 'Ok' || !Array.isArray(tableData.durations)) {
      throw new RoutingError('Road routing matrix unavailable. Please retry.', 503);
    }
    const matrix: number[][] = tableData.durations.map((row: Array<number | null>) =>
      Array.isArray(row) ? row.map((cell) => (cell === null || cell === undefined ? UNREACHABLE_PENALTY : cell)) : []
    );
    for (let i = 1; i <= bins.length; i++) {
      if ((matrix[0]?.[i] ?? UNREACHABLE_PENALTY) >= UNREACHABLE_PENALTY * 0.5) {
        throw new RoutingError(
          `Bin ${bins[i - 1].binId || bins[i - 1].label} is unreachable on the road network from the starting point.`,
          400
        );
      }
    }
    orderedIndices = solveOptimizedTour(bins.length, matrix, returnToDepot);
  }

  const orderedBins = orderedIndices.map((idx, pos) => ({
    ...allPoints[idx],
    stopOrder: pos + 1,
  }));

  const routePoints = returnToDepot ? [startPoint, ...orderedBins, startPoint] : [startPoint, ...orderedBins];
  const routeCoordsStr = routePoints.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const routeUrl = `${osrmBase}/route/v1/driving/${routeCoordsStr}?overview=full&geometries=geojson&steps=false`;
  const routeData = await fetchJsonWithTimeout(routeUrl);

  if (routeData.code !== 'Ok' || !Array.isArray(routeData.routes) || routeData.routes.length === 0) {
    throw new RoutingError('Could not compute a valid road-following route. Please verify pin locations and retry.', 503);
  }

  const bestRoute = routeData.routes[0];
  if (!bestRoute.geometry || !Array.isArray(bestRoute.geometry.coordinates) || bestRoute.geometry.coordinates.length < 2) {
    throw new RoutingError('Road routing geometry missing from provider response.', 503);
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
