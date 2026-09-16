import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { User, Room, Message, UserStatus, ServerInfo } from '@wifichat/shared/types';
import { AuthState, RoomsState, MessagesState, UsersState, DiscoveryState, UIState } from './types';

/** localStorage wrapper that never throws (e.g. on quota errors). */
const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded (e.g. cached attachments) — keep running unpersisted.
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null as User | null,
      token: null as string | null,
      isAuthenticated: false,
      setUser: (user: User | null) => set({ user, isAuthenticated: !!user }),
      setToken: (token: string | null) => set({ token }),
      logout: () => set({ user: null, token: null, isAuthenticated: false }),
    }),
    {
      name: 'wifichat-auth',
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated }),
    }
  )
);

export const useRoomsStore = create<RoomsState>()(
  persist(
    (set) => ({
      rooms: [] as Room[],
      activeRoomId: null as string | null,
      setRooms: (rooms: Room[]) => set({ rooms }),
      addRoom: (room: Room) => set((state) => ({ rooms: [...state.rooms, room] })),
      updateRoom: (roomId: string, updates: Partial<Room>) =>
        set((state) => ({
          rooms: state.rooms.map((r) => (r.id === roomId ? { ...r, ...updates } : r)),
        })),
      removeRoom: (roomId: string) =>
        set((state) => ({
          rooms: state.rooms.filter((r) => r.id !== roomId),
          activeRoomId: state.activeRoomId === roomId ? null : state.activeRoomId,
        })),
      setActiveRoom: (roomId: string | null) => set({ activeRoomId: roomId }),
    }),
    {
      name: 'wifichat-rooms',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ rooms: state.rooms, activeRoomId: state.activeRoomId }),
    }
  )
);

export const useMessagesStore = create<MessagesState>()(
  persist(
    (set) => ({
      messages: {} as Record<string, Message[]>,
      addMessage: (roomId: string, message: Message) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [roomId]: [...(state.messages[roomId] || []), message],
          },
        })),
      setMessages: (roomId: string, messages: Message[]) =>
        set((state) => ({
          messages: { ...state.messages, [roomId]: messages },
        })),
      prependMessages: (roomId: string, messages: Message[]) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [roomId]: [...messages, ...(state.messages[roomId] || [])],
          },
        })),
      updateMessageStatus: (roomId: string, messageId: string, status: Message['status']) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [roomId]: (state.messages[roomId] || []).map((m) =>
              m.id === messageId ? { ...m, status } : m
            ),
          },
        })),
      editMessage: (roomId: string, messageId: string, content: string) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [roomId]: (state.messages[roomId] || []).map((m) =>
              m.id === messageId ? { ...m, content, edited: true } : m
            ),
          },
        })),
      deleteMessage: (roomId: string, messageId: string) =>
        set((state) => ({
          messages: {
            ...state.messages,
            [roomId]: (state.messages[roomId] || []).filter((m) => m.id !== messageId),
          },
        })),
      clearMessages: (roomId: string) =>
        set((state) => {
          const newMessages = { ...state.messages };
          delete newMessages[roomId];
          return { messages: newMessages };
        }),
      clearAllMessages: () => set({ messages: {} }),
    }),
    {
      name: 'wifichat-messages',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => {
        // Keep the cache small: recent messages only, and skip bulky
        // base64 attachments (they reload from server history on join).
        const messages: Record<string, Message[]> = {};
        for (const [roomId, list] of Object.entries(state.messages)) {
          messages[roomId] = list
            .filter((m) => !(m.content.length > 32768 && m.content.startsWith('data:')))
            .slice(-200);
        }
        return { messages };
      },
    }
  )
);

export const useUsersStore = create<UsersState>((set) => ({
  users: [] as User[],
  typingUsers: {} as Record<string, Set<string>>,
  setUsers: (users: User[]) => set({ users }),
  addUser: (user: User) =>
    set((state) => ({
      users: state.users.some((u) => u.id === user.id) ? state.users : [...state.users, user],
    })),
  removeUser: (userId: string) =>
    set((state) => ({
      users: state.users.filter((u) => u.id !== userId),
    })),
  updateUserStatus: (userId: string, status: UserStatus) =>
    set((state) => ({
      users: state.users.map((u) => (u.id === userId ? { ...u, status } : u)),
    })),
  setTyping: (roomId: string, userId: string, isTyping: boolean) =>
    set((state) => {
      const newTyping = { ...state.typingUsers };
      if (!newTyping[roomId]) newTyping[roomId] = new Set();
      if (isTyping) {
        newTyping[roomId].add(userId);
      } else {
        newTyping[roomId].delete(userId);
      }
      return { typingUsers: newTyping };
    }),
}));

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  servers: [] as ServerInfo[],
  isScanning: false,
  error: null as string | null,
  setServers: (servers: ServerInfo[]) => set({ servers }),
  addServer: (server: ServerInfo) =>
    set((state) => {
      // Match by server id: the same server can be reached via several LAN
      // IPs, but it must appear exactly once (latest responding address wins).
      const key = (s: ServerInfo) => s.id || `${s.host}:${s.port}`;
      const exists = state.servers.some((s) => key(s) === key(server));
      return {
        servers: exists
          ? state.servers.map((s) => (key(s) === key(server) ? server : s))
          : [...state.servers, server]
      };
    }),
  removeServer: (serverId: string) =>
    set((state) => ({
      servers: state.servers.filter((s) => s.id !== serverId),
    })),
  setScanning: (isScanning: boolean) => set({ isScanning }),
  setError: (error: string | null) => set({ error }),
}));

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  infoPanelOpen: true,
  mobileView: 'chats' as 'chats' | 'chat' | 'info',
  setSidebarOpen: (sidebarOpen: boolean) => set({ sidebarOpen }),
  setInfoPanelOpen: (infoPanelOpen: boolean) => set({ infoPanelOpen }),
  setMobileView: (mobileView: 'chats' | 'chat' | 'info') => set({ mobileView }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  toggleInfoPanel: () => set((state) => ({ infoPanelOpen: !state.infoPanelOpen })),
}));