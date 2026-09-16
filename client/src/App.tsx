import { useEffect, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { InfoPanel } from './components/layout/InfoPanel';
import { SidebarContent } from './components/sidebar/SidebarContent';
import { ChatArea } from './components/chat/ChatArea';
import { InfoPanelContent } from './components/infoPanel/InfoPanelContent';
import { useAuthStore, useRoomsStore, useUIStore } from './context/stores';
import { useIsMobile } from './hooks/useMediaQuery';
import { websocketService } from './services/websocket';
import { settingsStorage } from './services/storage';
import { resetUnreadBadge } from './services/notifications';

let appReconnectTried = false;

function App() {
  const { sidebarOpen, infoPanelOpen, mobileView } = useUIStore();
  const { activeRoomId } = useRoomsStore();
  const isMobile = useIsMobile();
  const reconnectRef = useRef(false);

  useEffect(() => {
    // Default panel visibility follows screen size.
    if (isMobile) {
      useUIStore.getState().setSidebarOpen(false);
      useUIStore.getState().setInfoPanelOpen(false);
    } else {
      useUIStore.getState().setSidebarOpen(true);
    }
  }, [isMobile]);

  useEffect(() => {
    // Page reload with a persisted login but a dead socket: reconnect and
    // re-authenticate so the user lands back in chat instead of a dead UI.
    // Same username signs straight back in as that name.
    if (reconnectRef.current || appReconnectTried) return;
    reconnectRef.current = true;
    appReconnectTried = true;
    const { user } = useAuthStore.getState();
    if (!user || websocketService.connected) return;
    const lastServer = settingsStorage.getLastServer();
    const lastUsername = settingsStorage.getLastUsername() || user.username;
    if (!lastServer || !lastUsername) return;
    // Drop the stale room selection; auth_ok auto-selects General.
    useRoomsStore.getState().setActiveRoom(null);
    const signIn = async (attempt: number): Promise<void> => {
      await websocketService.connect(lastServer);
      const authed = websocketService.waitForAuthResult();
      websocketService.auth(lastUsername);
      try {
        await authed;
      } catch (err) {
        // Tab closed and reopened quickly: the server may still see the old
        // session as alive. Wait for it to time out and try once more.
        const taken = err instanceof Error && /already in use/i.test(err.message);
        if (!taken || attempt > 1) throw err;
        await new Promise((r) => setTimeout(r, 4000));
        await signIn(attempt + 1);
      }
    };
    signIn(1).catch(() => {
      // Server unreachable — stay on the login screen with saved details.
      useAuthStore.getState().logout();
    });
  }, []);

  // Clear the unread title badge once the user is looking at the chat.
  useEffect(() => {
    resetUnreadBadge();
  }, [activeRoomId]);

  useEffect(() => {
    const onFocus = () => resetUnreadBadge();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <div className="h-screen w-full flex bg-chat-bg text-white overflow-hidden">
      <Sidebar isOpen={sidebarOpen} onClose={() => useUIStore.getState().setSidebarOpen(false)}>
        <SidebarContent />
      </Sidebar>

      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-hidden">
          {isMobile ? (
            <>
              {mobileView === 'chats' && <SidebarContent />}
              {mobileView === 'chat' && <ChatArea />}
              {mobileView === 'info' && <InfoPanelContent />}
            </>
          ) : (
            <ChatArea />
          )}
        </main>
      </div>

      {!isMobile && (
        <InfoPanel
          isOpen={infoPanelOpen}
          onClose={() => useUIStore.getState().setInfoPanelOpen(false)}
        >
          <InfoPanelContent />
        </InfoPanel>
      )}
    </div>
  );
}

export default App;
