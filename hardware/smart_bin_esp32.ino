/*
 * VerdantRoute — ESP32 + HC-SR04 Smart Waste Bin Sensor Firmware
 *
 * Security & Reliability Features:
 *  - Verified HTTPS TLS via WiFiClientSecure.setCACert(ROOT_CA_PEM) (no setInsecure())
 *  - Startup placeholder validation to prevent unconfigured device uploads
 *  - 9-sample median filtering + burst spread rejection against irregular surfaces/noise
 *  - Sensor mounting calibration offset (SENSOR_MOUNT_OFFSET_CM) & local range guard
 *  - NTP UTC time synchronization for delayed offline reading accuracy
 *  - LittleFS persistent offline queue with automatic Wi-Fi reconnect recovery
 *  - Dynamic reading interval updates returned by the server
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

// ==================== PROVISIONING CONFIGURATION ====================
// Replace ALL placeholder values below before flashing to your ESP32.
// Never commit real Wi-Fi passwords or production device keys to Git.
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Base URL of your official Java Spring Boot backend
// Example local LAN:  "http://192.168.1.50:8080"
// Example production: "https://api.your-municipality.org"
const char* SERVER_BASE_URL = "https://api.your-domain.example";

// Provisioned in VerdantRoute Admin -> Sensors -> Add Sensor
const char* BIN_ID     = "BIN-101";
const char* DEVICE_KEY = "PASTE_YOUR_ONE_TIME_DEVICE_KEY_HERE";

// PEM-encoded Root CA certificate for HTTPS verification (required when SERVER_BASE_URL uses https://).
// For Let's Encrypt / Google Trust Services / your reverse proxy CA, paste the full PEM block below.
const char* ROOT_CA_PEM = R"EOF(
PASTE_ROOT_CA_PEM_HERE
)EOF";

// ==================== SENSOR & CALIBRATION SETTINGS ====================
// HC-SR04 GPIO Pins (use a 1k/2k resistor voltage divider on ECHO -> 3.3V safe!)
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// Calibration: distance (cm) from sensor face down to the bin's 0 cm (100% full) top rim.
// Example: if the ultrasonic face is mounted 4.0 cm above the bin rim, set 4.0f.
const float SENSOR_MOUNT_OFFSET_CM = 0.0f;
const float MIN_ECHO_CM = 2.0f;
const float MAX_ECHO_CM = 450.0f;

// Sampling & reliability tuning
const int SAMPLES_PER_READING = 9;
const int MIN_VALID_SAMPLES = 3;
const float MAX_SAMPLE_SPREAD_CM = 25.0f;
const unsigned long SAMPLE_DELAY_MS = 65;

// Persistent offline recovery queue
const char* QUEUE_FILE = "/offline_readings.jsonl";
const size_t MAX_QUEUED_READINGS = 120;

// Default reading interval (overridden dynamically by server response)
unsigned long readingIntervalSeconds = 900; // 15 minutes default
bool configValid = false;

// ==================== CONFIGURATION VALIDATION ====================
bool isPlaceholder(const char* value, const char* marker) {
  if (!value || strlen(value) == 0) return true;
  return strstr(value, marker) != nullptr;
}

bool validateConfiguration() {
  bool ok = true;
  if (isPlaceholder(WIFI_SSID, "YOUR_WIFI_SSID") || isPlaceholder(WIFI_PASSWORD, "YOUR_WIFI_PASSWORD")) {
    Serial.println("[CONFIG ERROR] Replace WIFI_SSID and WIFI_PASSWORD placeholders before running.");
    ok = false;
  }
  if (isPlaceholder(DEVICE_KEY, "PASTE_YOUR_ONE_TIME_DEVICE_KEY_HERE") || strlen(BIN_ID) == 0) {
    Serial.println("[CONFIG ERROR] Replace BIN_ID and DEVICE_KEY with your provisioned sensor credentials.");
    ok = false;
  }
  String base(SERVER_BASE_URL);
  if (base.indexOf("your-domain.example") >= 0) {
    Serial.println("[CONFIG ERROR] Set SERVER_BASE_URL to your Spring Boot backend URL.");
    ok = false;
  }
  if (base.startsWith("https://") && isPlaceholder(ROOT_CA_PEM, "PASTE_ROOT_CA_PEM_HERE")) {
    Serial.println("[CONFIG ERROR] HTTPS requires a valid ROOT_CA_PEM certificate for TLS verification.");
    ok = false;
  }
  return ok;
}

// ==================== TIME & ULTRASONIC SENSING ====================
void setupTime() {
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Syncing NTP time");
  time_t now = time(nullptr);
  int retries = 0;
  while (now < 1700000000 && retries < 20) {
    delay(500);
    Serial.print(".");
    now = time(nullptr);
    retries++;
  }
  Serial.println(now >= 1700000000 ? " synced." : " failed (server timestamp will be used).");
}

String getIsoTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) {
    return "";
  }
  struct tm timeinfo;
  gmtime_r(&now, &timeinfo);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

float measureSingleDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  // Timeout 35ms (~600 cm round-trip limit)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 35000UL);
  if (duration == 0) {
    return -1.0f;
  }
  return (duration * 0.0343f) / 2.0f;
}

float measureCalibratedMedianDistanceCm() {
  float valid[SAMPLES_PER_READING];
  int count = 0;

  for (int i = 0; i < SAMPLES_PER_READING; i++) {
    float raw = measureSingleDistanceCm();
    if (raw >= MIN_ECHO_CM && raw <= MAX_ECHO_CM) {
      float calibrated = raw - SENSOR_MOUNT_OFFSET_CM;
      if (calibrated < 0.0f) calibrated = 0.0f;
      valid[count++] = calibrated;
    }
    delay(SAMPLE_DELAY_MS);
  }

  if (count < MIN_VALID_SAMPLES) {
    Serial.printf("Insufficient valid ultrasonic samples (%d/%d).\n", count, MIN_VALID_SAMPLES);
    return -1.0f;
  }

  // Insertion sort for median + spread outlier rejection
  for (int i = 1; i < count; i++) {
    float key = valid[i];
    int j = i - 1;
    while (j >= 0 && valid[j] > key) {
      valid[j + 1] = valid[j];
      j--;
    }
    valid[j + 1] = key;
  }

  // Check interquartile/inner spread (ignore outermost single outlier on each end when count >= 5)
  int lowIdx = count >= 5 ? 1 : 0;
  int highIdx = count >= 5 ? count - 2 : count - 1;
  float spread = valid[highIdx] - valid[lowIdx];
  if (spread > MAX_SAMPLE_SPREAD_CM) {
    Serial.printf("Unstable echo burst rejected (spread %.2f cm > %.2f cm).\n", spread, MAX_SAMPLE_SPREAD_CM);
    return -1.0f;
  }

  return valid[count / 2];
}

// ==================== NETWORK & VERIFIED TLS UPLOAD ====================
bool connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000UL) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("Wi-Fi connection failed.");
  return false;
}

bool postPayload(const String& jsonBody) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  String endpoint = String(SERVER_BASE_URL) + "/api/device/reading";
  HTTPClient http;
  WiFiClient plainClient;
  WiFiClientSecure secureClient;

  bool started = false;
  if (endpoint.startsWith("https://")) {
    secureClient.setCACert(ROOT_CA_PEM);
    started = http.begin(secureClient, endpoint);
  } else if (endpoint.startsWith("http://")) {
    started = http.begin(plainClient, endpoint);
  } else {
    Serial.println("Invalid SERVER_BASE_URL scheme.");
    return false;
  }

  if (!started) {
    Serial.println("HTTP begin failed.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", DEVICE_KEY);
  http.setTimeout(10000);

  int statusCode = http.POST(jsonBody);
  String response = http.getString();
  http.end();

  Serial.printf("POST %s -> HTTP %d: %s\n", endpoint.c_str(), statusCode, response.c_str());

  if (statusCode >= 200 && statusCode < 300) {
    StaticJsonDocument<512> respDoc;
    if (deserializeJson(respDoc, response) == DeserializationError::Ok) {
      if (respDoc.containsKey("readingIntervalSeconds")) {
        unsigned long nextInterval = respDoc["readingIntervalSeconds"].as<unsigned long>();
        if (nextInterval >= 60 && nextInterval <= 14400) {
          readingIntervalSeconds = nextInterval;
          Serial.printf("Updated reading interval: %lu s\n", readingIntervalSeconds);
        }
      }
    }
    return true;
  }

  // Do not re-queue permanently rejected payloads (400 out-of-range, 401 bad key, 403 deactivated)
  if (statusCode == 400 || statusCode == 401 || statusCode == 403) {
    Serial.println("Server rejected reading permanently; dropping entry.");
    return true;
  }

  return false;
}

// ==================== PERSISTENT OFFLINE RECOVERY QUEUE ====================
void enqueueReading(const String& jsonLine) {
  if (!LittleFS.begin(true)) {
    return;
  }

  int lineCount = 0;
  if (LittleFS.exists(QUEUE_FILE)) {
    File f = LittleFS.open(QUEUE_FILE, FILE_READ);
    while (f && f.available()) {
      f.readStringUntil('\n');
      lineCount++;
    }
    if (f) f.close();
  }

  if (lineCount >= (int)MAX_QUEUED_READINGS) {
    Serial.println("Offline queue full; skipping enqueue to protect flash.");
    return;
  }

  File f = LittleFS.open(QUEUE_FILE, FILE_APPEND);
  if (f) {
    f.println(jsonLine);
    f.close();
    Serial.println("Saved reading to offline queue.");
  }
}

void flushOfflineQueue() {
  if (!LittleFS.begin(true) || !LittleFS.exists(QUEUE_FILE)) {
    return;
  }

  File f = LittleFS.open(QUEUE_FILE, FILE_READ);
  if (!f) return;

  String remaining = "";
  bool stopSending = false;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    if (!stopSending && postPayload(line)) {
      delay(150);
    } else {
      stopSending = true;
      remaining += line + "\n";
    }
  }
  f.close();

  if (remaining.length() == 0) {
    LittleFS.remove(QUEUE_FILE);
    Serial.println("Offline queue flushed completely.");
  } else {
    File out = LittleFS.open(QUEUE_FILE, FILE_WRITE);
    if (out) {
      out.print(remaining);
      out.close();
    }
  }
}

String buildReadingJson(float distanceCm, const String& isoTimestamp) {
  StaticJsonDocument<256> doc;
  doc["binId"] = BIN_ID;
  doc["distanceCm"] = roundf(distanceCm * 100.0f) / 100.0f;
  if (isoTimestamp.length() > 0) {
    doc["timestamp"] = isoTimestamp;
  }
  String output;
  serializeJson(doc, output);
  return output;
}

// ==================== ARDUINO LIFECYCLE ====================
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  LittleFS.begin(true);

  configValid = validateConfiguration();
  if (!configValid) {
    Serial.println("Halting telemetry until firmware configuration placeholders are replaced.");
    return;
  }

  if (connectWifi()) {
    setupTime();
    flushOfflineQueue();
  }
}

void loop() {
  if (!configValid) {
    delay(10000);
    return;
  }

  float distanceCm = measureCalibratedMedianDistanceCm();

  if (distanceCm < 0.0f) {
    Serial.println("Invalid or unstable ultrasonic reading; skipping upload this cycle.");
  } else {
    Serial.printf("Calibrated median distance: %.2f cm\n", distanceCm);
    String ts = getIsoTimestamp();
    String payload = buildReadingJson(distanceCm, ts);

    if (connectWifi()) {
      if (ts.length() == 0) {
        setupTime();
      }
      flushOfflineQueue();
      if (!postPayload(payload)) {
        enqueueReading(payload);
      }
    } else {
      enqueueReading(payload);
    }
  }

  Serial.printf("Sleeping %lu seconds until next reading...\n", readingIntervalSeconds);
  delay(readingIntervalSeconds * 1000UL);
}
