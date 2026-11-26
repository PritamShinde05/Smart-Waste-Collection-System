# VerdantRoute — Windows Setup & API Reference (Java 17 + Spring Boot 3.4 + MySQL 8)

This guide covers setting up, running, testing, backing up, and connecting the **official Java Spring Boot + MySQL 8 production backend** (`/backend`) on Windows 10/11 (and macOS/Linux/Docker), along with the complete REST & WebSocket API specification.

---

## 1. Prerequisites on Windows 10/11

1. **Java 17 (Temurin / Adoptium JDK 17)**
   - Download & install Eclipse Temurin JDK 17 MSI (enable *Add to PATH* and *Set JAVA_HOME*).
   - Verify in Command Prompt:
     ```cmd
     java -version
     ```
2. **Apache Maven 3.9+**
   - Extract Maven to `C:\tools\apache-maven-3.9.x`, add `C:\tools\apache-maven-3.9.x\bin` to `PATH`.
   - Verify:
     ```cmd
     mvn -version
     ```
3. **MySQL 8.0+ Community Server & Client (`mysql`, `mysqldump`)**
   - Install MySQL Server 8.0+ and ensure `C:\Program Files\MySQL\MySQL Server 8.0\bin` is in `PATH` (required for CLI restore and `BackupService` / `backup_mysql.bat`).
4. **Node.js 20+ (for the React + Vite frontend)**
   - Verify with `node -v` and `npm -v`.

---

## 2. Create the MySQL 8 Database

Open MySQL Shell / Workbench / Command Line Client as `root` and create the database:

```sql
CREATE DATABASE IF NOT EXISTS smart_waste_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

> **Schema Management**: Spring Boot uses **Flyway** (`classpath:db/migration/V1__init_schema.sql`) together with `spring.jpa.hibernate.ddl-auto=validate`. On startup, Flyway creates all 7 core tables (`areas`, `users`, `sensors`, `sensor_readings`, `tasks`, `task_bins`, `notifications`) and Hibernate validates every column and index.

---

## 3. Configure Environment Variables (Windows CMD)

Never hardcode database credentials or JWT secrets in source files. Generate a random 256-bit+ `JWT_SECRET` (at least 32 characters) and configure environment variables before starting the backend:

```cmd
set DB_HOST=localhost
set DB_PORT=3306
set DB_NAME=smart_waste_db
set DB_USERNAME=root
set DB_PASSWORD=<YOUR_MYSQL_PASSWORD>

set JWT_SECRET=<YOUR_32_PLUS_CHAR_RANDOM_SECRET>
set JWT_EXPIRATION_MS=86400000

set CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
set OSRM_BASE_URL=https://router.project-osrm.org
set OSRM_MAX_WAYPOINTS=50
set OSRM_TIMEOUT_SECONDS=12

set DB_BACKUP_DIR=.\backups
set DB_BACKUP_RETENTION_COUNT=14
```

### Generate a Strong `JWT_SECRET` in PowerShell
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

---

## 4. Build, Test, and Run the Spring Boot Backend

From the `/backend` folder:

```cmd
cd backend
mvn clean test
mvn spring-boot:run
```

### Optional: Run Live MySQL + Flyway Integration Test
To run `MySqlFlywayIntegrationTest` against a dedicated MySQL test schema:

```sql
CREATE DATABASE IF NOT EXISTS smart_waste_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

```cmd
set MYSQL_TEST_ENABLED=true
set TEST_DB_URL=jdbc:mysql://localhost:3306/smart_waste_test?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC
set TEST_DB_USERNAME=root
set TEST_DB_PASSWORD=<YOUR_MYSQL_PASSWORD>
mvn test -Dtest=MySqlFlywayIntegrationTest
```

Once started, verify health:
```cmd
curl http://localhost:8080/api/health
```
Expected response:
```json
{"status":"ok","backend":"spring-boot-mysql"}
```

---

## 5. Connect the React Frontend to Spring Boot

In the **repository root** (next to `package.json`), create an untracked `.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_BASE_URL=ws://localhost:8080/ws
```

Start the frontend against Spring Boot:

```cmd
npm install
npm run dev:java-frontend
```

