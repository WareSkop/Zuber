---
tags:
  - security
  - encryption
  - webauthn
---

# 05 - Folder Encryption & Security

Zuber supports **Zero-Knowledge Client-Side Folder Encryption** (`AES-256-GCM` via Web Crypto API) for sensitive folders.

> [!IMPORTANT] Zero-Knowledge Guarantee
> Plaintext passwords and derived `CryptoKey` instances **never** leave your browser and are never sent to the server or written to disk.

## How It Works

1. **Encrypt Any Folder:** Right-click (or long-press on mobile) any folder in the file tree and choose **Encrypt Folder…**.
2. **All File Types Supported:** Every file inside the folder — `.md`, `.canvas`, `.base`, `.pdf`, images, and binary attachments — is encrypted in-browser into `<filename>.<ext>.zenc` using `PBKDF2-SHA256` (`310,000` iterations) + `AES-256-GCM`.
3. **Locked (`🔒`) vs. Unlocked (`🔓`):**
   - While locked, encrypted folders cannot be read by the server or offline cache.
   - Unlocking keeps the derived key strictly in memory and purges decrypted IndexedDB caches automatically when locked.
4. **Auto-Lock & Biometric Unlock:**
   - Configure the inactivity **Auto-Lock Timeout** in **Settings → Security** (default: 15 minutes).
   - On supported devices, enable **Fingerprint / Biometric Unlock (WebAuthn)** to re-unlock folders quickly without retyping your password.
