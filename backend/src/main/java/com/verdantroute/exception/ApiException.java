package com.verdantroute.exception;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final boolean retryable;

    public ApiException(HttpStatus status, String message) {
        this(status, message, false);
    }

    public ApiException(HttpStatus status, String message, boolean retryable) {
        super(message);
        this.status = status;
        this.retryable = retryable;
    }

    public HttpStatus getStatus() { return status; }
    public boolean isRetryable() { return retryable; }
}
