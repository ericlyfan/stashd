import { Router } from 'express';
import { ManifestService } from '../services/ManifestService';
import { buildCustomCategory, slugifyCategory } from '../services/categoryStyle';

export function createCategoryRoutes(services: { manifestService: ManifestService }): Router {
  const { manifestService } = services;
  const router = Router();

  router.get('/', (_req, res) => {
    const categories = manifestService.getCategories();
    const documents = manifestService.getDocuments();
    const result = categories
      .map(cat => ({
        ...cat,
        documentCount: documents.filter(d => d.category === cat.id).length,
      }))

    res.json(result);
  });

  // POST /api/categories — create a drawer by name; icon/color are auto-assigned.
  router.post('/', async (req, res) => {
    const { name } = req.body as { name?: string };
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const id = slugifyCategory(name);
    if (manifestService.getCategory(id)) {
      return res.status(409).json({ error: 'That category already exists' });
    }
    const category = buildCustomCategory(id);
    manifestService.addCategory(category);
    await manifestService.save();
    res.status(201).json({ ...category, documentCount: 0 });
  });

  // PATCH /api/categories/:id — rename or restyle a drawer; the slug stays
  // stable so documents never need rewriting.
  router.patch('/:id', async (req, res) => {
    const cat = manifestService.getCategory(req.params.id);
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

    if (name !== undefined) cat.name = name.trim();
    if (icon !== undefined) cat.icon = icon;
    if (color !== undefined) cat.color = color;
    await manifestService.save();

    const documentCount = manifestService.getDocuments().filter(d => d.category === cat.id).length;
    res.json({ ...cat, documentCount });
  });

  // DELETE /api/categories/:id — only custom, empty drawers can be removed.
  router.delete('/:id', async (req, res) => {
    const cat = manifestService.getCategory(req.params.id);
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    if (!cat.isCustom) {
      return res.status(400).json({ error: 'Built-in categories can’t be removed' });
    }
    const count = manifestService.getDocuments().filter(d => d.category === cat.id).length;
    if (count > 0) {
      return res.status(400).json({
        error: `Move or delete ${count} document${count === 1 ? '' : 's'} in this drawer first`,
      });
    }
    manifestService.removeCategory(cat.id);
    await manifestService.save();
    res.status(204).end();
  });

  return router;
}
