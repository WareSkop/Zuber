import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface TlsCredentials {
  key: string;
  cert: string;
  certPath: string;
  keyPath: string;
  isSelfSigned: boolean;
}

export function getLocalIpAddresses(): string[] {
  const ips: string[] = ['127.0.0.1'];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return Array.from(new Set(ips));
}

export function ensureTlsCredentials(rootDir: string): TlsCredentials {
  const customCert = process.env.TLS_CERT_PATH?.trim();
  const customKey = process.env.TLS_KEY_PATH?.trim();

  if (customCert && customKey && fs.existsSync(customCert) && fs.existsSync(customKey)) {
    return {
      cert: fs.readFileSync(customCert, 'utf-8'),
      key: fs.readFileSync(customKey, 'utf-8'),
      certPath: customCert,
      keyPath: customKey,
      isSelfSigned: false,
    };
  }

  const certsDir = path.join(rootDir, 'certs');
  if (!fs.existsSync(certsDir)) {
    fs.mkdirSync(certsDir, { recursive: true });
  }

  const certPath = path.join(certsDir, 'server.crt');
  const keyPath = path.join(certsDir, 'server.key');

  const localIps = getLocalIpAddresses();
  const sanList = ['DNS:localhost', ...localIps.map((ip) => `IP:${ip}`)].join(',');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-days',
        '3650',
        '-subj',
        '/CN=localhost/O=Basalt',
        '-addext',
        `subjectAltName=${sanList}`,
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore' }
    );
  }

  return {
    cert: fs.readFileSync(certPath, 'utf-8'),
    key: fs.readFileSync(keyPath, 'utf-8'),
    certPath,
    keyPath,
    isSelfSigned: true,
  };
}
