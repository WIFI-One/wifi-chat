const STORAGE_PREFIX = 'wifichat_';

export const storage = {
  get<T>(key: string, defaultValue: T): T {
    try {
      const item = localStorage.getItem(STORAGE_PREFIX + key);
      return item ? JSON.parse(item) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
    } catch (error) {
      console.error('Storage set error:', error);
    }
  },

  remove(key: string): void {
    try {
      localStorage.removeItem(STORAGE_PREFIX + key);
    } catch (error) {
      console.error('Storage remove error:', error);
    }
  },

  clear(): void {
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(STORAGE_PREFIX))
        .forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.error('Storage clear error:', error);
    }
  },
};

export const settingsStorage = {
  getTheme: () => storage.get<'dark' | 'light'>('theme', 'dark'),
  setTheme: (theme: 'dark' | 'light') => storage.set('theme', theme),
  
  getNotifications: () => storage.get<boolean>('notifications', true),
  setNotifications: (enabled: boolean) => storage.set('notifications', enabled),
  
  getSound: () => storage.get<boolean>('sound', true),
  setSound: (enabled: boolean) => storage.set('sound', enabled),
  
  getAutoConnect: () => storage.get<boolean>('autoConnect', true),
  setAutoConnect: (enabled: boolean) => storage.set('autoConnect', enabled),
  
  getLastServer: () => storage.get<string>('lastServer', ''),
  setLastServer: (url: string) => storage.set('lastServer', url),
  
  getLastUsername: () => storage.get<string>('lastUsername', ''),
  setLastUsername: (username: string) => storage.set('lastUsername', username),
};