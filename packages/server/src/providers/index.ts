import { ModelProvider } from './ModelProvider';
import { OllamaProvider } from './OllamaProvider';

const registry: Record<string, ModelProvider> = {
  ollama: new OllamaProvider(),
};

export function getProvider(name: string): ModelProvider {
  return registry[name] ?? registry['ollama'];
}
