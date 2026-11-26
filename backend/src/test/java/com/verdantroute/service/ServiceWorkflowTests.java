package com.verdantroute.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.verdantroute.dto.AuthDtos.*;
import com.verdantroute.dto.DashboardDtos.*;
import com.verdantroute.dto.SensorAndDeviceDtos.*;
import com.verdantroute.dto.TaskAndRouteDtos.*;
import com.verdantroute.entity.*;
import com.verdantroute.exception.ApiException;
import com.verdantroute.repository.*;
import com.verdantroute.scheduler.OfflineMonitorScheduler;
import com.verdantroute.security.JwtService;
import com.verdantroute.websocket.RealtimeWebSocketHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class ServiceWorkflowTests {

    @Mock private AreaRepository areaRepository;
    @Mock private UserRepository userRepository;
    @Mock private SensorRepository sensorRepository;
    @Mock private SensorReadingRepository readingRepository;
    @Mock private TaskRepository taskRepository;
    @Mock private TaskBinRepository taskBinRepository;
    @Mock private NotificationRepository notificationRepository;
    @Mock private RouteOptimizationService routeService;
    @Mock private RealtimeWebSocketHandler wsHandler;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(4);
    private final Clock fixedClock = Clock.fixed(Instant.parse("2026-11-26T12:00:00Z"), ZoneOffset.UTC);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private JwtService jwtService;
    private AuthService authService;
    private SensorService sensorService;
    private TaskService taskService;
    private DashboardService dashboardService;
    private NotificationService notificationService;
    private OfflineMonitorScheduler scheduler;

    @BeforeEach
    void setUp() {
        jwtService = new JwtService("unit-test-secret-with-at-least-32-characters-1234", 86400000L);
        authService = new AuthService(userRepository, areaRepository, passwordEncoder, jwtService);
        sensorService = new SensorService(sensorRepository, readingRepository, taskBinRepository,
                areaRepository, passwordEncoder, wsHandler, fixedClock);
        taskService = new TaskService(areaRepository, userRepository, sensorRepository, taskRepository,
                taskBinRepository, notificationRepository, routeService, sensorService, wsHandler, objectMapper, fixedClock);
        dashboardService = new DashboardService(areaRepository, sensorRepository, readingRepository,
                taskRepository, userRepository, fixedClock);
        notificationService = new NotificationService(notificationRepository);
        scheduler = new OfflineMonitorScheduler(sensorRepository, areaRepository, sensorService, wsHandler, fixedClock);
    }

    @Test
    void adminRegisterAndLoginAndDeactivatedProtection() {
        when(userRepository.existsByEmailIgnoreCaseOrMobile(anyString(), anyString())).thenReturn(false);
        when(areaRepository.save(any(Area.class))).thenAnswer(inv -> {
            Area a = inv.getArgument(0);
            a.setId(1L);
            return a;
        });
        when(userRepository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setId(10L);
            return u;
        });

        AuthResponse reg = authService.registerAdmin(new RegisterAdminRequest(
                "Admin One", "admin@example.com", "+919800000001", "Pass1234", "Pass1234",
                "Zone A", "Pune", 18.52, 73.85));
        assertNotNull(reg.token());
        assertEquals("ADMIN", reg.user().role());
        assertEquals("Zone A", reg.user().area().name());

        Area area = new Area();
        area.setId(1L);
        area.setName("Zone A");
        area.setCity("Pune");
        area.setCentreLat(18.52);
        area.setCentreLng(73.85);

        User activeUser = new User();
        activeUser.setId(10L);
        activeUser.setArea(area);
        activeUser.setName("Admin One");
        activeUser.setEmail("admin@example.com");
        activeUser.setMobile("+919800000001");
        activeUser.setRole(User.Role.ADMIN);
        activeUser.setStatus(User.Status.ACTIVE);
        activeUser.setPasswordHash(passwordEncoder.encode("Pass1234"));

        when(userRepository.findByEmailIgnoreCaseOrMobile("admin@example.com", "admin@example.com"))
                .thenReturn(Optional.of(activeUser));
        AuthResponse loginRes = authService.login(new LoginRequest("admin@example.com", "Pass1234"));
        assertEquals("admin@example.com", loginRes.user().email());

        activeUser.setStatus(User.Status.INACTIVE);
        ApiException ex = assertThrows(ApiException.class,
                () -> authService.login(new LoginRequest("admin@example.com", "Pass1234")));
        assertEquals(HttpStatus.FORBIDDEN, ex.getStatus());
    }

    @Test
    void sensorRegistrationAndDeviceReadingAndInvalidKeyCheck() {
        Area area = new Area();
        area.setId(1L);
        area.setMediumThreshold(50);
        area.setFullThreshold(80);
        area.setDefaultIntervalSeconds(900);
        when(areaRepository.findById(1L)).thenReturn(Optional.of(area));
        when(sensorRepository.existsByAreaIdAndBinIdIgnoreCase(1L, "BIN-101")).thenReturn(false);

        AtomicLong seq = new AtomicLong(42L);
        when(sensorRepository.save(any(Sensor.class))).thenAnswer(inv -> {
            Sensor s = inv.getArgument(0);
            if (s.getId() == null) s.setId(seq.getAndIncrement());
            return s;
        });

        CreateSensorResponse created = sensorService.createSensor(1L,
                new CreateSensorRequest("BIN-101", "Gate", 18.52, 73.85, 100.0, 900, 80));
        assertTrue(created.deviceKey().startsWith("vr_42_"));
        assertEquals("OFFLINE", created.sensor().status());

        Sensor persisted = new Sensor();
        persisted.setId(42L);
        persisted.setArea(area);
        persisted.setBinId("BIN-101");
        persisted.setLabel("Gate");
        persisted.setLatitude(18.52);
        persisted.setLongitude(73.85);
        persisted.setBinHeightCm(100.0);
        persisted.setIntervalSeconds(900);
        persisted.setFullThreshold(80);
        persisted.setIsActive(true);
        persisted.setDeviceKeyHash(passwordEncoder.encode(created.deviceKey()));

        when(sensorRepository.findByIdAndBinIdIgnoreCase(42L, "BIN-101")).thenReturn(Optional.of(persisted));
        DeviceReadingResponse reading = sensorService.ingestDeviceReading(
                "BIN-101", created.deviceKey(), 15.0, fixedClock.instant());
        assertEquals(85.0, reading.fillPercentage());
        assertEquals("FULL", reading.status());

        ApiException badKey = assertThrows(ApiException.class,
                () -> sensorService.ingestDeviceReading("BIN-101", "vr_42_wrong", 15.0, fixedClock.instant()));
        assertEquals(HttpStatus.UNAUTHORIZED, badKey.getStatus());
    }

    @Test
    void offlineSchedulerMarksStaleSensorOfflineAndBroadcasts() {
        Area area = new Area();
        area.setId(1L);
        area.setMediumThreshold(50);
        area.setFullThreshold(80);

        Sensor stale = new Sensor();
        stale.setId(7L);
        stale.setArea(area);
        stale.setBinId("BIN-STALE");
        stale.setIsActive(true);
        stale.setIntervalSeconds(60);
        stale.setFullThreshold(80);
        stale.setLastFillPercent(40.0);
        stale.setLastSeenAt(fixedClock.instant().minusSeconds(180));
        stale.setStatus(Sensor.SensorStatus.NORMAL);

        when(sensorRepository.findByIsActiveTrueAndStatusNot(Sensor.SensorStatus.OFFLINE))
                .thenReturn(List.of(stale));
        when(areaRepository.findById(1L)).thenReturn(Optional.of(area));

        scheduler.detectOfflineSensors();

        assertEquals(Sensor.SensorStatus.OFFLINE, stale.getStatus());
        verify(sensorRepository).save(stale);
        verify(wsHandler).broadcastToAreaAdmins(eq(1L), eq("sensor:updated"), any());
    }

    @Test
    void taskLifecycleAssignAcceptCollectCompleteAndNotifications() {
        Area area = new Area();
        area.setId(1L);
        area.setName("Zone A");
        area.setCentreLat(18.52);
        area.setCentreLng(73.85);
        area.setMediumThreshold(50);
        area.setFullThreshold(80);

        User admin = new User();
        admin.setId(1L);
        admin.setArea(area);
        admin.setName("Admin");

        User emp = new User();
        emp.setId(2L);
        emp.setArea(area);
        emp.setName("Driver");
        emp.setMobile("+919900000000");
        emp.setEmail("driver@example.com");
        emp.setRole(User.Role.EMPLOYEE);
        emp.setStatus(User.Status.ACTIVE);

        Sensor bin = new Sensor();
        bin.setId(5L);
        bin.setArea(area);
        bin.setBinId("BIN-5");
        bin.setLabel("Plaza");
        bin.setLatitude(18.53);
        bin.setLongitude(73.86);
        bin.setBinHeightCm(100.0);
        bin.setLastFillPercent(90.0);
        bin.setStatus(Sensor.SensorStatus.FULL);

        when(areaRepository.findById(1L)).thenReturn(Optional.of(area));
        when(userRepository.findById(1L)).thenReturn(Optional.of(admin));
        when(userRepository.findByIdAndAreaIdAndRole(2L, 1L, User.Role.EMPLOYEE)).thenReturn(Optional.of(emp));
        when(sensorRepository.findByIdAndAreaId(5L, 1L)).thenReturn(Optional.of(bin));
        when(routeService.optimize(18.52, 73.85, List.of(bin), true))
                .thenReturn(new RouteOptimizationService.OptimizedResult(
                        List.of(bin),
                        "{\"type\":\"LineString\",\"coordinates\":[[73.85,18.52],[73.86,18.53]]}",
                        1200.0,
                        180.0));
        when(taskRepository.save(any(CollectionTask.class))).thenAnswer(inv -> {
            CollectionTask t = inv.getArgument(0);
            if (t.getId() == null) t.setId(99L);
            if (!t.getStops().isEmpty() && t.getStops().get(0).getId() == null) {
                t.getStops().get(0).setId(501L);
            }
            return t;
        });

        TaskDetailResponse created = taskService.createTask(1L, 1L,
                new CreateTaskRequest(2L, List.of(5L), "DEPOT", "Priority pickup", true));
        assertEquals("ASSIGNED", created.task().status());
        assertTrue(created.task().returnToDepot());
        verify(notificationRepository).save(any(Notification.class));
        verify(wsHandler).broadcastToUser(eq(2L), eq(1L), eq("task:assigned"), any());

        CollectionTask storedTask = new CollectionTask();
        storedTask.setId(99L);
        storedTask.setArea(area);
        storedTask.setCreatedBy(admin);
        storedTask.setAssignedTo(emp);
        storedTask.setStatus(CollectionTask.TaskStatus.ASSIGNED);
        storedTask.setStartType("DEPOT");
        storedTask.setStartLat(18.52);
        storedTask.setStartLng(73.85);
        storedTask.setReturnToDepot(true);
        storedTask.setRouteGeometry("{\"type\":\"LineString\",\"coordinates\":[[73.85,18.52],[73.86,18.53]]}");
        TaskBin stop = new TaskBin();
        stop.setId(501L);
        stop.setTask(storedTask);
        stop.setSensor(bin);
        stop.setStopOrder(1);
        storedTask.getStops().add(stop);

        when(taskRepository.findByIdAndAssignedToIdAndAreaId(99L, 2L, 1L)).thenReturn(Optional.of(storedTask));
        when(taskBinRepository.findByIdAndTaskId(501L, 99L)).thenReturn(Optional.of(stop));

        TaskDetailResponse accepted = taskService.acceptTask(2L, 1L, 99L);
        assertEquals("ACCEPTED", accepted.task().status());

        TaskDetailResponse collected = taskService.markBinCollected(2L, 1L, 99L, 501L);
        assertNotNull(collected.task().stops().get(0).collectedAt());
        assertEquals(0.0, bin.getLastFillPercent());
        assertEquals(Sensor.SensorStatus.NORMAL, bin.getStatus());

        TaskDetailResponse completed = taskService.completeTask(2L, 1L, 99L, new CompleteTaskRequest("Done"));
        assertEquals("COMPLETED", completed.task().status());
        assertEquals("Done", completed.task().completionNote());

        Notification unread = new Notification();
        unread.setId(300L);
        unread.setUser(emp);
        unread.setType("TASK_ASSIGNED");
        unread.setMessage("Assigned");
        when(notificationRepository.findTop30ByUserIdOrderByCreatedAtDesc(2L)).thenReturn(List.of(unread));
        assertEquals(1, notificationService.listNotifications(2L).notifications().size());
    }

    @Test
    void dashboardSummaryComputesCardsAndSplits() {
        Area area = new Area();
        area.setId(1L);
        area.setMediumThreshold(50);
        area.setFullThreshold(80);
        when(areaRepository.findById(1L)).thenReturn(Optional.of(area));

        Sensor fullBin = new Sensor();
        fullBin.setId(1L);
        fullBin.setBinId("B1");
        fullBin.setLabel("One");
        fullBin.setIsActive(true);
        fullBin.setIntervalSeconds(900);
        fullBin.setFullThreshold(80);
        fullBin.setLastFillPercent(92.0);
        fullBin.setLastSeenAt(fixedClock.instant().minusSeconds(30));
        fullBin.setStatus(Sensor.SensorStatus.FULL);

        when(sensorRepository.findByAreaIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(fullBin));
        when(taskRepository.findByAreaIdOrderByCreatedAtDesc(1L)).thenReturn(List.of());
        when(userRepository.countByAreaIdAndRole(1L, User.Role.EMPLOYEE)).thenReturn(2L);

        DashboardSummaryResponse summary = dashboardService.getSummary(1L, null, null);
        assertEquals(1, summary.cards().totalBins());
        assertEquals(1, summary.cards().fullBins());
        assertEquals(2, summary.cards().employeeCount());
    }
}
