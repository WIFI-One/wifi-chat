import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Send, Paperclip, Smile, MoreVertical, Download, Pencil, Trash2, MessageSquare, Users, X, Play, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { ScrollArea, type ScrollAreaHandle } from '../ui/ScrollArea';
import { Avatar } from '../ui/Avatar';
import {
  useAuthStore,
  useRoomsStore,
  useMessagesStore,
  useUsersStore,
  useUIStore
} from '../../context/stores';
import { websocketService, fileToDataUrl } from '../../services/websocket';
import { getDmPeerId, resolveDmPeerName } from '../../utils/dm';
import { formatTime, debounce } from '../../services/crypto';
import { Message, Room, User, ServerPayload } from '@wifichat/shared/types';

const EMOJIS = ['😀', '😂', '😍', '👍', '👏', '🙏', '🔥', '🎉', '🤔', '😢', '😮', '❤️', '✅', '❌', '👋', '🎮', '🍕', '⚽', '🌙', '☀️', '💡', '🚀'];

export const ChatArea: React.FC = () => {
  const { user } = useAuthStore();
  const { rooms, activeRoomId } = useRoomsStore();
  const { messages } = useMessagesStore();
  const { users, typingUsers } = useUsersStore();
  const { infoPanelOpen, toggleInfoPanel, toggleSidebar, setMobileView } = useUIStore();

  const scrollAreaRef = useRef<ScrollAreaHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messageText, setMessageText] = useState('');
  const [pendingFile, setPendingFile] = useState<{ file: File; url: string } | null>(null);
  const [sendingFile, setSendingFile] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragCount = useRef(0);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [, forceRender] = useState(0);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<Message[]>([]);

  // Resolve `dm_<userId>` aliases to the real private room once created.
  useEffect(() => {
    return websocketService.onMessage((payload: ServerPayload) => {
      if (payload.type !== 'room_created') return;
      const active = useRoomsStore.getState().activeRoomId;
      if (!active?.startsWith('dm_')) return;
      const otherId = active.slice(3);
      const me = useAuthStore.getState().user?.id;
      if (payload.room.isPrivate && payload.room.members.includes(otherId) && payload.room.members.includes(me || '')) {
        useRoomsStore.getState().setActiveRoom(payload.room.id);
        websocketService.joinRoom(payload.room.id);
      }
    });
  }, []);

  const activeRoom = rooms.find((r: Room) => r.id === activeRoomId);
  // DM alias fallback: show the peer's info while the real room resolves.
  const dmPeer: User | undefined =
    !activeRoom && activeRoomId?.startsWith('dm_')
      ? users.find((u: User) => u.id === activeRoomId.slice(3))
      : undefined;
  const roomMessages = messages[activeRoomId || ''] || [];
  const visibleMessages = [
    ...roomMessages,
    ...pendingRef.current.filter((p) => p.roomId === activeRoomId)
  ].sort((a, b) => a.timestamp - b.timestamp);

  const typingSet = activeRoomId ? typingUsers[activeRoomId] : undefined;
  const typingNames = typingSet
    ? Array.from(typingSet)
        .map((id) => users.find((u) => u.id === id)?.username)
        .filter((n): n is string => !!n && n !== user?.username)
    : [];

  const debouncedTyping = useCallback(
    debounce((roomId: string, typing: boolean) => {
      websocketService.setTyping(roomId, typing);
    }, 300),
    []
  );

  // Reconcile optimistic messages when the server echo arrives.
  useEffect(() => {
    if (pendingRef.current.length === 0) return;
    const before = pendingRef.current.length;
    const echoedKeys = new Set(roomMessages.map((m) => `${m.senderId}|${m.content}`));
    pendingRef.current = pendingRef.current.filter(
      (p) =>
        !roomMessages.some((m) => m.id === p.id) &&
        !echoedKeys.has(`${p.senderId}|${p.content}`)
    );
    if (pendingRef.current.length !== before) forceRender((x) => x + 1);
  }, [roomMessages]);

  useEffect(() => {
    if (activeRoomId) {
      pendingRef.current = pendingRef.current.filter((p) => p.roomId === activeRoomId);
      websocketService.joinRoom(activeRoomId);
    }
    // A staged file belongs to its room — drop it on switch.
    setPendingFile((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    return () => {
      if (activeRoomId) websocketService.setTyping(activeRoomId, false);
    };
  }, [activeRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length]);

  const handleSend = () => {
    if (!activeRoomId || !user) return;

    // A staged file goes out with the send action (then the text, if any).
    if (pendingFile) {
      void handleSendFile();
    }

    const text = messageText.trim();
    if (!text) return;

    // Optimistic render; server echo (same content+sender) replaces it.
    const optimistic: Message = {
      id: `pending_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      roomId: activeRoomId,
      senderId: user.id,
      senderName: user.username,
      content: text,
      type: 'text',
      timestamp: Date.now(),
      status: 'sending'
    };
    pendingRef.current = [...pendingRef.current, optimistic];
    setMessageText('');

    websocketService.sendMessage(activeRoomId, text, 'text');
    setIsTyping(false);
    debouncedTyping(activeRoomId, false);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
  };

  const clearPendingFile = () => {
    if (pendingFile) URL.revokeObjectURL(pendingFile.url);
    setPendingFile(null);
  };

  const stageFile = (file: File) => {
    setAttachError(null);
    if (pendingFile) URL.revokeObjectURL(pendingFile.url);
    setPendingFile({ file, url: URL.createObjectURL(file) });
  };

  const handleAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeRoomId) return;
    // Stage the file for preview — it only sends when confirmed below.
    stageFile(file);
  };

  const handleSendFile = async () => {
    if (!pendingFile || !activeRoomId || sendingFile) return;
    setAttachError(null);
    setSendingFile(true);
    try {
      await websocketService.sendFile(activeRoomId, pendingFile.file);
      clearPendingFile();
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : 'Could not attach file.');
    } finally {
      setSendingFile(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessageText(e.target.value);
    if (!isTyping && activeRoomId) {
      setIsTyping(true);
      debouncedTyping(activeRoomId, true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      if (activeRoomId) debouncedTyping(activeRoomId, false);
    }, 2000);
  };

  if (!activeRoomId || (!activeRoom && !dmPeer)) {
    return (
      <div className="flex flex-col h-full bg-chat-bg">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-2">Welcome to WifiChat</h2>
            <p className="text-white/50">
              Select a conversation from the sidebar or create a new room to start messaging.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const roomPeerId = activeRoom ? getDmPeerId(activeRoom, user?.id) : null;
  const roomPeer = roomPeerId ? users.find((u: User) => u.id === roomPeerId) : undefined;
  const roomPeerName = activeRoom ? resolveDmPeerName(activeRoom, users, user?.id) : null;
  const title = dmPeer?.username || roomPeerName || activeRoom?.name || 'Chat';
  const onlineSubtitle = (u: User) =>
    u.status === 'online' || u.status === 'typing' ? 'Online • local network' : 'Offline';
  const subtitle = dmPeer
    ? onlineSubtitle(dmPeer)
    : roomPeerId
      ? roomPeer
        ? onlineSubtitle(roomPeer)
        : 'Offline'
      : `${activeRoom?.members.length || 0} member${(activeRoom?.members.length || 0) === 1 ? '' : 's'} • local network`;
  const isDM = !!dmPeer || (activeRoom?.id.startsWith('dm_') ?? false);

  return (
    <div
      className="flex flex-col h-full bg-chat-bg relative"
      onDragEnter={(e) => {
        e.preventDefault();
        dragCount.current++;
        if (e.dataTransfer.types.includes('Files')) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCount.current--;
        if (dragCount.current <= 0) {
          dragCount.current = 0;
          setDragging(false);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCount.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && activeRoomId) stageFile(file);
      }}
    >
      {dragging && activeRoomId && (
        <div className="absolute inset-0 z-10 m-2 flex items-center justify-center rounded-xl border-2 border-dashed border-white/30 bg-black/60 pointer-events-none">
          <p className="font-medium text-white">Drop file to attach</p>
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-chat-border bg-chat-panel/50">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden"
          onClick={() => setMobileView('chats')}
          aria-label="Back to conversations"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>

        {isDM || dmPeer ? (
          <Avatar
            name={title}
            size="md"
            status={dmPeer ? (dmPeer.status === 'typing' ? 'online' : dmPeer.status) : undefined}
          />
        ) : (
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold text-white/80">
              {title.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <p className="font-medium text-white truncate">{title}</p>
          <p className="text-xs text-white/50 truncate">{subtitle}</p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            aria-label="Show conversations"
            title="Conversations"
          >
            <MessageSquare className="w-5 h-5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={toggleInfoPanel}
            aria-label={infoPanelOpen ? 'Hide info panel' : 'Show info panel'}
            title="Info panel"
          >
            <Users className="w-5 h-5" />
          </Button>

          <div className="w-8 h-8 rounded-full bg-white/10 hidden sm:flex items-center justify-center ml-1 flex-shrink-0">
            <span className="text-sm font-semibold leading-none text-white/70">
              {user?.username?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.innerWidth < 1024) setMobileView('info');
            else toggleInfoPanel();
          }}
          aria-label={infoPanelOpen ? 'Hide info' : 'Show info'}
        >
          <MoreVertical className="w-5 h-5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollAreaRef}>
        {visibleMessages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isOwn={message.senderId === user?.id}
            isDM={isDM}
            showAvatar={index === 0 || visibleMessages[index - 1]?.senderId !== message.senderId}
            showTime={
              index === visibleMessages.length - 1 ||
              visibleMessages[index + 1]?.senderId !== message.senderId
            }
          />
        ))}
        <div ref={messagesEndRef} />
      </ScrollArea>

      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-xs text-white/40 animate-pulse">
          {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
        </div>
      )}

      <div className="p-4 border-t border-chat-border bg-chat-panel/50 relative">
        {showEmojiPicker && (
          <div className="absolute bottom-full mb-2 left-4 p-3 bg-[#111] border border-white/10 rounded-xl grid grid-cols-8 gap-1 max-w-[320px]">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setMessageText((t) => t + e)}
                className="text-xl hover:bg-white/10 rounded p-1"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {attachError && <p className="text-xs text-red-400 mb-2">{attachError}</p>}
        {pendingFile && (
          <div className="relative mb-2 flex flex-col gap-1 p-2 rounded-xl bg-white/5 border border-white/10 w-fit max-w-[220px]">
            {sendingFile && (
              <div className="absolute inset-0 z-10 rounded-xl bg-black/50 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-white animate-spin" />
              </div>
            )}
            <div className="relative">
              {pendingFile.file.type.startsWith('image/') ? (
                <img
                  src={pendingFile.url}
                  alt={pendingFile.file.name}
                  className="img-checker max-h-32 max-w-[200px] rounded-lg object-cover"
                />
              ) : pendingFile.file.type.startsWith('video/') ||
                /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(pendingFile.file.name) ? (
                <div className="w-40 h-28 rounded-lg bg-black flex items-center justify-center">
                  <span className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center">
                    <Play className="w-6 h-6 ml-0.5" />
                  </span>
                </div>
              ) : (
                <div className="w-16 h-16 rounded-lg bg-white/10 flex items-center justify-center">
                  <Paperclip className="w-6 h-6 text-white/60" />
                </div>
              )}
              <button
                onClick={clearPendingFile}
                aria-label="Remove file"
                title="Remove"
                className="absolute -top-2 -right-2 p-1 rounded-full bg-neutral-700 text-white hover:bg-neutral-600 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-white truncate">{pendingFile.file.name}</p>
                <p className="text-[11px] text-white/40">{formatBytes(pendingFile.file.size)}</p>
              </div>
            </div>
          </div>
        )}
        <div className="flex-1 relative">
          <textarea
            value={messageText}
            onChange={handleTyping}
            onKeyDown={handleKeyDown}
            placeholder={activeRoom ? `Message ${activeRoom.name}…` : 'Message…'}
              className="w-full pl-20 pr-14 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/30 focus:outline-none focus:bg-white/10 resize-none transition-all duration-150 max-h-32 min-h-[48px]"
            rows={1}
            aria-label="Message input"
          />
          <div className="absolute left-2 top-2 flex items-center gap-0.5">
            <button
              onClick={() => setShowEmojiPicker((v) => !v)}
              aria-label="Emojis"
              title="Emojis"
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach file"
              title="Attach file"
              className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          </div>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleAttach} />
          <button
            onClick={handleSend}
            disabled={(!messageText.trim() && !pendingFile) || sendingFile}
            aria-label="Send message"
            title="Send"
            className="absolute right-2 top-2 p-2 rounded-full bg-white text-black hover:bg-neutral-300 disabled:opacity-40 disabled:hover:bg-white transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] text-white/30 mt-2">Enter to send • Shift+Enter for a new line</p>
      </div>
    </div>
  );
};

const VideoPlayer: React.FC<{ src: string; mimeType?: string; fileName?: string; fileSize?: number; className?: string }> = ({ src, mimeType, fileName, fileSize, className = '' }) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <a
        href={src}
        download={fileName || 'video'}
        className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white hover:bg-white/10 transition-colors max-w-[300px]"
      >
        <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
          <Play className="w-5 h-5 ml-0.5" />
        </span>
        <span className="min-w-0">
          <span className="block truncate">{fileName || 'Video'}</span>
          <span className="block text-[11px] text-white/50">
            Preview not supported{typeof fileSize === 'number' ? ` • ${formatBytes(fileSize)}` : ''} — tap to download
          </span>
        </span>
      </a>
    );
  }
  return (
    <div className={`relative w-fit min-w-[280px] group ${className}`}>
      <video
        controls
        preload="metadata"
        playsInline
        onError={() => setFailed(true)}
        className="w-full min-w-[280px] max-h-[440px] rounded-xl bg-black object-contain"
      >
        <source src={src} type={mimeType || undefined} />
      </video>
    </div>
  );
};

// Mime types browsers can reliably play inline in a <video> tag.
// Everything else video/* (quicktime/mov, avi, mkv, ...) shows only a
// black box / audio bar in some browsers, so render a download card instead.
const PLAYABLE_VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|ogg|m4v|mov|avi|mkv)$/i;

function dataUrlMime(content: string): string {
  const m = /^data:([^;,]+)/.exec(content);
  return (m?.[1] || '').split(';')[0].toLowerCase();
}

function messageVideoMime(message: Message): string {
  const meta = (message.metadata?.mimeType || '').split(';')[0].toLowerCase();
  if (meta.startsWith('video/')) return meta;
  const dataMime = dataUrlMime(message.content);
  if (dataMime.startsWith('video/')) return dataMime;
  return meta || dataMime;
}

function isVideoMessage(message: Message): boolean {
  if (message.metadata?.mimeType?.toLowerCase().startsWith('video/')) return true;
  if (message.content.startsWith('data:video/')) return true;
  if (message.content.startsWith('data:') && VIDEO_EXTENSIONS.test(message.metadata?.fileName || '')) return true;
  return false;
}

function isPlayableVideo(message: Message): boolean {
  if (!isVideoMessage(message)) return false;
  const mime = messageVideoMime(message);
  // Empty/unknown mime (e.g. octet-stream from a typeless file) — trust the
  // extension: mp4/webm/ogg play inline, mov/avi/mkv do not.
  if (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    const name = message.metadata?.fileName || '';
    return /\.(mp4|webm|ogv|ogg|m4v)$/i.test(name);
  }
  return PLAYABLE_VIDEO_MIMES.has(mime);
}

const MessageBubble: React.FC<{
  message: Message;
  isOwn: boolean;
  isDM: boolean;
  showAvatar: boolean;
  showTime: boolean;
}> = ({ message, isOwn, isDM, showAvatar, showTime }) => {
  const { users } = useUsersStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [showEditEmoji, setShowEditEmoji] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const editFileRef = useRef<HTMLInputElement>(null);
  const sender = users.find((u: User) => u.id === message.senderId);
  const senderName = sender?.username || message.senderName;
  const isImage = message.type === 'image' || (message.content.startsWith('data:image/'));
  const isVideo = isVideoMessage(message);
  const isPlayable = isPlayableVideo(message);
  const isFile = !isImage && !isVideo && (message.type === 'file' || message.content.startsWith('data:'));
  const isUnplayableVideo = isVideo && !isPlayable;
  const isMedia = isImage || isVideo || isFile;
  const isTextMsg = !isMedia;
  // Only delivered messages can be changed (no pending optimistic ones).
  const canChange = isOwn && !message.id.startsWith('pending_') && message.status !== 'sending';

  const saveEdit = () => {
    const text = draft.trim();
    setEditing(false);
    setShowEditEmoji(false);
    if (text && text !== message.content) {
      websocketService.editMessage(message.roomId, message.id, text);
    } else {
      setDraft(message.content);
    }
  };

  const startEdit = () => {
    setDraft(message.content);
    setEditError(null);
    setShowEditEmoji(false);
    setEditing(true);
  };

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || replacing) return;
    setEditError(null);
    setReplacing(true);
    try {
      const content = await fileToDataUrl(file);
      websocketService.editMessage(message.roomId, message.id, content, {
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type
      });
      setEditing(false);
      setShowEditEmoji(false);
    } catch {
      setEditError('Could not read file.');
    } finally {
      setReplacing(false);
    }
  };

  const handleDelete = () => {
    if (confirm('Delete this message for everyone?')) {
      websocketService.deleteMessage(message.roomId, message.id);
    }
  };

  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
      {showAvatar && !isOwn && <Avatar name={senderName} size="sm" />}
      {(!showAvatar || isOwn) && <div className="w-8 flex-shrink-0" />}

      <div className={`flex min-w-0 flex-1 flex-col max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && !isDM && showAvatar && (
          <p className="text-xs text-white/50 mb-1 px-1">{senderName}</p>
        )}

        <div className={editing || isMedia ? 'relative' : `group relative ${isOwn ? 'message-own' : 'message-other'}`}>
          {editing ? (
            isTextMsg ? (
              <div className="relative min-w-[220px]">
                {showEditEmoji && (
                  <div className="absolute bottom-full mb-2 left-0 p-2 bg-[#111] border border-white/10 rounded-xl grid grid-cols-8 gap-1 w-[240px] z-10">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setDraft((t) => t + e)}
                        className="text-lg hover:bg-white/10 rounded p-0.5"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  value={draft}
                  autoFocus
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    }
                    if (e.key === 'Escape') {
                      setEditing(false);
                      setDraft(message.content);
                    }
                  }}
                  rows={2}
                  maxLength={4000}
                  aria-label="Edit message"
                  className="w-full pl-[68px] pr-12 py-2 bg-white text-black rounded-xl text-sm placeholder:text-black/40 focus:outline-none resize-none"
                  placeholder="Edit message…"
                />
                <div className="absolute left-1.5 top-2 flex items-center gap-0.5">
                  <button
                    onClick={() => setShowEditEmoji((v) => !v)}
                    aria-label="Emojis"
                    title="Emojis"
                    className="p-1.5 rounded-lg text-black/50 hover:text-black hover:bg-black/10 transition-colors"
                  >
                    <Smile className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => editFileRef.current?.click()}
                    disabled={replacing}
                    aria-label="Replace with file"
                    title="Replace with file"
                    className="p-1.5 rounded-lg text-black/50 hover:text-black hover:bg-black/10 transition-colors disabled:opacity-50"
                  >
                    {replacing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Paperclip className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <input ref={editFileRef} type="file" className="hidden" onChange={handleReplaceFile} />
                <button
                  onClick={saveEdit}
                  aria-label="Send edit"
                  title="Send"
                  className="absolute right-1.5 top-2 p-2 rounded-full bg-black text-white hover:bg-neutral-800 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
                {editError && <p className="text-[11px] text-red-400 mt-1">{editError}</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-1 min-w-[200px]">
                {isImage && (
                  <img src={message.content} alt={message.metadata?.fileName || 'Shared image'} className="img-checker rounded-xl max-w-[220px] max-h-[200px] object-cover" />
                )}
                {isVideo && isPlayable && (
                  <VideoPlayer src={message.content} mimeType={messageVideoMime(message) || undefined} fileName={message.metadata?.fileName} fileSize={message.metadata?.fileSize} className="max-w-[300px]" />
                )}
                {(isUnplayableVideo || isFile) && (
                  <div className="flex items-center gap-2 text-sm text-white">
                    {isUnplayableVideo ? <Play className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                    {message.metadata?.fileName || 'Download file'}
                  </div>
                )}
                <p className="text-xs text-white/70 truncate max-w-[220px]">
                  {message.metadata?.fileName || 'Attachment'}
                </p>
                {editError && <p className="text-[11px] text-red-400">{editError}</p>}
                <div className="flex gap-1">
                  <button
                    onClick={() => editFileRef.current?.click()}
                    disabled={replacing}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/10 text-xs text-white hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {replacing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Paperclip className="w-3.5 h-3.5" />
                    )}
                    Replace file
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-2 py-1 rounded-lg bg-white/10 text-xs text-white hover:bg-neutral-700 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <input ref={editFileRef} type="file" className="hidden" onChange={handleReplaceFile} />
              </div>
            )
          ) : isImage ? (
            <a href={message.content} download={message.metadata?.fileName || 'image'} target="_blank" rel="noreferrer">
              <img src={message.content} alt={message.metadata?.fileName || 'Shared image'} className="img-checker rounded-xl max-w-[280px] max-h-[280px] object-cover" />
            </a>
          ) : isVideo ? (
            <VideoPlayer src={message.content} className="max-w-[440px]" />
          ) : isFile ? (
            <a
              href={message.content}
              download={message.metadata?.fileName || 'file'}
              className="flex items-center gap-2 text-sm underline underline-offset-2"
            >
              <Download className="w-4 h-4" />
              {message.metadata?.fileName || 'Download file'}
              {typeof message.metadata?.fileSize === 'number' && (
                <span className="text-xs opacity-60">({formatBytes(message.metadata.fileSize)})</span>
              )}
            </a>
          ) : (
            <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
          )}

          {canChange && !editing && (
            <span
              className={`absolute top-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${
                isOwn ? '-left-3 -translate-x-full' : '-right-3 translate-x-full'
              }`}
            >
              {canChange && (
                <button
                  onClick={startEdit}
                  aria-label="Edit message"
                  title="Edit"
                  className="p-1 rounded hover:bg-neutral-700 text-white/60 hover:text-white"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={handleDelete}
                aria-label="Delete message"
                title="Delete"
                className="p-1 rounded hover:bg-neutral-700 text-white/60 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>

        {showTime && (
          <span className="mt-1 px-1 text-[10px] text-white/40 whitespace-nowrap">
            {formatTime(message.timestamp)}
            {message.edited && <span className="ml-1">(edited)</span>}
            {isOwn && (
              <span className="ml-1" aria-label={message.status}>
                {message.status === 'sending' ? '…' : message.status === 'failed' ? '!' : '✓✓'}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
