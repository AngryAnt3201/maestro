import type { Job } from "@/types/ops";
export function JobRow({ job }: { job: Job }) {
  return <li className="px-3 py-1.5 text-[12px] text-maestro-text">{job.name}</li>;
}
