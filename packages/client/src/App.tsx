import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { StoreProvider } from './store';
import Sidebar from './components/Sidebar';
import { GlobalDropCurtain } from './components/DropZone';
import ReviewSheet from './components/ReviewSheet';
import UploadTray from './components/UploadTray';
import Toasts from './components/Toasts';
import { ChatDockProvider } from './components/ChatDockContext';
import { ChatDock, ChatLauncher } from './components/ChatDock';
import InboxPage from './pages/InboxPage';
import AllDocsPage from './pages/AllDocsPage';
import CategoryPage from './pages/CategoryPage';
import DocumentPage from './pages/DocumentPage';
import SearchPage from './pages/SearchPage';
import ChatPage from './pages/ChatPage';
import LedgersPage from './pages/LedgersPage';
import LedgerPage from './pages/LedgerPage';
import PortfolioPage from './pages/PortfolioPage';
import StockPage from './pages/StockPage';
import ApplicationsPage from './pages/ApplicationsPage';

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.querySelector('.main')?.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <StoreProvider>
      <ChatDockProvider>
        <div className="shell">
          <Sidebar />
          <main className="main">
            <ScrollReset />
            <Routes>
            <Route path="/" element={<InboxPage />} />
            <Route path="/all" element={<AllDocsPage />} />
            <Route path="/category/:id" element={<CategoryPage />} />
            <Route path="/doc/:id" element={<DocumentPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/chat/:id" element={<ChatPage />} />
            <Route path="/ledgers" element={<LedgersPage />} />
            <Route path="/ledger/:id" element={<LedgerPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/portfolio/:symbol" element={<StockPage />} />
            <Route path="/applications" element={<ApplicationsPage />} />
            <Route path="*" element={<InboxPage />} />
            </Routes>
          </main>
        </div>
        <GlobalDropCurtain />
        <ReviewSheet />
        <UploadTray />
        <ChatDock />
        <ChatLauncher />
        <Toasts />
      </ChatDockProvider>
    </StoreProvider>
  );
}
