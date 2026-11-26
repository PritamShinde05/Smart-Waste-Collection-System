# VerdantRoute — Smart Waste Collection System

An end-to-end fill-level-based waste collection platform for municipal zones, replacing fixed schedules with ultrasonic IoT bin telemetry, live mapping, OSRM road-based route optimization, real-time WebSocket updates, and mobile-first employee navigation.

---

## Repository Structure

```text
├── src/                  # React + TypeScript + Tailwind CSS frontend (19 screens, PWA)
├── backend/              # OFFICIAL Production Backend: Java 17 + Spring Boot 3.4 + MySQL
│   ├── pom.xml
│   ├── .env.example
│   ├── scripts/          # Automated MySQL backup scripts (backup_mysql.sh / .bat)
│   └── src/main/
│       ├── resources/
│       │   ├── application.properties
│       │   └── schema.sql
│       └── java/com/verdantroute/...
├── server.ts             # AI Studio cloud-sandbox preview runtime only (port 3000)
├── server/               # SQLite preview adapter mirroring Spring Boot contracts for sandbox preview
├── docker-compose.yml    # Persistent MySQL 8 volume + optional self-hosted OSRM container
└── hardware/             # ESP32 + HC-SR04 TLS firmware, wiring guide, and API integration guide
```

---

## Official Backend & Runtime Modes

### 1. Official Production Backend (Java Spring Boot + MySQL `smart_waste_db`)
**Java Spring Boot + MySQL (`/backend/`) is the official production backend** for VerdantRoute.

#### Security Prerequisites
- Never store passwords or JWT secrets in `application.properties`, `README.md`, or `.env.local` in git.
- Generate a random 256-bit+ `JWT_SECRET` (at least 32 characters), e.g.:
  ```bash
  openssl rand -base64 48
  ```
- If any local MySQL password or key was ever committed or shared, rotate it immediately in MySQL (`ALTER USER ... IDENTIFIED BY ...`).

#### Persistent MySQL 8 via Docker Compose (Recommended)
Start a persistent MySQL 8 container backed by the named `mysql_data` volume:
```bash
cp backend/.env.example .env
# Edit .env with a strong MYSQL_ROOT_PASSWORD / DB_PASSWORD and 32+ char JWT_SECRET
docker compose up -d mysql
```
To also run a self-hosted OSRM road-routing server locally instead of relying on `router.project-osrm.org`:
```bash
# Prepare your regional .osrm graph files inside ./osrm-data first, then:
docker compose --profile self-hosted-osrm up -d
# Set OSRM_BASE_URL=http://localhost:5000 before starting Spring Boot
```

#### Local MySQL Setup (Without Docker)
Ensure MySQL 8+ is running locally, then create the database:
```sql
CREATE DATABASE IF NOT EXISTS smart_waste_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Provide database, JWT, and OSRM settings strictly via environment variables:

**Windows CMD:**
```cmd
set DB_HOST=localhost
set DB_PORT=3306
set DB_NAME=smart_waste_db
set DB_USERNAME=root
set DB_PASSWORD=<YOUR_MYSQL_PASSWORD>
set JWT_SECRET=<YOUR_32_PLUS_CHAR_RANDOM_SECRET>
set OSRM_BASE_URL=https://router.project-osrm.org
set OSRM_MAX_WAYPOINTS=50
set OSRM_TIMEOUT_SECONDS=12
```

**macOS / Linux:**
```bash
export DB_HOST=localhost
export DB_PORT=3306
export DB_NAME=smart_waste_db
export DB_USERNAME=root
export DB_PASSWORD='<YOUR_MYSQL_PASSWORD>'
export JWT_SECRET='<YOUR_32_PLUS_CHAR_RANDOM_SECRET>'
export OSRM_BASE_URL='https://router.project-osrm.org'
export OSRM_MAX_WAYPOINTS=50
export OSRM_TIMEOUT_SECONDS=12
```

#### Run the Official Spring Boot Server
```bash
cd backend
mvn test
mvn spring-boot:run
```
Spring Boot listens on `http://localhost:8080` and initializes/updates the MySQL schema (`areas`, `users`, `sensors`, `sensor_readings`, `tasks`, `task_bins`, `notifications`).

#### Connect the React Frontend to Spring Boot Locally
Create an untracked `.env.local` in the project root:
```env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=ws://localhost:8080/ws
```
Then run the Vite frontend against Spring Boot:
```bash
npm install
npm run dev:java-frontend
```

#### Database Backups & Restore Verification
Automated `mysqldump` scripts are included in `/backend/scripts/`:
- **Linux/macOS**: `DB_PASSWORD='<YOUR_MYSQL_PASSWORD>' ./backend/scripts/backup_mysql.sh ./backups` (retains 14 days of `.sql.gz` backups)
- **Windows**: `set DB_PASSWORD=<YOUR_MYSQL_PASSWORD> && backend\scripts\backup_mysql.bat backups`

Verify backups regularly by restoring into a scratch verification schema:
```bash
gunzip -c backups/smart_waste_db_YYYYMMDD_HHMMSS.sql.gz | mysql -u root -p smart_waste_db_restore_test
```

