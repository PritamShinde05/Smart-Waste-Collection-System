# ESP32 Hardware API Integration Guide

This document defines the HTTP ingestion endpoint used by smart bin hardware devices to report ultrasonic fill readings to **VerdantRoute**.

---

## 1. Provisioning a Device Key

1. Sign in as an **Admin** and open **Sensors -> Add Sensor** (`A4`).
2. Enter a unique **Bin ID** (e.g., `BIN-101`), label, bin height in cm, reading interval, full threshold, and drop the map pin at the bin's physical GPS coordinates.
3. Submit the form. The server returns a **one-time Device Key** (format `vr_<sensorId>_<randomHex>`).
4. Copy the key immediately (it is hashed with BCrypt on the server and cannot be viewed again; if lost, regenerate it from **Bin Detail -> Regenerate Device Key**).
5. In `/hardware/smart_bin_esp32.ino`, replace `WIFI_SSID`, `WIFI_PASSWORD`, `SERVER_BASE_URL`, `BIN_ID`, `DEVICE_KEY`, `SENSOR_MOUNT_OFFSET_CM` (measured transducer clearance above the bin rim), and `ROOT_CA_PEM` (your HTTPS server Root CA certificate for `setCACert()` TLS verification). Do **not** use `setInsecure()` in production.

---

## 2. Reading Ingestion Endpoint

- **Method & URL**: `POST /api/device/reading`
- **Headers**:
  - `Content-Type: application/json`
  - `X-Device-Key: <deviceKey>` *(optional if `deviceKey` is provided inside the JSON body)*

### Request Body

```json
{
  "binId": "BIN-101",
  "deviceKey": "vr_1_a4f9c28e...",
  "distanceCm": 24.5,
  "timestamp": "2026-11-23T09:15:00Z"
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `binId` | string | Yes | Case-insensitive Bin ID matching the registered sensor |
| `deviceKey` | string | Yes* | Required in body or `X-Device-Key` header |
| `distanceCm` | number | Yes | Measured distance from sensor face to waste surface (`0 <= distanceCm <= binHeightCm`) |
| `timestamp` | string (ISO-8601) | No | Used when flushing buffered offline readings; defaults to server UTC time if omitted |

### Success Response (`201 Created`)

```json
{
  "success": true,
  "binId": "BIN-101",
  "fillPercentage": 79.58,
  "status": "MEDIUM",
  "readingIntervalSeconds": 900
}
```

The firmware reads `readingIntervalSeconds` from the response so any interval change made by the Admin in **Bin Detail** or **Area Settings** automatically propagates to the physical device on its next check-in.

### Error Responses

| Status | Meaning | Hardware Action |
| --- | --- | --- |
| `400 Bad Request` | Negative distance or `distanceCm > binHeightCm` | Reading flagged as out-of-range; do not re-queue |
| `401 Unauthorized` | Invalid `binId` or `deviceKey` | Check device credentials; do not re-queue |
| `403 Forbidden` | Sensor has been deactivated by Admin | Stand by; do not re-queue |
| `5xx` / Network Error | Server unreachable | Buffer reading locally with timestamp and retry on reconnect |

---

## 3. Testing Without Physical Hardware

### Option A — `curl` Command

```bash
curl -X POST http://localhost:3000/api/device/reading \
  -H "Content-Type: application/json" \
  -d '{
    "binId": "BIN-101",
    "deviceKey": "YOUR_ONE_TIME_DEVICE_KEY",
    "distanceCm": 15.0
  }'
```

*(Change port `3000` to `8080` when targeting the standalone Java Spring Boot backend.)*

### Option B — Admin QA Simulator

In the web app, open **Sensors -> [Bin] -> Hardware Test Simulator** (`A5`). That panel calls the Admin-authenticated endpoint `POST /api/sensors/:id/simulate-reading` (kept strictly separate from the ESP32 device key endpoint) so QA teams can verify fill calculations, status transitions, and live WebSocket map updates without physical hardware.
