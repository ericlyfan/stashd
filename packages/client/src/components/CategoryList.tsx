import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { CategoryWithCount, listCategories } from '../api/client';

function CategoryIcon({ name }: { name: string }) {
  const iconName = name
    .split('-')
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
  const Icon = (Icons as unknown as Record<string, Icons.LucideIcon | undefined>)[iconName];
  return Icon ? <Icon className="w-4 h-4" /> : <Icons.Folder className="w-4 h-4" />;
}

export default function CategoryList() {
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);

  useEffect(() => {
    listCategories().then(setCategories).catch(console.error);
  }, []);

  return (
    <nav className="mt-2 space-y-0.5">
      {categories.map(cat => (
        <NavLink
          key={cat.id}
          to={`/category/${cat.id}`}
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? 'bg-teal-50 text-teal-700 font-medium'
                : 'text-stone-600 hover:bg-stone-100'
            }`
          }
        >
          <span style={{ color: cat.color }}>
            <CategoryIcon name={cat.icon} />
          </span>
          <span className="flex-1 truncate">{cat.name}</span>
          {cat.documentCount > 0 && (
            <span className="text-xs text-stone-400">{cat.documentCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
