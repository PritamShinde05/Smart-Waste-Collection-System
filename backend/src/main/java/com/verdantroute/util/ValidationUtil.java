package com.verdantroute.util;

import com.verdantroute.exception.ApiException;
import org.springframework.http.HttpStatus;

public final class ValidationUtil {
    private ValidationUtil() {}

    public static void validateEmailAndMobile(String email, String mobile) {
        if (email == null || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Please enter a valid email address.");
        }
        if (mobile == null || !mobile.matches("^[0-9+\\-\\s]{7,20}$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Please enter a valid mobile number.");
        }
    }

    public static void validatePasswordStrength(String password) {
        if (password == null || password.length() < 8
                || !password.matches(".*[A-Za-z].*")
                || !password.matches(".*[0-9].*")) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "Password must be at least 8 characters and contain letters and numbers.");
        }
    }

    public static void validateCoordinates(double lat, double lng) {
        if (Double.isNaN(lat) || Double.isNaN(lng)
                || lat < -90.0 || lat > 90.0
                || lng < -180.0 || lng > 180.0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Valid map coordinates (latitude and longitude) are required.");
        }
    }
}
