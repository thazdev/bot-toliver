/**
 * Logger que persiste em localStorage para sobreviver ao refresh da página.
 * Use para debug do fluxo de login - os logs permanecem após o reload.
 */

const STORAGE_KEY = 'auth-debug-logs';
const MAX_LOGS = 50;

export type LogEntry = {
  ts: string;
  step: string;
  data?: unknown;
};

function getLogs(): LogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLogs(logs: LogEntry[]) {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = logs.slice(-MAX_LOGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore
  }
}

export function debugLog(step: string, data?: unknown) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    step,
    data: data !== undefined ? data : undefined,
  };
  const logs = getLogs();
  logs.push(entry);
  saveLogs(logs);
  console.log(`[AUTH-DEBUG] ${step}`, data ?? '');
}

export function getDebugLogs(): LogEntry[] {
  return getLogs();
}

export function clearDebugLogs() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
