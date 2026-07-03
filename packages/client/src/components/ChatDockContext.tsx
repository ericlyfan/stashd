import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Shared open/active state for the floating chat dock. Lives above <Routes> (in
// App.tsx) so the panel and its conversation survive page navigation, and so
// the sidebar / launcher can open it from anywhere.
interface ChatDockState {
  open: boolean;
  activeConvId?: string;
  // Open the dock, optionally jumping to a specific conversation.
  openDock: (convId?: string) => void;
  close: () => void;
  setActiveConvId: (id?: string) => void;
}

const ChatDockContext = createContext<ChatDockState | null>(null);

export function ChatDockProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(undefined);

  const openDock = useCallback((convId?: string) => {
    if (convId !== undefined) setActiveConvId(convId);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<ChatDockState>(
    () => ({ open, activeConvId, openDock, close, setActiveConvId }),
    [open, activeConvId, openDock, close],
  );

  return <ChatDockContext.Provider value={value}>{children}</ChatDockContext.Provider>;
}

export function useChatDock(): ChatDockState {
  const ctx = useContext(ChatDockContext);
  if (!ctx) throw new Error('useChatDock must be used inside <ChatDockProvider>');
  return ctx;
}
