package com.verdantroute.integration;

import com.verdantroute.repository.AreaRepository;
import com.verdantroute.repository.SensorRepository;
import com.verdantroute.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Full Spring Boot + Flyway + MySQL 8 schema validation integration test.
 * Enable locally when MySQL 8 + DB_PASSWORD + JWT_SECRET are exported:
 *   MYSQL_TEST_ENABLED=true mvn test
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "MYSQL_TEST_ENABLED", matches = "true")
class MySqlFlywayIntegrationTest {

    @Autowired private AreaRepository areaRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private SensorRepository sensorRepository;

    @Test
    void flywayMigratesAndHibernateValidatesMySql8Schema() {
        assertNotNull(areaRepository);
        assertNotNull(userRepository);
        assertNotNull(sensorRepository);
        assertTrue(areaRepository.count() >= 0);
    }
}
