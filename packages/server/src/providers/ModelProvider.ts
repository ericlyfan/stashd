import { ClassificationResult, DocumentInput } from '@stashd/shared';

export interface ModelProvider {
  classify(doc: DocumentInput): Promise<ClassificationResult>;
}
