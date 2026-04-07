import { open } from "@tauri-apps/plugin-dialog";

export async function pickProjectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Project",
  });
  return selected;
}

export async function pickTextFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    title: "Open Text File",
  });
  return typeof selected === "string" ? selected : null;
}
