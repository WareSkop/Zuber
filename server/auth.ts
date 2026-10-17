import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { configService } from './configService';

const COOKIE_NAME = 'knowmesh_session';

function getSecret(): string {
  return process.env.SESSION_SECRET || 'knowmesh-offline-vault-secret-key-change-me-in-prod';
}

export function createSessionToken(): string {
  const payload = JSON.stringify({
    user: 'owner',
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
  });
  const base64Payload = Buffer.from(payload, 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${sig}`;
}

export function verifySessionToken(token?: string | null): boolean {
  if (!configService.isAuthRequired()) {
    return true;
  }

  if (!token || !token.includes('.')) return false;
  const [base64Payload, sig] = token.split('.');
  if (!base64Payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSecret())
    .update(base64Payload)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf-8'));
    if (typeof data.exp === 'number' && Date.now() > data.exp) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function extractTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  const cookieToken = req.cookies?.[COOKIE_NAME] || req.cookies?.['basalt_session'] || req.cookies?.['obsidian_vault_session'];
  if (cookieToken) return cookieToken;

  if (typeof req.query.token === 'string') {
    return req.query.token;
  }

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!configService.isAuthRequired()) {
    return next();
  }

  const token = extractTokenFromRequest(req);
  if (!verifySessionToken(token)) {
    res.status(401).json({ error: 'Nicht authentifiziert. Bitte einloggen.' });
    return;
  }
  next();
}

export { COOKIE_NAME };
