package com.verdantroute.dto;

import java.util.List;

public final class NotificationDtos {
    private NotificationDtos() {}

    public record NotificationDto(
            Long id,
            String type,
            String message,
            Long relatedTaskId,
            boolean read,
            String createdAt
    ) {}

    public record NotificationListResponse(
            List<NotificationDto> notifications
    ) {}

    public record NotificationEventPayload(
            String type,
            Long relatedTaskId,
            String message
    ) {}
}
