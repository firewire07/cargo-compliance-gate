import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "crypto";

type ErrorBody = {
  statusCode: number;
  message: string | string[];
  correlationId: string;
  timestamp: string;
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = header(request, "x-correlation-id") || randomUUID();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Internal server error";

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === "string") {
        message = body;
      } else if (body && typeof body === "object" && "message" in body) {
        const raw = (body as { message?: string | string[] }).message;
        message = raw && (typeof raw === "string" || Array.isArray(raw)) ? raw : exception.message;
      } else {
        message = exception.message;
      }
    } else {
      this.logger.error(
        "Unhandled error",
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const payload: ErrorBody = {
      statusCode,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
    };
    if (!response.headersSent) {
      response.status(statusCode).json(payload);
    }
  }
}

function header(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
