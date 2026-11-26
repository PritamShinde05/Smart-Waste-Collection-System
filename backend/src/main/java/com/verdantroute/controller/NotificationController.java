package com.verdantroute.controller;

import com.verdantroute.dto.AuthDtos.SimpleSuccessResponse;
import com.verdantroute.dto.NotificationDtos.NotificationListResponse;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.NotificationService;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {
    private final NotificationService notificationService;

    public NotificationController(NotificationService notificationService) {
        this.notificationService = notificationService;
    }

    @GetMapping
    public NotificationListResponse list(@AuthenticationPrincipal AuthPrincipal principal) {
        return notificationService.listNotifications(principal.userId());
    }

    @PatchMapping("/read-all")
    public SimpleSuccessResponse readAll(@AuthenticationPrincipal AuthPrincipal principal) {
        notificationService.markAllRead(principal.userId());
        return new SimpleSuccessResponse(true);
    }

    @PatchMapping("/{id}/read")
    public SimpleSuccessResponse readOne(
            @AuthenticationPrincipal AuthPrincipal principal,
            @PathVariable Long id) {
        notificationService.markOneRead(principal.userId(), id);
        return new SimpleSuccessResponse(true);
    }
}
