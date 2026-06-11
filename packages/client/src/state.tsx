import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Document } from '@stashd/shared';
import { CategoryWithCount, listCategories, listDocuments } from './api/client';

interface AppState {
  docs: Document[];
  categories: CategoryWithCount[];
  loading: boolean;
  refresh: () => Promise<void>;
  categoryById: (id?: string) => CategoryWithCount | undefined;
  // Set by UploadZone while mounted; lets the toolbar Add button open the
  // native file picker directly.
  filePickerRef: React.MutableRefObject<(() => void) | null>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [categories, setCategories] = useState<CategoryWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const filePickerRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, c] = await Promise.all([listDocuments(), listCategories()]);
      setDocs(d);
      setCategories(c);
    } catch (err) {
      console.error('Failed to load data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo<AppState>(() => ({
    docs,
    categories,
    loading,
    refresh,
    categoryById: (id?: string) => categories.find(c => c.id === id),
    filePickerRef,
  }), [docs, categories, loading, refresh]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
