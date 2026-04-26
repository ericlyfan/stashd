import { NavLink } from 'react-router-dom';
import { Home } from 'lucide-react';
import SearchBar from './SearchBar';
import CategoryList from './CategoryList';

export default function Sidebar() {
  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-stone-200 bg-white px-3 py-4 overflow-y-auto">
      <div className="px-2 mb-4">
        <h1 className="text-2xl font-bold text-stone-800">Stashd</h1>
        <p className="text-xs text-stone-400 mt-0.5">Your document inbox</p>
      </div>

      <SearchBar />

      <div className="mt-4">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-600 hover:bg-stone-100'
            }`
          }
        >
          <Home className="w-4 h-4" />
          <span>Dashboard</span>
        </NavLink>
      </div>

      <div className="mt-4">
        <p className="px-3 mb-1 text-xs font-medium text-stone-400 uppercase tracking-wider">Categories</p>
        <CategoryList />
      </div>
    </aside>
  );
}
