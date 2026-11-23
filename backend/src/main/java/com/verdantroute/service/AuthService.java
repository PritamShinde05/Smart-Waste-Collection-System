package com.verdantroute.service;

import com.verdantroute.entity.Area;
import com.verdantroute.entity.User;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.JwtService;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AuthService {
    private final UserRepository userRepository;
    private final AreaRepository areaRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(
            UserRepository userRepository,
            AreaRepository areaRepository,
            PasswordEncoder passwordEncoder,
            JwtService jwtService) {
        this.userRepository = userRepository;
        this.areaRepository = areaRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    @Transactional
    public Map<String, Object> registerAdmin(
            String name, String email, String mobile, String password, String confirmPassword,
            String areaName, String city, Double centreLat, Double centreLng) {
        String cleanName = name != null ? name.trim() : "";
        String emailNorm = email != null ? email.trim().toLowerCase() : "";
        String mobileNorm = mobile != null ? mobile.trim() : "";
        String cleanArea = areaName != null ? areaName.trim() : "";
        String cleanCity = city != null ? city.trim() : "";

        if (cleanName.isBlank() || emailNorm.isBlank() || mobileNorm.isBlank() || cleanArea.isBlank() || cleanCity.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "All required fields must be filled in.");
        }
        validateEmailAndMobile(emailNorm, mobileNorm);

        if (confirmPassword != null && !password.equals(confirmPassword)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Passwords do not match.");
        }
        validatePasswordStrength(password);

        if (userRepository.existsByEmailIgnoreCaseOrMobile(emailNorm, mobileNorm)) {
            throw new ApiException(HttpStatus.CONFLICT, "An account with this email or mobile number already exists.");
        }

        Area area = new Area();
        area.setName(cleanArea);
        area.setCity(cleanCity);
        area.setCentreLat(centreLat != null ? centreLat : 18.5204);
        area.setCentreLng(centreLng != null ? centreLng : 73.8567);
        area = areaRepository.save(area);

        User admin = new User();
        admin.setArea(area);
        admin.setName(cleanName);
        admin.setEmail(emailNorm);
        admin.setMobile(mobileNorm);
        admin.setPasswordHash(passwordEncoder.encode(password));
        admin.setRole(User.Role.ADMIN);
        admin.setStatus(User.Status.ACTIVE);
        admin = userRepository.save(admin);

        String token = jwtService.generateToken(admin);
        return Map.of("token", token, "user", serializeUser(admin));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> login(String identifier, String password) {
        String idNorm = identifier != null ? identifier.trim() : "";
        if (idNorm.isBlank() || password == null || password.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Please provide your email or mobile number and password.");
        }
        User user = userRepository.findByEmailIgnoreCaseOrMobile(idNorm.toLowerCase(), idNorm)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Invalid credentials."));

        if (!passwordEncoder.matches(password, user.getPasswordHash())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Invalid credentials.");
        }
        if (user.getStatus() != User.Status.ACTIVE) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Your account has been deactivated. Contact your area admin.");
        }

        String token = jwtService.generateToken(user);
        return Map.of("token", token, "user", serializeUser(user));
    }

    @Transactional(readOnly = true)
    public Map<String, Object> getMe(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "User not found."));
        String token = jwtService.generateToken(user);
        return Map.of("token", token, "user", serializeUser(user));
    }

    public void validateEmailAndMobile(String email, String mobile) {
        if (email == null || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Please enter a valid email address.");
        }
        if (mobile == null || !mobile.matches("^[0-9+\\-\\s]{7,20}$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Please enter a valid mobile number.");
        }
    }

    @Transactional
    public void changePassword(Long userId, String currentPassword, String newPassword, String confirmPassword) {
        if (confirmPassword != null && !newPassword.equals(confirmPassword)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "New passwords do not match.");
        }
        validatePasswordStrength(newPassword);
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "User not found."));
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Current password is incorrect.");
        }
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
    }

    public void validatePasswordStrength(String password) {
        if (password == null || password.length() < 8 || !password.matches(".*[A-Za-z].*") || !password.matches(".*[0-9].*")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Password must be at least 8 characters and contain letters and numbers.");
        }
    }

    public Map<String, Object> serializeUser(User u) {
        Area a = u.getArea();
        Map<String, Object> areaMap = new LinkedHashMap<>();
        areaMap.put("id", a.getId());
        areaMap.put("name", a.getName());
        areaMap.put("city", a.getCity());
        areaMap.put("centreLat", a.getCentreLat());
        areaMap.put("centreLng", a.getCentreLng());
        areaMap.put("defaultIntervalSeconds", a.getDefaultIntervalSeconds());
        areaMap.put("mediumThreshold", a.getMediumThreshold());
        areaMap.put("fullThreshold", a.getFullThreshold());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", u.getId());
        out.put("areaId", a.getId());
        out.put("name", u.getName());
        out.put("email", u.getEmail());
        out.put("mobile", u.getMobile());
        out.put("role", u.getRole().name());
        out.put("status", u.getStatus().name());
        out.put("area", areaMap);
        return out;
    }
}
