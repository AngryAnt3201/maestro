import { invoke } from "@tauri-apps/api/core";

export interface OpenTextFileResponse {
  path: string;
  content: string;
}

export async function readTextFile(filePath: string): Promise<OpenTextFileResponse> {
  return invoke<OpenTextFileResponse>("read_text_file", { filePath });
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await invoke("write_text_file", { filePath, content });
}
