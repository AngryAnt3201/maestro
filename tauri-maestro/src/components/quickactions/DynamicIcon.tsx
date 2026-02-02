import type { LucideProps } from "lucide-react";
import {
  ArrowUpCircle,
  Bell,
  Binary,
  Bookmark,
  Braces,
  Bug,
  CheckCircle,
  Circle,
  Code,
  FileText,
  Flag,
  Folder,
  GitBranch,
  GitCommit,
  Hammer,
  Heart,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Send,
  Settings,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Trash2,
  Wand2,
  Wrench,
  XCircle,
  Zap,
} from "lucide-react";

/** Map of icon names to their components */
const iconMap: Record<string, React.ComponentType<LucideProps>> = {
  ArrowUpCircle,
  Bell,
  Binary,
  Bookmark,
  Braces,
  Bug,
  CheckCircle,
  Circle,
  Code,
  FileText,
  Flag,
  Folder,
  GitBranch,
  GitCommit,
  Hammer,
  Heart,
  Mail,
  MessageSquare,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Send,
  Settings,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Trash2,
  Wand2,
  Wrench,
  XCircle,
  Zap,
};

interface DynamicIconProps extends Omit<LucideProps, "ref"> {
  /** The name of the Lucide icon to render (e.g., "Play", "Star") */
  name: string;
}

/**
 * Renders a Lucide icon by its name string.
 * Falls back to Circle if the icon name is not found.
 */
export function DynamicIcon({ name, ...props }: DynamicIconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    return <Circle {...props} />;
  }

  return <IconComponent {...props} />;
}
