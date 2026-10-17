import type { Request, Response, NextFunction } from 'express';

interface LoginAttemptRecord {
  failures: number;
  firstFailedAt: number;
  blockedUntil: number;
}

interface ApiRateRecord {
  count: number;
  windowStart: number;
}

export class InMemoryRateLimiter {
  private loginAttempts = new Map<string, LoginAttemptRecord>();
  private apiRequests = new Map<string, ApiRateRecord>();

  // Login Rate Limiting: max 5 failed attempts per 15 minutes
  private readonly LOGIN_MAX_FAILS = 5;
  private readonly LOGIN_BLOCK_MS = 15 * 60 * 1000; // 15 min

  // General API Limit: max 600 requests per 1 minute per IP
  private readonly API_MAX_REQUESTS = 600;
  private readonly API_WINDOW_MS = 60 * 1000; // 1 min

  constructor() {
    const timer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  public getClientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  public checkLoginAllowed(ip: string): { allowed: boolean; retryAfterSeconds?: number } {
    const now = Date.now();
    const record = this.loginAttempts.get(ip);
    if (!record) return { allowed: true };

    if (record.blockedUntil > now) {
      const retryAfterSeconds = Math.ceil((record.blockedUntil - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }

    if (now - record.firstFailedAt > this.LOGIN_BLOCK_MS) {
      this.loginAttempts.delete(ip);
      return { allowed: true };
    }

    return { allowed: true };
  }

  public recordLoginFailure(ip: string): void {
    const now = Date.now();
    const record = this.loginAttempts.get(ip) || {
      failures: 0,
      firstFailedAt: now,
      blockedUntil: 0,
    };

    if (now - record.firstFailedAt > this.LOGIN_BLOCK_MS) {
      record.failures = 1;
      record.firstFailedAt = now;
      record.blockedUntil = 0;
    } else {
      record.failures += 1;
    }

    if (record.failures >= this.LOGIN_MAX_FAILS) {
      record.blockedUntil = now + this.LOGIN_BLOCK_MS;
    }

    this.loginAttempts.set(ip, record);
  }

  public recordLoginSuccess(ip: string): void {
    this.loginAttempts.delete(ip);
  }

  public apiRateLimitMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/api')) {
      return next();
    }

    const ip = this.getClientIp(req);
    const now = Date.now();
    const record = this.apiRequests.get(ip) || { count: 0, windowStart: now };

    if (now - record.windowStart > this.API_WINDOW_MS) {
      record.count = 1;
      record.windowStart = now;
    } else {
      record.count += 1;
    }

    this.apiRequests.set(ip, record);

    if (record.count > this.API_MAX_REQUESTS) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Zu viele Anfragen. Bitte kurz warten.' });
      return;
    }

    next();
  };

  public resetForTest(): void {
    this.loginAttempts.clear();
    this.apiRequests.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [ip, record] of this.loginAttempts.entries()) {
      if (now > record.blockedUntil && now - record.firstFailedAt > this.LOGIN_BLOCK_MS) {
        this.loginAttempts.delete(ip);
      }
    }
    for (const [ip, record] of this.apiRequests.entries()) {
      if (now - record.windowStart > this.API_WINDOW_MS) {
        this.apiRequests.delete(ip);
      }
    }
  }
}

export const rateLimiter = new InMemoryRateLimiter();
