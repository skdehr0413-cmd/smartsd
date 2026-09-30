export class DomainError extends Error {
  constructor(code, message, { status = 400, details } = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const invalid = (message, details) => new DomainError('VALIDATION', message, { status: 400, details });
export const notFound = (what, id) => new DomainError('NOT_FOUND', `${what}(${id})을(를) 찾을 수 없습니다.`, { status: 404 });
export const badState = (message, details) => new DomainError('INVALID_STATE', message, { status: 409, details });
export const conflict = (code, message, details) => new DomainError(code, message, { status: 409, details });
