package com.verdantroute.util;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class DeviceKeyUtil {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Pattern KEY_PREFIX = Pattern.compile("^vr_(\\d+)_");

    private DeviceKeyUtil() {}

    public static String generateDeviceKey(Long sensorId) {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        return "vr_" + sensorId + "_" + HexFormat.of().formatHex(bytes);
    }

    public static Optional<Long> extractSensorId(String deviceKey) {
        if (deviceKey == null) {
            return Optional.empty();
        }
        Matcher m = KEY_PREFIX.matcher(deviceKey.trim());
        if (!m.find()) {
            return Optional.empty();
        }
        try {
            return Optional.of(Long.parseLong(m.group(1)));
        } catch (NumberFormatException ex) {
            return Optional.empty();
        }
    }
}
