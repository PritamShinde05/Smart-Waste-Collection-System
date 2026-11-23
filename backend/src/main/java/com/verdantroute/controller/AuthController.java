package com.verdantroute.controller;

import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.security.JwtAuthenticationFilter;
import com.verdantroute.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.time.Duration;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register-admin")
    public ResponseEntity<Map<String, Object>> registerAdmin(
            @RequestBody Map<String, Object> body, HttpServletRequest req, HttpServletResponse res) {
        Map<String, Object> result = authService.registerAdmin(
                String.valueOf(body.getOrDefault("name", "")),
                String.valueOf(body.getOrDefault("email", "")),
                String.valueOf(body.getOrDefault("mobile", "")),
                String.valueOf(body.getOrDefault("password", "")),
                body.get("confirmPassword") != null ? String.valueOf(body.get("confirmPassword")) : null,
                String.valueOf(body.getOrDefault("areaName", "")),
                String.valueOf(body.getOrDefault("city", "")),
                body.get("centreLat") instanceof Number n1 ? n1.doubleValue() : null,
                body.get("centreLng") instanceof Number n2 ? n2.doubleValue() : null
        );
        attachSessionCookie(req, res, (String) result.get("token"), 86400);
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(
            @RequestBody Map<String, Object> body, HttpServletRequest req, HttpServletResponse res) {
        Map<String, Object> result = authService.login(
                String.valueOf(body.getOrDefault("identifier", "")),
                String.valueOf(body.getOrDefault("password", ""))
        );
        attachSessionCookie(req, res, (String) result.get("token"), 86400);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logout(HttpServletRequest req, HttpServletResponse res) {
        attachSessionCookie(req, res, "", 0);
        return ResponseEntity.ok(Map.of("success", true));
    }

    @GetMapping("/me")
    public ResponseEntity<Map<String, Object>> me(@AuthenticationPrincipal AuthPrincipal principal) {
        return ResponseEntity.ok(authService.getMe(principal.userId()));
    }

    @PostMapping("/change-password")
    public ResponseEntity<Map<String, Object>> changePassword(
            @AuthenticationPrincipal AuthPrincipal principal, @RequestBody Map<String, Object> body) {
        authService.changePassword(
                principal.userId(),
                String.valueOf(body.getOrDefault("currentPassword", "")),
                String.valueOf(body.getOrDefault("newPassword", "")),
                body.get("confirmPassword") != null ? String.valueOf(body.get("confirmPassword")) : null
        );
        return ResponseEntity.ok(Map.of("success", true, "message", "Password updated successfully."));
    }

    private void attachSessionCookie(HttpServletRequest req, HttpServletResponse res, String token, long maxAgeSec) {
        boolean secure = req.isSecure() || "https".equalsIgnoreCase(req.getHeader("X-Forwarded-Proto"));
        ResponseCookie cookie = ResponseCookie.from(JwtAuthenticationFilter.SESSION_COOKIE, token)
                .httpOnly(true)
                .secure(secure)
                .path("/")
                .maxAge(Duration.ofSeconds(maxAgeSec))
                .sameSite(secure ? "None" : "Lax")
                .build();
        res.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