Open `http://localhost:3000` in your browser. All API calls target `http://localhost:8080/api/...` and real-time updates connect to `ws://localhost:8080/ws?token=<JWT>`.

---

## 6. ESP32 Hardware Setup Quickstart

1. Register an Admin account and create a sensor bin in the UI (or via `POST /api/sensors`) to obtain the one-time **Device Key** (`vr_<sensorId>_...`).
2. Update `/hardware/smart_bin_esp32.ino` with your Wi-Fi credentials, `BIN_ID`, `DEVICE_KEY`, `API_URL` (`https://<your-domain>/api/device/reading`), and the server's **Root CA PEM certificate** (`ROOT_CA_PEM` via `secureClient.setCACert(ROOT_CA_PEM)`).
3. Flash the firmware to your ESP32 + HC-SR04 board. See `/hardware/API_INTEGRATION_GUIDE.md` and `/hardware/WIRING_GUIDE.md` for wiring diagrams and sensor offset calibration.

---

## 7. MySQL Backup & Restore Verification (Windows)

### Automated CLI Backup
```cmd
set DB_PASSWORD=<YOUR_MYSQL_PASSWORD>
backend\scripts\backup_mysql.bat backups
```
Creates a timestamped `.sql` dump in `backups\`, verifies its SQL header, and prunes older files beyond `DB_BACKUP_RETENTION_COUNT`.

### Automated Restore Verification
```cmd
set DB_PASSWORD=<YOUR_MYSQL_PASSWORD>
backend\scripts\restore_mysql.bat backups\smart_waste_db_YYYYMMDD_HHMMSS.sql smart_waste_db_restore_test
```
Imports the dump into a temporary schema (`smart_waste_db_restore_test`) and lists the restored tables to confirm backup integrity without touching production data.

### Admin REST Backup Endpoints
- `GET /api/admin/backups` — Lists backup files with size, timestamp, and header verification status.
- `POST /api/admin/backups` — Triggers an on-demand `mysqldump` compressed `.sql.gz` snapshot (requires `mysqldump` on server `PATH` and `DB_PASSWORD` configured).

---

## 8. Postman Collection

Import `/backend/postman/VerdantRoute_API.postman_collection.json` into Postman.
- Set `baseUrl` to `http://localhost:8080`.
- Run **02. Authentication -> Register Admin & Municipal Area** or **Login**; the test script automatically saves the JWT into `{{token}}`.
- Run **Create Sensor** and **Create Employee** to automatically populate `{{sensorId}}`, `{{binId}}`, `{{deviceKey}}`, and `{{employeeId}}`.

---

## 9. Complete REST & WebSocket API Reference

### Authentication & Profile
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Public | Health check (`{"status":"ok","backend":"spring-boot-mysql"}`) |
| `POST` | `/api/auth/register-admin` | Public | Atomically creates municipal `Area` + `ADMIN` user; returns JWT + HttpOnly cookie |
| `POST` | `/api/auth/login` | Public | Login by email or mobile + password; rejects `INACTIVE` accounts with `403` |
| `POST` | `/api/auth/logout` | Public | Clears HttpOnly session cookie |
| `GET` | `/api/auth/me` | Authenticated | Returns current user + area profile |
| `POST` | `/api/auth/change-password` | Authenticated | Updates password after verifying current BCrypt hash |

### Municipal Area & Backups
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/area` | Authenticated | Get municipal area & thresholds |
| `PUT` | `/api/area` | `ADMIN` | Update area depot coordinates, interval, and Medium/Full thresholds (recomputes bin statuses + broadcasts WS) |
| `GET` | `/api/admin/backups` | `ADMIN` | List backup archives and header verification status |
| `POST` | `/api/admin/backups` | `ADMIN` | Run verified `mysqldump` `.sql.gz` snapshot |

### Sensors & IoT Telemetry
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/sensors?search=&status=` | `ADMIN` | List sensors in area with auto-recomputed `OFFLINE` status |
| `POST` | `/api/sensors` | `ADMIN` | Register bin; returns one-time plaintext `deviceKey` (`BCrypt` stored in DB) |
| `GET` | `/api/sensors/{id}?range=day\|week\|month` | `ADMIN` | Sensor metadata + reading telemetry series + collection history |
| `PUT` | `/api/sensors/{id}` | `ADMIN` | Update bin configuration, coordinates, thresholds, or active flag |
| `POST` | `/api/sensors/{id}/regenerate-key` | `ADMIN` | Rotate device key (one-time return) |
| `POST` | `/api/sensors/{id}/simulate-reading` | `ADMIN` | Admin QA reading simulation |
| `DELETE` | `/api/sensors/{id}` | `ADMIN` | Delete sensor and cascade readings |
| `POST` | `/api/device/reading` | Device Key | ESP32 telemetry ingestion via `X-Device-Key` header (or body `deviceKey`) |

