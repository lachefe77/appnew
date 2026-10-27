export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class SupplierError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SupplierError";
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Erro inesperado";
}
