/**
 * Interface for Ollama model information from /api/tags
 */
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    format: string;
    family: string;
    families: string[] | null;
    parameter_size: string;
    quantization_level: string;
  };
}

/**
 * Interface for the Ollama API response
 */
interface OllamaTagsResponse {
  models: OllamaModel[];
}

/**
 * Fetches the list of installed models from the local Ollama daemon.
 * Defaults to http://localhost:11434 if no host/port provided.
 */
export async function fetchInstalledModels(host = "localhost", port = "11434"): Promise<OllamaModel[]> {
  try {
    const response = await fetch(`http://${host}:${port}/api/tags`);
    if (!response.ok) {
      throw new Error(`Ollama API returned ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as OllamaTagsResponse;
    return data.models || [];
  } catch (err) {
    console.error("Failed to fetch models from Ollama:", err);
    return [];
  }
}
