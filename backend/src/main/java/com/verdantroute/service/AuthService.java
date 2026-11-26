package com.verdantroute.service;

import com.verdantroute.dto.AuthDtos.*;
import com.verdantroute.entity.Area;
import com.verdantroute.entity.User;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.JwtService;
import com.verdantroute.util.ValidationUtil;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
    public AuthResponse registerAdmin(RegisterAdminRequest req) {
        String cleanName = req.name() != null ? req.name().trim() : "";
        String emailNorm = req.email() != null ? req.email().trim().toLowerCase() : "";
        String mobileNorm = req.mobile() != null ? req.mobile().trim() : "";
        String cleanArea = req.areaName() != null ? req.areaName().trim() : "";
        String cleanCity = req.city() != null ? req.city().trim() : "";

        if (cleanName.isBlank() || emailNorm.isBlank() || mobileNorm.isBlank()
                || cleanArea.isBlank() || cleanCity.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "All required fields must be filled in.");
        }
        ValidationUtil.validateEmailAndMobile(emailNorm, mobileNorm);

        if (req.confirmPassword() != null && !req.password().equals(req.confirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Passwords do not match.");
        }
        ValidationUtil.validatePasswordStrength(req.password());

        double lat = req.centreLat() != null ? req.centreLat() : 18.5204;
        double lng = req.centreLng() != null ? req.centreLng() : 73.8567;
        ValidationUtil.validateCoordinates(lat, lng);

        if (userRepository.existsByEmailIgnoreCaseOrMobile(emailNorm, mobileNorm)) {
            throw new ApiException(HttpStatus.CONFLICT, "An account with this email or mobile number already exists.");
        }

        Area area = new Area();
        area.setName(cleanArea);
        area.setCity(cleanCity);
        area.setCentreLat(lat);
        area.setCentreLng(lng);
        area = areaRepository.save(area);

        User admin = new User();
        admin.setArea(area);
        admin.setName(cleanName);
        admin.setEmail(emailNorm);
        admin.setMobile(mobileNorm);
        admin.setPasswordHash(passwordEncoder.encode(req.password()));
        admin.setRole(User.Role.ADMIN);
        admin.setStatus(User.Status.ACTIVE);
        admin = userRepository.save(admin);

        String token = jwtService.generateToken(admin);
        return new AuthResponse(token, toUserDto(admin));
    }

    @Transactional(readOnly = true)
    public AuthResponse login(LoginRequest req) {
        String idNorm = req.identifier() != null ? req.identifier().trim() : "";
        String password = req.password();
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
        return new AuthResponse(token, toUserDto(user));
    }

    @Transactional(readOnly = true)
    public AuthResponse getMe(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "User not found."));
        if (user.getStatus() != User.Status.ACTIVE) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Your account has been deactivated. Contact your area admin.");
        }
        String token = jwtService.generateToken(user);
        return new AuthResponse(token, toUserDto(user));
    }

    @Transactional
    public void changePassword(Long userId, ChangePasswordRequest req) {
        if (req.confirmPassword() != null && !req.newPassword().equals(req.confirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "New passwords do not match.");
        }
        ValidationUtil.validatePasswordStrength(req.newPassword());
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "User not found."));
        if (!passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Current password is incorrect.");
        }
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        userRepository.save(user);
    }

    public AreaDto toAreaDto(Area a) {
        return new AreaDto(
                a.getId(),
                a.getName(),
                a.getCity(),
                a.getCentreLat(),
                a.getCentreLng(),
                a.getDefaultIntervalSeconds(),
                a.getMediumThreshold(),
                a.getFullThreshold()
        );
    }

    public UserDto toUserDto(User u) {
        Area a = u.getArea();
        return new UserDto(
                u.getId(),
                a.getId(),
                u.getName(),
                u.getEmail(),
                u.getMobile(),
                u.getRole().name(),
                u.getStatus().name(),
                toAreaDto(a)
        );
    }
}
