package com.verdantroute.service;

import com.verdantroute.dto.AreaAndBackupDtos.*;
import com.verdantroute.exception.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

@Service
public class BackupService {
    private static final DateTimeFormatter STAMP_FMT =
            DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss'Z'").withZone(ZoneOffset.UTC);

    private final Path backupDir;
    private final int retentionCount;
    private final String dbHost;
    private final String dbPort;
    private final String dbName;
    private final String dbUsername;
    private final String dbPassword;

    public BackupService(
            @Value("${app.backup.dir:./backups}") String backupDir,
            @Value("${app.backup.retention-count:14}") int retentionCount,
            @Value("${app.backup.db-host:localhost}") String dbHost,
            @Value("${app.backup.db-port:3306}") String dbPort,
            @Value("${app.backup.db-name:smart_waste_db}") String dbName,
            @Value("${app.backup.db-username:root}") String dbUsername,
            @Value("${app.backup.db-password:}") String dbPassword) {
        this.backupDir = Path.of(backupDir).toAbsolutePath().normalize();
        this.retentionCount = Math.max(1, Math.min(100, retentionCount));
        this.dbHost = dbHost;
        this.dbPort = dbPort;
        this.dbName = dbName;
        this.dbUsername = dbUsername;
        this.dbPassword = dbPassword != null ? dbPassword : "";
    }

    public List<BackupMetadataDto> listBackups() {
        ensureBackupDir();
        List<BackupMetadataDto> list = new ArrayList<>();
        try (var stream = Files.list(backupDir)) {
            List<Path> files = stream
                    .filter(Files::isRegularFile)
                    .filter(p -> {
                        String name = p.getFileName().toString();
                        return name.startsWith(dbName + "_") && (name.endsWith(".sql.gz") || name.endsWith(".sql"));
                    })
                    .sorted(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed())
                    .toList();

            for (Path p : files) {
                long size = Files.size(p);
                Instant mtime = Files.getLastModifiedTime(p).toInstant();
                list.add(new BackupMetadataDto(
                        p.getFileName().toString(),
                        size,
                        mtime.toString(),
                        verifyDumpFile(p)
                ));
            }
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Unable to read backup directory.");
        }
        return list;
    }

    public BackupTriggerResponse triggerBackup() {
        if (dbPassword.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST,
                    "DB_PASSWORD environment variable must be configured to run MySQL backups.");
        }
        ensureBackupDir();
        String filename = dbName + "_" + STAMP_FMT.format(Instant.now()) + ".sql.gz";
        Path target = backupDir.resolve(filename).normalize();
        if (!target.startsWith(backupDir + File.separator)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid backup target path.");
        }

        ProcessBuilder pb = new ProcessBuilder(
                "mysqldump",
                "-h", dbHost,
                "-P", dbPort,
                "-u", dbUsername,
                "--single-transaction",
                "--routines",
                "--triggers",
                "--databases", dbName
        );
        pb.environment().put("MYSQL_PWD", dbPassword);

        Process proc;
        try {
            proc = pb.start();
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                    "mysqldump client is not installed on the application server.", true);
        }

        try (InputStream dumpOut = proc.getInputStream();
             OutputStream fos = Files.newOutputStream(target);
             GZIPOutputStream gzos = new GZIPOutputStream(fos)) {
            dumpOut.transferTo(gzos);
            gzos.finish();
            int exitCode = proc.waitFor();
            if (exitCode != 0) {
                Files.deleteIfExists(target);
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "MySQL backup failed with exit code " + exitCode + ".");
            }
        } catch (ApiException ex) {
            throw ex;
        } catch (Exception ex) {
            try {
                Files.deleteIfExists(target);
            } catch (IOException ignored) {}
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "MySQL backup failed.");
        }

        if (!verifyDumpFile(target)) {
            try {
                Files.deleteIfExists(target);
            } catch (IOException ignored) {}
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Backup verification failed.");
        }

        pruneOldBackups();
        try {
            BackupMetadataDto created = new BackupMetadataDto(
                    filename,
                    Files.size(target),
                    Files.getLastModifiedTime(target).toInstant().toString(),
                    true
            );
            return new BackupTriggerResponse(created, listBackups());
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Backup created but metadata read failed.");
        }
    }

    private void ensureBackupDir() {
        try {
            Files.createDirectories(backupDir);
        } catch (IOException ex) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to initialize backup directory.");
        }
    }

    private boolean verifyDumpFile(Path file) {
        try {
            if (Files.size(file) < 32) return false;
            boolean gzip = file.getFileName().toString().endsWith(".gz");
            try (InputStream raw = Files.newInputStream(file);
                 InputStream in = gzip ? new GZIPInputStream(raw) : raw;
                 BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                for (int i = 0; i < 15; i++) {
                    String line = reader.readLine();
                    if (line == null) break;
                    if (line.contains("MySQL") || line.contains("CREATE DATABASE") || line.contains("CREATE TABLE")) {
                        return true;
                    }
                }
            }
            return false;
        } catch (IOException ex) {
            return false;
        }
    }

    private void pruneOldBackups() {
        try (var stream = Files.list(backupDir)) {
            List<Path> files = stream
                    .filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().startsWith(dbName + "_"))
                    .sorted(Comparator.comparing((Path p) -> p.getFileName().toString()).reversed())
                    .toList();
            for (int i = retentionCount; i < files.size(); i++) {
                Files.deleteIfExists(files.get(i));
            }
        } catch (IOException ignored) {}
    }
}
