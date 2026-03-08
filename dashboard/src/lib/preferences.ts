/**
 * Preferências do usuário persistidas em localStorage.
 */

const KEY = 'toliver-preferences';

export type Preferences = {
  sidebarCollapsed?: boolean;
  lastPath?: string;
  debugPanelOpen?: boolean;
};

function get(): Preferences {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function set(partial: Partial<Preferences>) {
  if (typeof window === 'undefined') return;
  try {
    const current = get();
    const next = { ...current, ...partial };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export const preferences = {
  get,
  set,
  getSidebarCollapsed: () => get().sidebarCollapsed ?? false,
  setSidebarCollapsed: (v: boolean) => set({ sidebarCollapsed: v }),
  getLastPath: () => get().lastPath ?? '/',
  setLastPath: (path: string) => set({ lastPath: path }),
};
