package com.verdantroute.repository;

import com.verdantroute.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {
    Optional<User> findByEmailIgnoreCase(String email);
    Optional<User> findByMobile(String mobile);
    Optional<User> findByEmailIgnoreCaseOrMobile(String email, String mobile);
    boolean existsByEmailIgnoreCaseOrMobile(String email, String mobile);
    boolean existsByEmailIgnoreCaseAndIdNot(String email, Long id);
    boolean existsByMobileAndIdNot(String mobile, Long id);
    List<User> findByAreaIdAndRoleOrderByCreatedAtDesc(Long areaId, User.Role role);
    Optional<User> findByIdAndAreaIdAndRole(Long id, Long areaId, User.Role role);
    long countByAreaIdAndRole(Long areaId, User.Role role);
}
