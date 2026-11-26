package com.verdantroute.controller;

import com.verdantroute.dto.AreaAndBackupDtos.*;
import com.verdantroute.service.BackupService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/backups")
@PreAuthorize("hasRole('ADMIN')")
public class BackupController {
    private final BackupService backupService;

    public BackupController(BackupService backupService) {
        this.backupService = backupService;
    }

    @GetMapping
    public BackupListResponse listBackups() {
        return new BackupListResponse(backupService.listBackups());
    }

    @PostMapping
    public ResponseEntity<BackupTriggerResponse> triggerBackup() {
        return ResponseEntity.status(HttpStatus.CREATED).body(backupService.triggerBackup());
    }
}
