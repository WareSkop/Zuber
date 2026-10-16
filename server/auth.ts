import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE_NAME = 'obsidian_vault_session';

function getSecret(): string {
  return process.env.SESSION_SECRET || 'obsidian-web-vault-secret-key-change-me-in-prod';
}

export function getExpectedPassword(): string {
  return process.env.OBSIDIAN_WEB_PASSWORD || 'obsidian';
}

export function createSessionToken(): string {
  const payload = JSON.stringify({
    user: 'owner',
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 14, // 14 days
  });
  const base64Payload = Buffer.from(payload, 'utf-8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSecret())
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${sig}`;
}

export function verifySessionToken(token?: string | null): boolean {
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
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (typeof req.query.token === 'string') {
    return req.query.token;
  }

  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractTokenFromRequest(req);
  if (!verifySessionToken(token)) {
    res.status(401).json({ error: 'Nicht authentifiziert. Bitte einloggen.' });
    return;
  }
  next();
}

export { COOKIE_NAME };