---

### 2. Cloud Sandbox Preview Mode (`server.ts`)
Inside environments without Java/Maven/MySQL, `npm run dev` runs `server.ts` on port `3000` (Express + WebSocket `/ws` + SQLite preview storage at `data/smart_waste.db`) solely to keep live UI preview and automated sandbox verification operational. Use `/backend` for all real deployments.

---

## Implemented Screens & Features

### Public Screens (`C1–C3`)
- **C1 Landing Page**: Platform overview, live architecture highlights, Admin registration CTA, and Sign In CTA.
- **C2 Admin Register**: Single atomic transaction creating both the Municipal Area (with optional Depot Map Pin) and the Admin account.
- **C3 Login**: Unified login supporting Email or Mobile + Password with show/hide toggle and deactivated-employee protection.

### Admin Screens (`A1–A11`)
- **A1 Dashboard**: 8 summary stat cards, Employee/Bin filters, 6 interactive Recharts charts (Area fill, status donut, collection trend, tasks by status, employee workload, hourly activity), click-through drill-down, and real-time WebSocket refresh.
- **A2 Live Map**: Full-screen Leaflet + MarkerCluster map with status-colored markers + fill percentages, in-place marker updates, status filters, and slide-up bottom sheet.
- **A3 Sensors List**: Search, status/active filters, sortable rows, and quick access to bin detail or add sensor.
- **A4 Add Sensor**: Interactive map picker + "Use My Location", bin height/interval/threshold settings, and one-time Device Key display + ESP32 integration steps.
- **A5 Bin Detail**: Fill level gauge, Day/Week/Month telemetry charts, collection history, inline map pin relocation, settings update, active toggle, one-time device key regeneration, delete confirmation, and separated QA hardware simulator.
- **A6 Tasks List**: Pending / Accepted / Completed / All tabs with real-time progress and cancel support.
- **A7 Create Task**: Multi-bin selector (prioritizing Full bins), employee selector showing open task count, Start Point choice (**Depot / Area Centre** or **Employee's Last GPS**), optional **Include return trip to start point**, live **OSRM road-network route optimization** (Multi-start Nearest Neighbor + 2-opt + Or-opt tour optimization with max waypoint guard and timeout handling), distance/time estimate, and assignment note.
- **A8 Task Detail**: Status timeline, ordered stops with live collected ticks, saved OSRM route map, round-trip indicator, cancel, and re-optimize option.
- **A9 & A10 Employees**: Employee directory, active/deactivate toggle, password reset modal, task history view, and create/edit forms.
- **A11 Profile & Area Settings**: Depot pin editor, default reading interval, Medium/Full thresholds with automatic area-wide status recalculation, password change, and sign out.

### Employee Screens (`E1–E5`) — Mobile-First One-Handed UX
- **E1 My Tasks**: New / Accepted / Completed tabs with unread badge counts, sound/vibration alerts on new assignments, and 3-tab bottom bar (`My Tasks`, `Active Route`, `Profile`).
- **E2 Task Detail**: Ordered stop list, saved road route preview, **Accept Task** / **Open Route Navigation** actions.
- **E3 Route Navigation**: Full-screen road route map with live device GPS tracking, auto-advance next-stop bottom sheet, **Mark Bin Collected** (with instant Admin WebSocket sync), and **Open in External Maps** (Google Maps / Apple Maps).
- **E4 Complete Task**: Stop verification summary, optional completion note, and task completion action.
- **E5 Employee Profile**: Account summary, completed task total, past history, password change, and logout.

---

## Core System Rules & Calculations

- **Fill Percentage**: `clamp(((binHeightCm - distanceCm) / binHeightCm) * 100, 0, 100)`
- **Range Validation**: Negative readings or `distanceCm > binHeightCm` are rejected (`400 Bad Request`).
- **Sensor Statuses**:
  - `OFFLINE`: Inactive sensor OR `now - lastSeenAt > 2 * intervalSeconds` (monitored by a background scheduler every 20 seconds).
  - `FULL`: `fillPercent >= sensor.fullThreshold`
  - `MEDIUM`: `fillPercent >= area.mediumThreshold`
  - `NORMAL`: `fillPercent < area.mediumThreshold`
- **Route Optimization**: Uses road-network durations and GeoJSON polylines from `OSRM_BASE_URL` (configurable for self-hosted OSRM) with Multi-Start Nearest Neighbor + 2-opt + Or-opt, max waypoint protection (`OSRM_MAX_WAYPOINTS=50`), request timeouts, and optional `returnToDepot` round-trip support.

---

## Hardware Quickstart

See `/hardware/WIRING_GUIDE.md`, `/hardware/API_INTEGRATION_GUIDE.md`, and `/hardware/smart_bin_esp32.ino` to connect an **ESP32 + HC-SR04** ultrasonic sensor to `/api/device/reading` with verified Root CA TLS (`setCACert`), 9-sample burst outlier filtering, `SENSOR_MOUNT_OFFSET_CM` calibration, and LittleFS offline recovery.
