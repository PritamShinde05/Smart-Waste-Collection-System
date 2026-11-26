package com.verdantroute.dto;

import java.util.List;

public final class AreaAndBackupDtos {
    private AreaAndBackupDtos() {}

    public record UpdateAreaRequest(
            String name,
            String city,
            Double centreLat,
            Double centreLng,
            Integer defaultIntervalSeconds,
            Integer mediumThreshold,
            Integer fullThreshold
    ) {}

    public record AreaUpdatedEvent(
            AuthDtos.AreaDto area,
            List<SensorAndDeviceDtos.SensorDto> sensors
    ) {}

    public record BackupMetadataDto(
            String filename,
            long sizeBytes,
            String createdAt,
            boolean verified
    ) {}

    public record BackupListResponse(
            List<BackupMetadataDto> backups
    ) {}

    public record BackupTriggerResponse(
            BackupMetadataDto backup,
            List<BackupMetadataDto> backups
    ) {}
}
