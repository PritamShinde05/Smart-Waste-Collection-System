package com.verdantroute.websocket;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.entity.User;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.security.JwtAuthenticationFilter;
import com.verdantroute.security.JwtService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;
import java.io.IOException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RealtimeWebSocketHandler extends TextWebSocketHandler {
    private final JwtService jwtService;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;
    private final Set<SessionMeta> sessions = ConcurrentHashMap.newKeySet();

    private record SessionMeta(WebSocketSession session, AuthPrincipal principal) {}

    public RealtimeWebSocketHandler(JwtService jwtService, UserRepository userRepository, ObjectMapper objectMapper) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String token = session.getUri() != null
                ? UriComponentsBuilder.fromUri(session.getUri()).build().getQueryParams().getFirst("token")
                : null;
        if (token == null || token.isBlank()) {
            token = extractSessionCookie(session.getHandshakeHeaders().get("Cookie"));
        }
        if (token == null || token.isBlank()) {
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }
        try {
            AuthPrincipal principal = jwtService.parseToken(token);
            User dbUser = userRepository.findById(principal.userId()).orElse(null);
            if (dbUser == null || dbUser.getStatus() != User.Status.ACTIVE) {
                session.close(CloseStatus.POLICY_VIOLATION);
                return;
            }
            sessions.add(new SessionMeta(session, principal));
            sendRaw(session, Map.of("event", "connected", "payload", Map.of(
                    "userId", principal.userId(), "areaId", principal.areaId(), "role", principal.role().name())));
        } catch (Exception ex) {
            session.close(CloseStatus.POLICY_VIOLATION);
        }
    }

    private String extractSessionCookie(List<String> cookieHeaders) {
        if (cookieHeaders == null) return null;
        for (String header : cookieHeaders) {
            for (String part : header.split(";")) {
                String trimmed = part.trim();
                if (trimmed.startsWith(JwtAuthenticationFilter.SESSION_COOKIE + "=")) {
                    return trimmed.substring((JwtAuthenticationFilter.SESSION_COOKIE + "=").length()).trim();
                }
            }
        }
        return null;
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.removeIf(s -> s.session().getId().equals(session.getId()));
    }

    public void broadcastToAreaAdmins(Long areaId, String event, Object payload) {
        Map<String, Object> msg = Map.of("event", event, "payload", payload, "timestamp", Instant.now().toString());
        for (SessionMeta meta : sessions) {
            if (meta.principal().areaId().equals(areaId)
                    && meta.principal().role() == User.Role.ADMIN
                    && meta.session().isOpen()) {
                sendRaw(meta.session(), msg);
            }
        }
    }

    public void broadcastToUser(Long userId, Long areaId, String event, Object payload) {
        Map<String, Object> msg = Map.of("event", event, "payload", payload, "timestamp", Instant.now().toString());
        for (SessionMeta meta : sessions) {
            if (meta.principal().userId().equals(userId)
                    && meta.principal().areaId().equals(areaId)
                    && meta.session().isOpen()) {
                sendRaw(meta.session(), msg);
            }
        }
    }

    private void sendRaw(WebSocketSession session, Object body) {
        try {
            String json = objectMapper.writeValueAsString(body);
            synchronized (session) {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(json));
                }
            }
        } catch (IOException | IllegalStateException ignored) {
        }
    }
}
