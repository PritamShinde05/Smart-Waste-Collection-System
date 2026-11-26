CREATE TABLE IF NOT EXISTS areas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    city VARCHAR(120) NOT NULL,
    centre_lat DOUBLE NOT NULL,
    centre_lng DOUBLE NOT NULL,
    default_interval_seconds INT NOT NULL DEFAULT 900,
    medium_threshold INT NOT NULL DEFAULT 50,
    full_threshold INT NOT NULL DEFAULT 80,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    area_id BIGINT NOT NULL,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL UNIQUE,
    mobile VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    last_lat DOUBLE NULL,
    last_lng DOUBLE NULL,
    last_location_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_area (area_id),
    CONSTRAINT fk_users_area FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sensors (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    area_id BIGINT NOT NULL,
    bin_id VARCHAR(64) NOT NULL,
    label VARCHAR(180) NOT NULL,
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    bin_height_cm DOUBLE NOT NULL,
    interval_seconds INT NOT NULL DEFAULT 900,
    full_threshold INT NOT NULL DEFAULT 80,
    device_key_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_fill_percent DOUBLE NULL,
    last_distance_cm DOUBLE NULL,
    last_seen_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_sensors_area_bin (area_id, bin_id),
    INDEX idx_sensors_area (area_id),
    CONSTRAINT fk_sensors_area FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    sensor_id BIGINT NOT NULL,
    distance_cm DOUBLE NOT NULL,
    fill_percent DOUBLE NOT NULL,
    recorded_at TIMESTAMP NOT NULL,
    INDEX idx_readings_sensor_time (sensor_id, recorded_at),
    CONSTRAINT fk_readings_sensor FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    area_id BIGINT NOT NULL,
    created_by BIGINT NOT NULL,
    assigned_to BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED',
    start_type VARCHAR(40) NOT NULL DEFAULT 'DEPOT',
    start_lat DOUBLE NOT NULL,
    start_lng DOUBLE NOT NULL,
    return_to_depot BOOLEAN NOT NULL DEFAULT FALSE,
    route_geometry LONGTEXT NOT NULL,
    total_distance_meters DOUBLE NOT NULL DEFAULT 0,
    estimated_time_seconds DOUBLE NOT NULL DEFAULT 0,
    note TEXT NULL,
    completion_note TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    cancelled_at TIMESTAMP NULL,
    INDEX idx_tasks_area_status (area_id, status),
    INDEX idx_tasks_assigned (assigned_to, status),
    CONSTRAINT fk_tasks_area FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE,
    CONSTRAINT fk_tasks_creator FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT fk_tasks_assignee FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_bins (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    sensor_id BIGINT NOT NULL,
    stop_order INT NOT NULL,
    fill_at_assignment DOUBLE NULL,
    collected_at TIMESTAMP NULL,
    INDEX idx_task_bins_task (task_id, stop_order),
    CONSTRAINT fk_task_bins_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    CONSTRAINT fk_task_bins_sensor FOREIGN KEY (sensor_id) REFERENCES sensors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    related_task_id BIGINT NULL,
    read_flag BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_notifications_user (user_id, read_flag, created_at),
    CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