### Dashboard Analytics (`ADMIN`)
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/dashboard/summary` | `ADMIN` | Summary stat cards, status/task splits, bins sorted by fill |
| `GET` | `/api/dashboard/fill-trends?sensorId=&days=7` | `ADMIN` | Time-series fill readings |
| `GET` | `/api/dashboard/collections?days=14` | `ADMIN` | Daily collected-bin counts |
| `GET` | `/api/dashboard/employee-stats?days=30` | `ADMIN` | Employee completed & open task counts |

### Employees (`ADMIN`)
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/employees` | `ADMIN` | List employees with open/completed counts and last GPS |
| `POST` | `/api/employees` | `ADMIN` | Create employee account |
| `PUT` | `/api/employees/{id}` | `ADMIN` | Update employee details |
| `PATCH` | `/api/employees/{id}/status` | `ADMIN` | Activate / deactivate employee (`ACTIVE` / `INACTIVE`) |
| `PATCH` | `/api/employees/{id}/reset-password` | `ADMIN` | Reset employee password |
| `GET` | `/api/employees/{id}/history` | `ADMIN` | Employee task assignment history |

### Route Optimization & Tasks
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/api/routes/preview` | `ADMIN` | Preview road-network OSRM route (`DEPOT` or `EMPLOYEE_GPS`, optional `returnToDepot`) |
| `POST` | `/api/tasks` | `ADMIN` | Create task, persist ordered `task_bins`, save notification, broadcast WS |
| `GET` | `/api/tasks?status=&employeeId=` | `ADMIN` | List tasks in area |
| `GET` | `/api/tasks/{id}` | `ADMIN` | Task detail with ordered stops and GeoJSON polyline |
| `PATCH` | `/api/tasks/{id}/cancel` | `ADMIN` | Cancel pending/accepted task |
| `POST` | `/api/tasks/{id}/reoptimize` | `ADMIN` | Recalculate OSRM tour for uncollected stops |
| `GET` | `/api/employee/tasks?status=` | `EMPLOYEE` | List tasks assigned to authenticated employee |
| `GET` | `/api/employee/tasks/{id}` | `EMPLOYEE` | View assigned task detail |
| `PATCH` | `/api/employee/tasks/{id}/accept` | `EMPLOYEE` | Accept `ASSIGNED` task |
| `PATCH` | `/api/employee/tasks/{id}/bins/{taskBinId}/collect` | `EMPLOYEE` | Mark bin collected, reset bin fill to `0%`, update sensor reading |
| `PATCH` | `/api/employee/tasks/{id}/complete` | `EMPLOYEE` | Complete task once all stops are collected |
| `PATCH` | `/api/employee/location` | `EMPLOYEE` | Update live employee GPS coordinates + broadcast to area admins |

### Notifications
| Method | Path | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/api/notifications` | Authenticated | List latest 30 notifications for current user |
| `PATCH` | `/api/notifications/{id}/read` | Authenticated | Mark one notification as read |
| `PATCH` | `/api/notifications/read-all` | Authenticated | Mark all notifications as read |

### WebSocket Real-Time Events (`/ws`)
- Endpoint: `ws://localhost:8080/ws?token=<JWT>` (also reads HttpOnly `vr_token` cookie on browser upgrade).
- Events emitted:
  - `sensor:reading` / `sensor:updated` (to area Admins)
  - `area:updated` (to area Admins)
  - `employee:location` (to area Admins)
  - `task:assigned` (to assigned Employee + area Admins)
  - `task:updated` / `task:bin_collected` / `task:completed` / `task:cancelled` (to assigned Employee + area Admins)
  - `notification:new` (to target User)
