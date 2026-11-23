/*
 * VerdantRoute — ESP32 + HC-SR04 Smart Waste Bin Sensor Firmware
 *
 * Features:
 *  - Multi-sample median filtering on HC-SR04 ultrasonic readings
 *  - NTP UTC time synchronization for accurate reading timestamps
 *  - HTTP/HTTPS POST to /api/device/reading with Bin ID + Device Key authentication
 *  - Dynamic interval updates returned by the server (readingIntervalSeconds)
 *  - LittleFS offline queue: stores failed readings with timestamps and retries when online
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <time.h>

// ==================== CONFIGURATION ====================
// Replace these placeholders before flashing to your ESP32
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Base URL of your VerdantRoute backend (Spring Boot or Node preview)
// Example: "http://192.168.1.50:8080" or "https://your-domain.example"
const char* SERVER_BASE_URL = "http://192.168.1.50:8080";

// Provisioned in VerdantRoute Admin -> Sensors -> Add Sensor
const char* BIN_ID     = "BIN-101";
const char* DEVICE_KEY = "PASTE_YOUR_ONE_TIME_DEVICE_KEY_HERE";

// HC-SR04 GPIO Pins (use 1k/2k voltage divider on ECHO -> 3.3V safe!)
const int TRIG_PIN = 5;
const int ECHO_PIN = 18;

// Sampling & queue tuning
const int SAMPLES_PER_READING = 7;
const unsigned long SAMPLE_DELAY_MS = 60;
const char* QUEUE_FILE = "/offline_readings.jsonl";
const size_t MAX_QUEUED_READINGS = 120;

// Default reading interval (overridden dynamically by server response)
unsigned long readingIntervalSeconds = 900; // 15 minutes default

// ==================== HELPERS ====================
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
  Serial.println(now >= 1700000000 ? " synced." : " failed (will use fallback if needed).");
}

String getIsoTimestamp() {
  time_t now = time(nullptr);
  if (now < 1700000000) {
    return ""; // Let server assign receive time if NTP not yet synced
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

  // Timeout 35ms (~600 cm max range)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 35000UL);
  if (duration == 0) {
    return -1.0f;
  }
  return (duration * 0.0343f) / 2.0f;
}

float measureMedianDistanceCm() {
  float valid[SAMPLES_PER_READING];
  int count = 0;

  for (int i = 0; i < SAMPLES_PER_READING; i++) {
    float d = measureSingleDistanceCm();
    if (d >= 2.0f && d <= 450.0f) {
      valid[count++] = d;
    }
    delay(SAMPLE_DELAY_MS);
  }

  if (count == 0) {
    return -1.0f;
  }

  // Insertion sort for median selection
  for (int i = 1; i < count; i++) {
    float key = valid[i];
    int j = i - 1;
    while (j >= 0 && valid[j] > key) {
      valid[j + 1] = valid[j];
      j--;
    }
    valid[j + 1] = key;
  }

  return valid[count / 2];
}

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
    // For production HTTPS, call secureClient.setCACert(ROOT_CA_PEM) instead of setInsecure()
    secureClient.setInsecure();
    started = http.begin(secureClient, endpoint);
  } else {
    started = http.begin(plainClient, endpoint);
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
        if (nextInterval >= 10 && nextInterval <= 86400) {
          readingIntervalSeconds = nextInterval;
          Serial.printf("Updated reading interval: %lu s\n", readingIntervalSeconds);
        }
      }
    }
    return true;
  }

  // Do not re-queue permanently rejected payloads (400 out-of-range, 401 bad key, 403 deactivated)
  if (statusCode == 400 || statusCode == 401 || statusCode == 403) {
    Serial.println("Server rejected reading permanently; dropping this entry.");
    return true;
  }

  return false;
}

void enqueueReading(const String& jsonLine) {
  if (!LittleFS.begin(true)) {
    return;
  }

  // Count existing lines to prevent unbounded flash wear
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
    Serial.println("Offline queue full; skipping enqueue.");
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
  doc["deviceKey"] = DEVICE_KEY;
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

  if (connectWifi()) {
    setupTime();
    flushOfflineQueue();
  }
}

void loop() {
  float distanceCm = measureMedianDistanceCm();

  if (distanceCm < 0.0f) {
    Serial.println("Ultrasonic sensor read error (no echo). Retrying next cycle.");
  } else {
    Serial.printf("Measured median distance: %.2f cm\n", distanceCm);
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
