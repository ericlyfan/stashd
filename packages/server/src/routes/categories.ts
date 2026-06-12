import { Router } from 'express';
import { StoreService } from '../services/StoreService';
import { buildCustomCategory, slugifyCategory } from '../services/categoryStyle';

export function createCategoryRoutes(services: { store: StoreService }): Router {
  const { store } = services;
  const router = Router();

  router.get('/', (_req, res) => {
    const counts = store.getCategoryCounts();
    res.json(store.getCategories().map(cat => ({ ...cat, documentCount: counts[cat.id] ?? 0 })));
  });

  // POST /api/categories — create a drawer by name; icon/color are auto-assigned.
  router.post('/', (req, res) => {
    const { name } = req.body as { name?: string };
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const id = slugifyCategory(name);
    if (store.getCategory(id)) {
      return res.status(409).json({ error: 'That category already exists' });
    }
    const category = buildCustomCategory(id);
    store.addCategory(category);
    res.status(201).json({ ...category, documentCount: 0 });
  });

  // PATCH /api/categories/:id — rename or restyle a drawer; the slug stays
  // stable so documents never need rewriting.
  router.patch('/:id', (req, res) => {
    const cat = store.getCategory(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });

    const { name, icon, color } = req.body as { name?: string; icon?: string; color?: string };
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return res.status(400).json({ error: 'Name can’t be blank' });
    }
    if (icon !== undefined && typeof icon !== 'string') {
      return res.status(400).json({ error: 'Invalid icon' });
    }
    if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) {
      return res.status(400).json({ error: 'Color must be a #rrggbb hex value' });
    }

    const updated = store.updateCategory(cat.id, {
      ...(name !== undefined && { name: name.trim() }),
      ...(icon !== undefined && { icon }),
      ...(color !== undefined && { color }),
    });

    const documentCount = store.getCategoryCounts()[cat.id] ?? 0;
    res.json({ ...updated, documentCount });
  });

  // DELETE /api/categories/:id — only custom, empty drawers can be removed.
  router.delete('/:id', (req, res) => {
    const cat = store.getCategory(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    if (!cat.isCustom) {
      return res.status(400).json({ error: 'Built-in categories can’t be removed' });
    }
    const count = store.getCategoryCounts()[cat.id] ?? 0;
    if (count > 0) {
      return res.status(400).json({
        error: `Move or delete ${count} document${count === 1 ? '' : 's'} in this drawer first`,
      });
    }
    store.removeCategory(cat.id);
    res.status(204).end();
  });

  return router;
}
