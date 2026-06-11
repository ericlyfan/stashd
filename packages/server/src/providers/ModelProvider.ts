import { Category, ClassificationResult, DocumentInput } from '@stashd/shared';

export interface ModelProvider {
  classify(doc: DocumentInput, existingCategories: Category[]): Promise<ClassificationResult>;
}
