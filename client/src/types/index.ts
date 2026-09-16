import { User, Message, Room, MessageType, UserStatus, ServerInfo, ServerPayload, ClientPayload } from '@wifichat/shared/types';

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  logout: () => void;
}

export interface RoomsState {
  rooms: Room[];
  activeRoomId: string | null;
  setRooms: (rooms: Room[]) => void;
  addRoom: (room: Room) => void;
  updateRoom: (roomId: string, updates: Partial<Room>) => void;
  removeRoom: (roomId: string) => void;
  setActiveRoom: (roomId: string | null) => void;
}

export interface MessagesState {
  messages: Record<string, Message[]>;
  addMessage: (roomId: string, message: Message) => void;
  setMessages: (roomId: string, messages: Message[]) => void;
  prependMessages: (roomId: string, messages: Message[]) => void;
  updateMessageStatus: (roomId: string, messageId: string, status: Message['status']) => void;
  clearMessages: (roomId: string) => void;
}

export interface UsersState {
  users: User[];
  typingUsers: Record<string, Set<string>>;
  setUsers: (users: User[]) => void;
  addUser: (user: User) => void;
  removeUser: (userId: string) => void;
  updateUserStatus: (userId: string, status: UserStatus) => void;
  setTyping: (roomId: string, userId: string, isTyping: boolean) => void;
}

export interface DiscoveryState {
  servers: ServerInfo[];
  isScanning: boolean;
  error: string | null;
  setServers: (servers: ServerInfo[]) => void;
  addServer: (server: ServerInfo) => void;
  removeServer: (serverId: string) => void;
  setScanning: (scanning: boolean) => void;
  setError: (error: string | null) => void;
}

export interface UIState {
  sidebarOpen: boolean;
  infoPanelOpen: boolean;
  mobileView: 'chats' | 'chat' | 'info';
  setSidebarOpen: (open: boolean) => void;
  setInfoPanelOpen: (open: boolean) => void;
  setMobileView: (view: 'chats' | 'chat' | 'info') => void;
  toggleSidebar: () => void;
  toggleInfoPanel: () => void;
}

export type { User, Message, Room, MessageType, UserStatus, ServerInfo, ServerPayload, ClientPayload };