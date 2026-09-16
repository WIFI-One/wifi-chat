import React, { useState } from 'react';
import { Wifi, Shield, Trash2, LogOut, Info, Pencil, ChevronLeft, Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import {
  useAuthStore,
  useRoomsStore,
  useMessagesStore,
  useUsersStore,
  useUIStore
} from '../../context/stores';
import { websocketService } from '../../services/websocket';
import { formatTimestamp } from '../../services/crypto';
import { Room, User } from '@wifichat/shared/types';

export const InfoPanelContent: React.FC = () => {
  const { user } = useAuthStore();
  const { rooms, activeRoomId, setActiveRoom, removeRoom } = useRoomsStore();
  const { users } = useUsersStore();
  const { clearMessages } = useMessagesStore();
  const { setMobileView } = useUIStore();
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [renameDraft, setRenameDraft] = useState<string | null>(null);

  // Resolve DM alias to the real room if it arrived already.
  const room = rooms.find((r: Room) => r.id === activeRoomId);
  const dmPeerId = !room && activeRoomId?.startsWith('dm_') ? activeRoomId.slice(3) : null;
  const dmPeer = dmPeerId ? users.find((u: User) => u.id === dmPeerId) : undefined;
  const isDM = !!dmPeer || room?.id.startsWith('dm_') || !!dmPeerId;
  const otherUser = isDM
    ? dmPeer || users.find((u: User) => room && u.id !== user?.id && room.members.includes(u.id))
    : undefined;
  const roomUsers =
    room && !isDM ? users.filter((u: User) => room.members.includes(u.id)) : [];
  // Online users who could still be invited (members can invite anyone).
  const invitableUsers =
    room && !isDM
      ? users.filter((u: User) => u.id !== user?.id && !room.members.includes(u.id))
      : [];

  const handleClearChat = () => {
    if (!activeRoomId) return;
    if (confirm('Clear all messages in this conversation on this device?')) {
      clearMessages(activeRoomId);
    }
  };

  const handleLeaveRoom = () => {
    if (!room) return;
    if (confirm(`Leave "${room.name}"?`)) {
      removeRoom(room.id);
      setActiveRoom(rooms.find((r) => r.id !== room.id)?.id || null);
      setMobileView('chats');
    }
  };

  // Rename is group-room only (never DMs or system-owned rooms); anyone
  // may delete any room. The server enforces the same rules.
  const canManageRoom = !!room && !isDM && room.createdBy !== 'system';
  const canDeleteRoom = !!room && !isDM;

  const handleSaveRoomName = () => {
    if (!room || renameDraft === null) return;
    const name = renameDraft.trim();
    setRenameDraft(null);
    if (name && name !== room.name) websocketService.renameRoom(room.id, name);
  };

  const handleDeleteRoom = () => {
    if (!room) return;
    if (confirm(`Delete "${room.name}" for everyone?`)) {
      websocketService.deleteRoom(room.id);
      setMobileView('chats');
    }
  };

  const handleBlockToggle = (userId: string, username: string) => {
    if (blocked.has(userId)) {
      setBlocked((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    } else if (confirm(`Hide messages from ${username} on this device?`)) {
      setBlocked((prev) => new Set(prev).add(userId));
    }
  };

  if (!activeRoomId || (!room && !dmPeer)) {
    return (
      <div className="flex flex-col h-full p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-white">Information</h2>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-center px-4">
          Select a conversation to view details
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-chat-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileView('chat')}
          className="lg:hidden"
          aria-label="Back to chat"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-lg font-semibold text-white">Information</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isDM && otherUser && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <Avatar
                name={otherUser.username}
                size="xl"
                status={otherUser.status === 'typing' ? 'online' : otherUser.status}
              />
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold text-white truncate">{otherUser.username}</p>
                <p className="text-sm">
                  {otherUser.status === 'online' || otherUser.status === 'typing' ? (
                    <span className="flex items-center gap-1 text-green-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      Online
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-white/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                      Offline
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-chat-border space-y-3">
              <InfoRow label="Local IP" value={otherUser.ipAddress || 'Unknown'} icon={Wifi} />
              <InfoRow label="Connection" value="Local Network" icon={Shield} />
              <InfoRow
                label="Last Seen"
                value={otherUser.lastSeen ? formatTimestamp(otherUser.lastSeen) : 'Unknown'}
                icon={Info}
              />
            </div>

            <div className="pt-4 border-t border-chat-border space-y-2">
              <Button
                variant="danger"
                className="w-full justify-start"
                onClick={() => handleBlockToggle(otherUser.id, otherUser.username)}
              >
                <Shield className="w-4 h-4 mr-2" />
                {blocked.has(otherUser.id) ? 'Unblock User' : 'Block User'}
              </Button>
            </div>
          </div>
        )}

        {room && !isDM && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-white/70 uppercase tracking-wider mb-3">
                Members ({roomUsers.length || room.members.length})
              </h3>
              <div className="space-y-2">
                {(roomUsers.length ? roomUsers : []).map((u: User) => (
                  <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                    <Avatar
                      name={u.username}
                      size="sm"
                      status={u.status === 'typing' ? 'online' : u.status}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">
                        {u.username}{' '}
                        {u.id === user?.id && <span className="text-xs text-white/40">(you)</span>}
                      </p>
                      <p className="text-xs text-white/50">
                        {u.status === 'typing' ? 'typing…' : u.status === 'online' ? 'Online' : 'Offline'}
                      </p>
                    </div>
                  </div>
                ))}
                {roomUsers.length === 0 && (
                  <p className="text-sm text-white/40">
                    {room.members.length} member{room.members.length === 1 ? '' : 's'} (some offline)
                  </p>
                )}
              </div>
            </div>

            {invitableUsers.length > 0 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-white/70 uppercase tracking-wider mb-3">
                    Add members
                  </h3>
                  <div className="space-y-2">
                    {invitableUsers.map((u: User) => (
                      <div key={u.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                        <Avatar
                          name={u.username}
                          size="sm"
                          status={u.status === 'typing' ? 'online' : u.status}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-white truncate">{u.username}</p>
                          <p className="text-xs text-white/50">
                            {u.status === 'typing' ? 'typing…' : u.status === 'online' ? 'Online' : 'Offline'}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => websocketService.addRoomMembers(room.id, [u.id])}
                          aria-label={`Add ${u.username} to ${room.name}`}
                          title={`Add ${u.username}`}
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-chat-border space-y-3">
              <InfoRow label="Room Name" value={room.name} icon={Info} />
              <InfoRow label="Type" value={room.isPrivate ? 'Private' : 'Public'} icon={Shield} />
              <InfoRow label="Created" value={formatTimestamp(room.createdAt)} icon={Info} />
              <InfoRow label="Server" value={websocketService.serverUrl || 'local'} icon={Wifi} />
            </div>

            {canManageRoom && (
              <div className="pt-4 border-t border-chat-border space-y-2">
                {renameDraft === null ? (
                  <Button
                    variant="secondary"
                    className="w-full justify-start"
                    onClick={() => setRenameDraft(room.name)}
                  >
                    <Pencil className="w-4 h-4 mr-2" />
                    Rename Room
                  </Button>
                ) : (
                  <div className="flex gap-2">
                    <input
                      value={renameDraft}
                      autoFocus
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveRoomName();
                        if (e.key === 'Escape') setRenameDraft(null);
                      }}
                      maxLength={60}
                      aria-label="Room name"
                      className="flex-1 min-w-0 px-3 py-2 bg-white/5 border border-white/20 rounded-lg text-white text-sm focus:outline-none"
                    />
                    <Button variant="secondary" onClick={handleSaveRoomName}>
                      Save
                    </Button>
                  </div>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-chat-border space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={handleLeaveRoom}>
                <LogOut className="w-4 h-4 mr-2" />
                Leave Room
              </Button>
              {canDeleteRoom && (
                <Button variant="danger" className="w-full justify-start" onClick={handleDeleteRoom}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Room
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-chat-border space-y-2">
          <Button variant="danger" className="w-full justify-start" onClick={handleClearChat}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Chat History
          </Button>
        </div>
      </div>
    </div>
  );
};

const InfoRow: React.FC<{
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}> = ({ label, value, icon: Icon }) => (
  <div className="flex items-center gap-3">
    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-white/50" />
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-xs text-white/40 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-white truncate">{value}</p>
    </div>
  </div>
);
