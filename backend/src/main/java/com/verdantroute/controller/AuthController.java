package com.verdantroute.controller;

import com.verdantroute.dto.AuthDtos.*;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.security.JwtAuthenticationFilter;
import com.verdantroute.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;
import java.time.Duration;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register-admin")
    public ResponseEntity<AuthResponse> registerAdmin(
            @Valid @RequestBody RegisterAdminRequest body, HttpServletRequest req, HttpServletResponse res) {
        AuthResponse result = authService.registerAdmin(body);
        attachSessionCookie(req, res, result.token(), 86400);
        return ResponseEntity.status(HttpStatus.CREATED).body(result);
    }

    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest body, HttpServletRequest req, HttpServletResponse res) {
        AuthResponse result = authService.login(body);
        attachSessionCookie(req, res, result.token(), 86400);
        return ResponseEntity.ok(result);
    }

    @PostMapping("/logout")
    public ResponseEntity<SimpleSuccessResponse> logout(HttpServletRequest req, HttpServletResponse res) {
        attachSessionCookie(req, res, "", 0);
        return ResponseEntity.ok(new SimpleSuccessResponse(true));
    }

    @GetMapping("/me")
    public ResponseEntity<AuthResponse> me(@AuthenticationPrincipal AuthPrincipal principal) {
        return ResponseEntity.ok(authService.getMe(principal.userId()));
    }

    @PostMapping("/change-password")
    public ResponseEntity<MessageSuccessResponse> changePassword(
            @AuthenticationPrincipal AuthPrincipal principal,
            @Valid @RequestBody ChangePasswordRequest body) {
        authService.changePassword(principal.userId(), body);
        return ResponseEntity.ok(new MessageSuccessResponse(true, "Password updated successfully."));
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
