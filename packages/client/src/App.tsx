import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import CategoryView from './pages/CategoryView';
import DocumentDetail from './pages/DocumentDetail';
import SearchResults from './pages/SearchResults';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="category/:id" element={<CategoryView />} />
          <Route path="document/:id" element={<DocumentDetail />} />
          <Route path="search" element={<SearchResults />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
