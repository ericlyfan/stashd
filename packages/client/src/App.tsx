import { useEffect, useState } from 'react';
import { Routes, Route, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AppProvider, useApp } from './state';
import { Toolbar, PrimaryButton, SearchField } from './components/chrome';
import { IconPlus } from './components/icons';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import CategoryPage from './pages/CategoryPage';
import DocumentDetail from './pages/DocumentDetail';
import SearchPage from './pages/SearchPage';

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { filePickerRef } = useApp();
  const [search, setSearch] = useState('');

  // On the dashboard the picker is live — open it directly. Anywhere else,
  // navigate home and let UploadZone open it on arrival.
  function handleAdd() {
    if (filePickerRef.current) {
      filePickerRef.current();
    } else {
      navigate('/', { state: { openPicker: true } });
    }
  }

  // Clear the search box when leaving the search page.
  useEffect(() => {
    if (!location.pathname.startsWith('/search')) setSearch('');
  }, [location.pathname]);

  return (
    <div style={{
      width: '100vw', height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg)',
      display: 'flex',
    }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          center={
            <SearchField
              value={search}
              onChange={setSearch}
              onSubmit={(q) => navigate(`/search?q=${encodeURIComponent(q)}`)}
            />
          }
          right={
            <PrimaryButton onClick={handleAdd}>
              <IconPlus size={14} />Add
            </PrimaryButton>
          }
        />
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/category/:id" element={<CategoryPage />} />
          <Route path="/document/:id" element={<DocumentDetail />} />
          <Route path="/search" element={<SearchPage />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
