package com.verdantroute.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.Sensor;
import com.verdantroute.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class RouteOptimizationService {
    private final String osrmBaseUrl;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public record OptimizedResult(
            List<Sensor> orderedBins,
            String routeGeometryJson,
            double totalDistanceMeters,
            double estimatedTimeSeconds
    ) {}

    public RouteOptimizationService(
            @Value("${app.osrm.base-url}") String osrmBaseUrl,
            ObjectMapper objectMapper) {
        this.osrmBaseUrl = osrmBaseUrl;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public OptimizedResult optimize(double startLat, double startLng, List<Sensor> bins) {
        if (bins == null || bins.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Select at least one bin.");
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
            orderedIndices = solveNearestNeighborAndTwoOpt(bins.size(), durations);
        }

        List<Sensor> orderedBins = orderedIndices.stream()
                .map(idx -> bins.get(idx - 1))
                .toList();

        StringBuilder routeCoords = new StringBuilder();
        routeCoords.append(startLng).append(",").append(startLat);
        for (Sensor b : orderedBins) {
            routeCoords.append(";").append(b.getLongitude()).append(",").append(b.getLatitude());
        }

        JsonNode routeJson = fetchJson(
                osrmBaseUrl + "/route/v1/driving/" + routeCoords + "?overview=full&geometries=geojson&steps=false");
        if (!"Ok".equals(routeJson.path("code").asText()) || !routeJson.path("routes").isArray()
                || routeJson.path("routes").isEmpty()) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "Road routing unavailable. Please retry.", true);
        }

        JsonNode bestRoute = routeJson.path("routes").get(0);
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
                    .timeout(Duration.ofSeconds(12))
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
                m[i][j] = (cell == null || cell.isNull()) ? 1e9 : cell.asDouble();
            }
        }
        return m;
    }

    List<Integer> solveNearestNeighborAndTwoOpt(int numStops, double[][] durations) {
        Set<Integer> unvisited = new LinkedHashSet<>();
        for (int i = 1; i <= numStops; i++) unvisited.add(i);

        List<Integer> order = new ArrayList<>();
        int current = 0;
        while (!unvisited.isEmpty()) {
            int bestNext = -1;
            double bestCost = Double.MAX_VALUE;
            for (int cand : unvisited) {
                if (durations[current][cand] < bestCost) {
                    bestCost = durations[current][cand];
                    bestNext = cand;
                }
            }
            order.add(bestNext);
            unvisited.remove(bestNext);
            current = bestNext;
        }

        if (order.size() >= 3) {
            boolean improved = true;
            int iter = 0;
            while (improved && iter < 200) {
                improved = false;
                iter++;
                double bestCost = tourDuration(order, durations);
                for (int i = 0; i < order.size() - 1; i++) {
                    for (int j = i + 1; j < order.size(); j++) {
                        List<Integer> cand = new ArrayList<>(order);
                        Collections.reverse(cand.subList(i, j + 1));
                        double cost = tourDuration(cand, durations);
                        if (cost + 0.01 < bestCost) {
                            order = cand;
                            bestCost = cost;
                            improved = true;
                        }
                    }
                }
            }
        }
        return order;
    }

    private double tourDuration(List<Integer> order, double[][] matrix) {
        double total = 0;
        int prev = 0;
        for (int idx : order) {
            total += matrix[prev][idx];
            prev = idx;
        }
        return total;
    }
}
