package com.verdantroute.controller;

import com.verdantroute.dto.NotificationDtos.NotificationListResponse;
import com.verdantroute.dto.SensorAndDeviceDtos.DeviceReadingResponse;
import com.verdantroute.dto.TaskAndRouteDtos.TaskListResponse;
import com.verdantroute.entity.User;
import com.verdantroute.repository.UserRepository;
import com.verdantroute.security.AuthPrincipal;
import com.verdantroute.security.JwtAuthenticationFilter;
import com.verdantroute.security.JwtService;
import com.verdantroute.security.SecurityConfig;
import com.verdantroute.service.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import java.util.List;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@WebMvcTest(controllers = {
        HealthController.class,
        AuthController.class,
        AreaController.class,
        DeviceController.class,
        BackupController.class,
        SensorController.class,
        EmployeeController.class,
        DashboardController.class,
        TaskAndRouteController.class,
        NotificationController.class
})
@Import({SecurityConfig.class, com.verdantroute.config.AppConfig.class, JwtAuthenticationFilter.class})
@ActiveProfiles("test")
class ControllerSecurityAndValidationTests {

    @Autowired private MockMvc mockMvc;

    @MockitoBean private JwtService jwtService;
    @MockitoBean private UserRepository userRepository;
    @MockitoBean private AuthService authService;
    @MockitoBean private AreaService areaService;
    @MockitoBean private SensorService sensorService;
    @MockitoBean private BackupService backupService;
    @MockitoBean private TaskService taskService;
    @MockitoBean private EmployeeService employeeService;
    @MockitoBean private DashboardService dashboardService;
    @MockitoBean private NotificationService notificationService;

    private UsernamePasswordAuthenticationToken adminAuth() {
        AuthPrincipal p = new AuthPrincipal(1L, 1L, User.Role.ADMIN, "admin@test.com");
        return new UsernamePasswordAuthenticationToken(p, null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
    }

    private UsernamePasswordAuthenticationToken employeeAuth() {
        AuthPrincipal p = new AuthPrincipal(2L, 1L, User.Role.EMPLOYEE, "emp@test.com");
        return new UsernamePasswordAuthenticationToken(p, null, List.of(new SimpleGrantedAuthority("ROLE_EMPLOYEE")));
    }

    @Test
    void healthEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ok"));
    }

    @Test
    void unauthenticatedProtectedEndpointsReturn401() throws Exception {
        mockMvc.perform(get("/api/sensors"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").exists());

        mockMvc.perform(get("/api/notifications"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error").exists());
    }

    @Test
    void employeeBlockedFromAdminEndpointsAndAdminBlockedFromEmployeeEndpoints() throws Exception {
        mockMvc.perform(get("/api/sensors").with(authentication(employeeAuth())))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/employees").with(authentication(employeeAuth())))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/dashboard/summary").with(authentication(employeeAuth())))
                .andExpect(status().isForbidden());

        mockMvc.perform(put("/api/area")
                        .with(authentication(employeeAuth()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Zone B\"}"))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/admin/backups").with(authentication(employeeAuth())))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/employee/tasks").with(authentication(adminAuth())))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminCanAccessBackupsAndEmployeeCanAccessMyTasksAndNotifications() throws Exception {
        when(backupService.listBackups()).thenReturn(List.of());
        mockMvc.perform(get("/api/admin/backups").with(authentication(adminAuth())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.backups").isArray());

        when(taskService.listMyTasks(2L, 1L, null)).thenReturn(new TaskListResponse(List.of()));
        mockMvc.perform(get("/api/employee/tasks").with(authentication(employeeAuth())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tasks").isArray());

        when(notificationService.listNotifications(2L)).thenReturn(new NotificationListResponse(List.of()));
        mockMvc.perform(get("/api/notifications").with(authentication(employeeAuth())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.notifications").isArray());
    }

    @Test
    void deviceReadingAcceptsHeaderKeyWithoutJwt() throws Exception {
        when(sensorService.ingestDeviceReading(eq("BIN-1"), eq("vr_1_abcdef"), eq(25.0), any()))
                .thenReturn(new DeviceReadingResponse(true, "BIN-1", 75.0, "MEDIUM", 900, null));

        mockMvc.perform(post("/api/device/reading")
                        .header("X-Device-Key", "vr_1_abcdef")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"binId\":\"BIN-1\",\"distanceCm\":25}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.fillPercentage").value(75.0));
    }

    @Test
    void invalidLoginPayloadTriggersBeanValidation400() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"identifier\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").exists());
    }
}
