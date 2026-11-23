# VerdantRoute — Smart Waste Collection System

An end-to-end fill-level-based waste collection platform for municipal zones, replacing fixed schedules with ultrasonic IoT bin telemetry, live mapping, OSRM road-based route optimization, real-time WebSocket updates, and mobile-first employee navigation.

---

## Repository Structure

```text
├── src/                  # React + TypeScript + Tailwind CSS frontend (19 screens, PWA)
├── server.ts             # Node/Express + WebSocket + Vite preview runtime (port 3000)
├── server/               # SQLite-backed preview API mirroring the Spring Boot contract
├── backend/              # Java Spring Boot + Spring Security + JWT + JPA + MySQL backend
│   ├── pom.xml
│   └── src/main/
│       ├── resources/
│       │   ├── application.properties
│       │   └── schema.sql
│       └── java/com/verdantroute/...
└── hardware/             # ESP32 + HC-SR04 firmware, wiring guide, and API integration guide
```

---

## Runtime Modes

### 1. Live Preview Runtime (Node.js + SQLite — Default on Port 3000)
Because Java, Maven, and MySQL are not installed inside the cloud sandbox container, `npm run dev` runs `server.ts` on port `3000` with:
- Express REST API + WebSocket (`/ws`)
- Built-in SQLite (`node:sqlite` stored at `data/smart_waste.db`) implementing the exact relational schema, foreign keys, transactions, BCrypt hashing, JWT authentication, role/area isolation, and live OSRM road routing.

### 2. Full Production Backend (Java Spring Boot + MySQL `smart_waste_db`)
Complete Java 17 + Spring Boot 3.4 + Maven + Spring Security + JWT + Spring Data JPA + Hibernate + WebSocket source code lives in `/backend/`.

#### MySQL Database Setup
Ensure MySQL 8+ is running locally, then create the database:

```sql
CREATE DATABASE IF NOT EXISTS smart_waste_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Set your credentials via environment variables (recommended) or edit `/backend/src/main/resources/application.properties`:

**Windows CMD:**
```cmd
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS smart_waste_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
set DB_HOST=localhost
set DB_PORT=3306
set DB_NAME=smart_waste_db
set DB_USERNAME=root
set DB_PASSWORD=-#Pritam05
set JWT_SECRET=replace-with-a-long-random-256-bit-secret-string
```

**macOS / Linux:**
```bash
export DB_HOST=localhost
export DB_PORT=3306
export DB_NAME=smart_waste_db
export DB_USERNAME=root
export DB_PASSWORD='-#Pritam05'
export JWT_SECRET='replace-with-a-long-random-256-bit-secret-string'
```

*(Never commit live database passwords or production JWT secrets into version control.)*

#### Run the Spring Boot Server

**Windows CMD:**
```cmd
cd backend
mvn spring-boot:run
```

**macOS / Linux:**
```bash
cd backend
mvn spring-boot:run
```

Spring Boot listens on `http://localhost:8080` and automatically initializes/updates the MySQL schema (`areas`, `users`, `sensors`, `sensor_readings`, `tasks`, `task_bins`, `notifications`).

#### Connect the React Frontend to Spring Boot Locally

Create a `.env.local` in the project root:

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=ws://localhost:8080/ws
```

Then start the Vite frontend dev server (Windows CMD or macOS/Linux):

```cmd
npm install
npx vite --port 3000
```

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
- **A7 Create Task**: Multi-bin selector (prioritizing Full bins), employee selector showing open task count, Start Point choice (**Depot / Area Centre** or **Employee's Last GPS**), live **OSRM road-network route optimization** (Nearest Neighbor + 2-opt tour improvement + actual road geometry), distance/time estimate, and assignment note.
- **A8 Task Detail**: Status timeline, ordered stops with live collected ticks, saved OSRM route map, cancel, and re-optimize option.
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
- **Route Optimization**: Uses real road-network durations and GeoJSON polylines from `router.project-osrm.org` (never straight-line Euclidean routes).

---

## Hardware Quickstart

See `/hardware/WIRING_GUIDE.md`, `/hardware/API_INTEGRATION_GUIDE.md`, and `/hardware/smart_bin_esp32.ino` to connect an **ESP32 + HC-SR04** ultrasonic sensor to `/api/device/reading`.
