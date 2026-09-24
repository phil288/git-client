import type { ErrorCode, ErrorInfo } from '@shared/types'

/** Error thrown by main-process services; converted to ErrorInfo at the IPC boundary. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly extra: { stderr?: string; exitCode?: number | null; command?: string } = {}
  ) {
    super(message)
    this.name = 'AppError'
  }

  toInfo(): ErrorInfo {
    return { message: this.message, code: this.code, ...this.extra }
  }
}

export function toErrorInfo(err: unknown): ErrorInfo {
  if (err instanceof AppError) return err.toInfo()
  if (err instanceof Error) return { message: err.message, code: 'UNKNOWN' }
  return { message: String(err), code: 'UNKNOWN' }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof AppError && err.code === 'CANCELLED'
}
