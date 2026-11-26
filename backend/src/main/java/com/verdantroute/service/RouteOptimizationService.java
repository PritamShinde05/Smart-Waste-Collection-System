package com.verdantroute.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.Sensor;
import com.verdantroute.exception.ApiException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;

@Service
public class RouteOptimizationService {
    private static final double UNREACHABLE_PENALTY = 1e9;

    private final String osrmBaseUrl;
    private final int maxWaypoints;
    private final int timeoutSeconds;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public record OptimizedResult(
            List<Sensor> orderedBins,
            String routeGeometryJson,
            double totalDistanceMeters,
            double estimatedTimeSeconds
    ) {}

    public RouteOptimizationService(String osrmBaseUrl, ObjectMapper objectMapper) {
        this(osrmBaseUrl, 50, 12, objectMapper);
    }

    @Autowired
    public RouteOptimizationService(
            @Value("${app.osrm.base-url}") String osrmBaseUrl,
            @Value("${app.osrm.max-waypoints:50}") int maxWaypoints,
            @Value("${app.osrm.timeout-seconds:12}") int timeoutSeconds,
            ObjectMapper objectMapper) {
        this.osrmBaseUrl = osrmBaseUrl.replaceAll("/+$", "");
        this.maxWaypoints = Math.max(2, Math.min(95, maxWaypoints));
        this.timeoutSeconds = Math.max(3, timeoutSeconds);
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(this.timeoutSeconds))
                .build();
    }

    public int getMaxWaypoints() {
        return maxWaypoints;
    }

    public OptimizedResult optimize(double startLat, double startLng, List<Sensor> bins) {
        return optimize(startLat, startLng, bins, false);
    }

    public OptimizedResult optimize(double startLat, double startLng, List<Sensor> bins, boolean returnToDepot) {
        if (bins == null || bins.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one bin.");
        }
        if (bins.size() > maxWaypoints) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "A route can include at most " + maxWaypoints + " bins at a time.");
        }

        List<Integer> orderedIndices;
        if (bins.size() == 1) {
            orderedIndices = List.of(1);
        } else {
            StringBuilder coords = new StringBuilder();
            coords.append(startLng).append(",").append(startLat);
            for (Sensor b : bins) {
                coords.append(";").append(b.getLongitude()).append(",").append(b.getLatitude());
            }
            JsonNode tableJson = fetchJson(osrmBaseUrl + "/table/v1/driving/" + coords + "?annotations=duration,distance");
            if (!"Ok".equals(tableJson.path("code").asText()) || !tableJson.path("durations").isArray()) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing matrix unavailable. Please retry.", true);
            }
            double[][] durations = parseMatrix(tableJson.path("durations"), bins.size() + 1);
            for (int i = 1; i <= bins.size(); i++) {
                if (durations[0][i] >= UNREACHABLE_PENALTY * 0.5) {
                    throw new ApiException(HttpStatus.BAD_REQUEST,
                            "Bin " + bins.get(i - 1).getBinId() + " is unreachable on the road network from the starting point.");
                }
            }
            orderedIndices = solveOptimizedTour(bins.size(), durations, returnToDepot);
        }

        List<Sensor> orderedBins = orderedIndices.stream()
                .map(idx -> bins.get(idx - 1))
                .toList();

        StringBuilder routeCoords = new StringBuilder();
        routeCoords.append(startLng).append(",").append(startLat);
        for (Sensor b : orderedBins) {
            routeCoords.append(";").append(b.getLongitude()).append(",").append(b.getLatitude());
        }
        if (returnToDepot) {
            routeCoords.append(";").append(startLng).append(",").append(startLat);
        }

        JsonNode routeJson = fetchJson(
                osrmBaseUrl + "/route/v1/driving/" + routeCoords + "?overview=full&geometries=geojson&steps=false");
        if (!"Ok".equals(routeJson.path("code").asText()) || !routeJson.path("routes").isArray()
                || routeJson.path("routes").isEmpty()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing unavailable. Please retry.", true);
        }

        JsonNode bestRoute = routeJson.path("routes").get(0);
        if (!bestRoute.path("geometry").path("coordinates").isArray()
                || bestRoute.path("geometry").path("coordinates").size() < 2) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing returned empty geometry. Please retry.", true);
        }

        try {
            String geometryJson = objectMapper.writeValueAsString(bestRoute.path("geometry"));
            return new OptimizedResult(
                    orderedBins,
                    geometryJson,
                    Math.round(bestRoute.path("distance").asDouble(0.0)),
                    Math.round(bestRoute.path("duration").asDouble(0.0)));
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Could not parse road geometry.", true);
        }
    }

    private JsonNode fetchJson(String url) {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(timeoutSeconds))
                    .GET()
                    .build();
            HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing provider returned " + resp.statusCode(), true);
            }
            return objectMapper.readTree(resp.body());
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing service temporarily unavailable. Please retry.", true);
        }
    }

    private double[][] parseMatrix(JsonNode arr, int size) {
        double[][] m = new double[size][size];
        for (int i = 0; i < size; i++) {
            for (int j = 0; j < size; j++) {
                JsonNode cell = arr.get(i).get(j);
                m[i][j] = (cell == null || cell.isNull()) ? UNREACHABLE_PENALTY : cell.asDouble();
            }
        }
        return m;
    }

    List<Integer> solveNearestNeighborAndTwoOpt(int numStops, double[][] durations) {
        return solveOptimizedTour(numStops, durations, false);
    }

    List<Integer> solveOptimizedTour(int numStops, double[][] durations, boolean returnToDepot) {
        if (numStops <= 0) return List.of();
        if (numStops == 1) return List.of(1);

        // Multi-start candidate first stops (sorted nearest from start 0)
        List<Integer> rankedStarts = new ArrayList<>();
        for (int i = 1; i <= numStops; i++) rankedStarts.add(i);
        rankedStarts.sort(Comparator.comparingDouble(a -> durations[0][a]));
        int numStarts = Math.min(numStops, 6);

        List<Integer> globalBestOrder = null;
        double globalBestCost = Double.MAX_VALUE;

        for (int s = 0; s < numStarts; s++) {
            int firstStop = rankedStarts.get(s);
            List<Integer> order = buildNearestNeighborOrder(numStops, durations, firstStop);
            order = refineTwoOptAndOrOpt(order, durations, returnToDepot);
            double cost = tourDuration(order, durations, returnToDepot);
            if (cost < globalBestCost) {
                globalBestCost = cost;
                globalBestOrder = order;
            }
        }
        return globalBestOrder != null ? globalBestOrder : List.of();
    }

    private List<Integer> buildNearestNeighborOrder(int numStops, double[][] durations, int firstStop) {
        Set<Integer> unvisited = new LinkedHashSet<>();
        for (int i = 1; i <= numStops; i++) {
            if (i != firstStop) unvisited.add(i);
        }
        List<Integer> order = new ArrayList<>(numStops);
        order.add(firstStop);
        int current = firstStop;

        while (!unvisited.isEmpty()) {
            int bestNext = -1;
            double bestCost = Double.MAX_VALUE;
            for (int cand : unvisited) {
                if (durations[current][cand] < bestCost) {
                    bestCost = durations[current][cand];
                    bestNext = cand;
                }
            }
            if (bestNext == -1) break;
            order.add(bestNext);
            unvisited.remove(bestNext);
            current = bestNext;
        }
        return order;
    }

    private List<Integer> refineTwoOptAndOrOpt(List<Integer> initialOrder, double[][] durations, boolean returnToDepot) {
        List<Integer> order = new ArrayList<>(initialOrder);
        if (order.size() < 2) return order;

        boolean improved = true;
        int iter = 0;
        double bestCost = tourDuration(order, durations, returnToDepot);

        while (improved && iter < 200) {
            improved = false;
            iter++;

            // 2-opt segment reversals (evaluated against full asymmetric matrix)
            if (order.size() >= 3) {
                for (int i = 0; i < order.size() - 1; i++) {
                    for (int j = i + 1; j < order.size(); j++) {
                        List<Integer> cand = new ArrayList<>(order);
                        Collections.reverse(cand.subList(i, j + 1));
                        double cost = tourDuration(cand, durations, returnToDepot);
                        if (cost + 0.01 < bestCost) {
                            order = cand;
                            bestCost = cost;
                            improved = true;
                        }
                    }
                }
            }

            // Or-opt 1-node relocation across positions (handles asymmetric directed streets)
            for (int from = 0; from < order.size(); from++) {
                Integer node = order.get(from);
                List<Integer> base = new ArrayList<>(order);
                base.remove(from);
                for (int to = 0; to <= base.size(); to++) {
                    if (to == from) continue;
                    List<Integer> cand = new ArrayList<>(base);
                    cand.add(to, node);
                    double cost = tourDuration(cand, durations, returnToDepot);
                    if (cost + 0.01 < bestCost) {
                        order = cand;
                        bestCost = cost;
                        improved = true;
                        break;
                    }
                }
                if (improved) break;
            }
        }
        return order;
    }

    double tourDuration(List<Integer> order, double[][] matrix, boolean returnToDepot) {
        double total = 0;
        int prev = 0;
        for (int idx : order) {
            total += matrix[prev][idx];
            prev = idx;
        }
        if (returnToDepot && !order.isEmpty()) {
            total += matrix[prev][0];
        }
        return total;
    }
}
