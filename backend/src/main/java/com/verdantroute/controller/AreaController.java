package com.verdantroute.controller;

import com.verdantroute.dto.AreaAndBackupDtos.UpdateAreaRequest;
import com.verdantroute.dto.AuthDtos.AreaDto;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.service.AreaService;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/area")
public class AreaController {
    private final AreaService areaService;

    public AreaController(AreaService areaService) {
        this.areaService = areaService;
    }

    @GetMapping
    public AreaDto getArea(@AuthenticationPrincipal AuthPrincipal principal) {
        return areaService.getArea(principal.areaId());
    }

    @PutMapping
    @PreAuthorize("hasRole('ADMIN')")
    public AreaDto updateArea(
            @AuthenticationPrincipal AuthPrincipal principal,
            @RequestBody UpdateAreaRequest body) {
        return areaService.updateArea(principal.areaId(), body);
    }
}
