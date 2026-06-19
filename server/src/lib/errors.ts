export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class AuthError extends DomainError {
  constructor(message = 'Unauthorized') {
    super(message, 'AUTH_ERROR');
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super(message, 'NOT_FOUND');
  }
}

export class ConflictError extends DomainError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(message, code);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(
    public readonly from: string,
    public readonly event: string
  ) {
    super(`Invalid transition: cannot apply '${event}' to state '${from}'`, 'INVALID_TRANSITION');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(message, code);
  }
}
