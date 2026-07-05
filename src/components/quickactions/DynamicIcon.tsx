import type { LucideProps } from "lucide-react";
import ArrowUpCircle from "lucide-react/dist/esm/icons/arrow-up-circle";
import Bell from "lucide-react/dist/esm/icons/bell";
import Binary from "lucide-react/dist/esm/icons/binary";
import Bookmark from "lucide-react/dist/esm/icons/bookmark";
import Braces from "lucide-react/dist/esm/icons/braces";
import Bug from "lucide-react/dist/esm/icons/bug";
import CheckCircle from "lucide-react/dist/esm/icons/check-circle";
import Circle from "lucide-react/dist/esm/icons/circle";
import Code from "lucide-react/dist/esm/icons/code";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Flag from "lucide-react/dist/esm/icons/flag";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommit from "lucide-react/dist/esm/icons/git-commit-horizontal";
import Hammer from "lucide-react/dist/esm/icons/hammer";
import Heart from "lucide-react/dist/esm/icons/heart";
import Mail from "lucide-react/dist/esm/icons/mail";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Play from "lucide-react/dist/esm/icons/play";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Scissors from "lucide-react/dist/esm/icons/scissors";
import Send from "lucide-react/dist/esm/icons/send";
import Settings from "lucide-react/dist/esm/icons/settings";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Star from "lucide-react/dist/esm/icons/star";
import Tag from "lucide-react/dist/esm/icons/tag";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Wand2 from "lucide-react/dist/esm/icons/wand-2";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import Zap from "lucide-react/dist/esm/icons/zap";

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
