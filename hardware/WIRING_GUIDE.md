# ESP32 + HC-SR04 Ultrasonic Sensor Wiring Guide

This guide explains how to connect the **HC-SR04 ultrasonic distance sensor** safely to an **ESP32 development board** and mount it inside a waste bin lid.

---

## 1. Components Required

| Component | Quantity | Purpose |
| --- | --- | --- |
| ESP32 DevKit v1 (Wi-Fi) | 1 | Reads distance & posts telemetry to VerdantRoute |
| HC-SR04 Ultrasonic Sensor | 1 | Measures distance from bin lid to waste top |
| 1 kΩ Resistor | 1 | Voltage divider upper resistor (protects ESP32 GPIO) |
| 2 kΩ Resistor (or two 1 kΩ in series) | 1 | Voltage divider lower resistor (pulls 5V ECHO to ~3.3V) |
| Breadboard & Jumper Wires | 1 set | Connections |
| 5V USB Power Supply / Power Bank | 1 | Powers ESP32 VIN and HC-SR04 VCC |

---

## 2. Electrical Safety Warning (5V ECHO vs. 3.3V GPIO)

The HC-SR04 operates at **5V** and drives its `ECHO` pin at **5V**, whereas ESP32 GPIO pins are **3.3V tolerant only**. Connecting `ECHO` directly to an ESP32 pin can permanently damage the microcontroller.

Use a simple **1 kΩ / 2 kΩ resistive voltage divider** on `ECHO`:

```text
HC-SR04 ECHO (5V) ──[ 1 kΩ ]──┬──> ESP32 GPIO 18 (~3.33V)
                              │
                           [ 2 kΩ ]
                              │
                             GND
```

`V_out = 5V × (2 kΩ / (1 kΩ + 2 kΩ)) = 3.33V` (safe for ESP32).

---

## 3. Pinout Table

| HC-SR04 Pin | Connection |
| --- | --- |
| **VCC** | ESP32 **VIN / 5V** pin |
| **GND** | ESP32 **GND** |
| **TRIG** | ESP32 **GPIO 5** (direct — ESP32 3.3V output triggers HC-SR04 cleanly) |
| **ECHO** | Through **1 kΩ / 2 kΩ voltage divider** to ESP32 **GPIO 18** |

If you change `TRIG` or `ECHO` pins, update `TRIG_PIN` and `ECHO_PIN` at the top of `smart_bin_esp32.ino`.

---

## 4. Physical Mounting Inside the Bin

1. Mount the HC-SR04 under the center of the bin lid facing **straight down** into the container.
2. Measure the vertical distance from the sensor face to the **empty bottom** of the bin in centimeters — enter this exact value as **Bin Height (cm)** when creating the sensor in VerdantRoute (`A4: Add Sensor`).
3. Ensure no cables, hinges, or inner lip edges obstruct the ~15° ultrasonic cone.
4. Enclose the ESP32 in a splash-resistant junction box mounted outside or on the top side of the lid.

---

## 5. Arduino IDE Libraries Required

Install via **Arduino Library Manager** (`Sketch -> Include Library -> Manage Libraries`):
- **ArduinoJson** (v6 or v7) by Benoit Blanchon

Built-in ESP32 board libraries used (`esp32` board package v2.x / v3.x):
- `WiFi.h`
- `HTTPClient.h`
- `WiFiClientSecure.h`
- `LittleFS.h`
- `time.h`
