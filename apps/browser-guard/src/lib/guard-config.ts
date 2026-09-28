export const CONFIG_STORAGE_KEY = 'browserGuardConfig';
const MAX_AUDIT_EVENTS = 50;

export type GuardEvent = {
  kind: 'possible-docked-devtools';
  occurredAt: string;
  origin: string;
};

export type GuardConfig = {
  events: GuardEvent[];
  sites: Record<string, { enabled: true }>;
};

export const emptyConfig = (): GuardConfig => ({ events: [], sites: {} });

export async function readGuardConfig(): Promise<GuardConfig> {
  const stored = await chrome.storage.local.get(CONFIG_STORAGE_KEY);
  const config = stored[CONFIG_STORAGE_KEY] as Partial<GuardConfig> | undefined;
  return {
    events: Array.isArray(config?.events) ? config.events : [],
    sites: config?.sites ?? {},
  };
}

export async function writeGuardConfig(config: GuardConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_STORAGE_KEY]: config });
}

export function addEvent(config: GuardConfig, event: GuardEvent): GuardConfig {
  return { ...config, events: [event, ...config.events].slice(0, MAX_AUDIT_EVENTS) };
}

export function originPermission(origin: string): string {
  const url = new URL(origin);
  return `${url.protocol}//${url.host}/*`;
}

export function isProtectableUrl(url?: string): url is string {
  return Boolean(url && (url.startsWith('https://') || url.startsWith('http://')));
}
