export interface LinkClickModifiers {
  ctrlKey?: boolean;
  metaKey?: boolean;
  button?: number;
}

/**
 * Normalizes user-entered or clicked web URLs.
 * Prepends `https://` if no protocol is present and rejects non-HTTP(S) schemes.
 */
export function normalizeWebUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
  const candidate = hasProtocol ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Determines whether clicking an external link should load inside the Research Pane.
 * Normal left-click opens in Research Pane when `isResearchOpen === true`;
 * Ctrl+Click, Cmd+Click, or Middle-Click (`button === 1`) bypasses to external browser.
 */
export function shouldOpenLinkInResearchPane(
  isResearchOpen: boolean,
  event?: LinkClickModifiers | null
): boolean {
  if (!isResearchOpen) return false;
  if (event?.ctrlKey || event?.metaKey || event?.button === 1) return false;
  if (event?.button !== undefined && event.button !== 0) return false;
  return true;
}

/**
 * Routes an external link click according to Research Split-View state and modifier keys.
 * Returns `'research'` when routed into the Research Pane, or `'external'` otherwise.
 */
export function routeExternalLinkClick(options: {
  url: string;
  isResearchOpen: boolean;
  event?: (LinkClickModifiers & { preventDefault?: () => void; stopPropagation?: () => void }) | null;
  onOpenInResearch?: (url: string) => void;
  openExternal?: (url: string) => void;
}): 'research' | 'external' {
  const { url, isResearchOpen, event, onOpenInResearch, openExternal } = options;
  if (shouldOpenLinkInResearchPane(isResearchOpen, event) && onOpenInResearch) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    onOpenInResearch(url);
    return 'research';
  }

  if (openExternal) {
    event?.preventDefault?.();
    openExternal(url);
  }
  return 'external';
}
