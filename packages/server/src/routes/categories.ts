import { Router } from 'express';
import { ManifestService } from '../services/ManifestService';

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
      .filter(cat => cat.documentCount > 0);
    res.json(result);
  });

  return router;
}
