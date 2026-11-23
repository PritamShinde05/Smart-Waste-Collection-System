package com.verdantroute.security;

import com.verdantroute.entity.User;

public record AuthPrincipal(Long userId, Long areaId, User.Role role, String email) {
}
