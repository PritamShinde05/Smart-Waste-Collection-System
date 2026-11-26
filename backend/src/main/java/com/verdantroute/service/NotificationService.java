package com.verdantroute.service;

import com.verdantroute.dto.NotificationDtos.*;
import com.verdantroute.entity.Notification;
import com.verdantroute.repository.NotificationRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
public class NotificationService {
    private final NotificationRepository notificationRepository;

    public NotificationService(NotificationRepository notificationRepository) {
        this.notificationRepository = notificationRepository;
    }

    @Transactional(readOnly = true)
    public NotificationListResponse listNotifications(Long userId) {
        List<NotificationDto> list = notificationRepository.findTop30ByUserIdOrderByCreatedAtDesc(userId)
                .stream()
                .map(n -> new NotificationDto(
                        n.getId(),
                        n.getType(),
                        n.getMessage(),
                        n.getRelatedTaskId(),
                        Boolean.TRUE.equals(n.getReadFlag()),
                        n.getCreatedAt().toString()
                ))
                .toList();
        return new NotificationListResponse(list);
    }

    @Transactional
    public void markAllRead(Long userId) {
        List<Notification> unread = notificationRepository.findByUserIdAndReadFlagFalse(userId);
        unread.forEach(n -> n.setReadFlag(true));
        notificationRepository.saveAll(unread);
    }

    @Transactional
    public void markOneRead(Long userId, Long notificationId) {
        notificationRepository.findByIdAndUserId(notificationId, userId).ifPresent(n -> {
            n.setReadFlag(true);
            notificationRepository.save(n);
        });
    }
}
