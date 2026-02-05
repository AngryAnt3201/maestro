/** Common GitHub discussion category emoji shortcodes mapped to unicode */
const EMOJI_MAP: Record<string, string> = {
  ":bulb:": "💡",
  ":speech_balloon:": "💬",
  ":mega:": "📣",
  ":pray:": "🙏",
  ":raised_hands:": "🙌",
  ":question:": "❓",
  ":bug:": "🐛",
  ":sparkles:": "✨",
  ":rocket:": "🚀",
  ":star:": "⭐",
  ":zap:": "⚡",
  ":bookmark:": "🔖",
  ":pencil:": "✏️",
  ":pencil2:": "✏️",
  ":memo:": "📝",
  ":tada:": "🎉",
  ":gift:": "🎁",
  ":heart:": "❤️",
  ":fire:": "🔥",
  ":warning:": "⚠️",
  ":bell:": "🔔",
  ":loudspeaker:": "📢",
  ":mailbox:": "📫",
  ":inbox_tray:": "📥",
  ":outbox_tray:": "📤",
  ":package:": "📦",
  ":dart:": "🎯",
  ":gem:": "💎",
  ":wrench:": "🔧",
  ":hammer:": "🔨",
  ":gear:": "⚙️",
  ":pushpin:": "📌",
  ":round_pushpin:": "📍",
  ":link:": "🔗",
  ":lock:": "🔒",
  ":unlock:": "🔓",
  ":key:": "🔑",
  ":shield:": "🛡️",
  ":eyes:": "👀",
  ":mag:": "🔍",
  ":clipboard:": "📋",
  ":page_facing_up:": "📄",
  ":file_folder:": "📁",
  ":open_file_folder:": "📂",
  ":books:": "📚",
  ":book:": "📖",
  ":bookmark_tabs:": "📑",
  ":label:": "🏷️",
  ":1234:": "🔢",
  ":abc:": "🔤",
  ":computer:": "💻",
  ":keyboard:": "⌨️",
  ":desktop_computer:": "🖥️",
  ":globe_with_meridians:": "🌐",
  ":earth_americas:": "🌎",
  ":earth_asia:": "🌏",
  ":earth_africa:": "🌍",
  ":thinking:": "🤔",
  ":thought_balloon:": "💭",
};

/**
 * Converts an emoji shortcode (e.g., ":bulb:") to its unicode character.
 * If already unicode or unknown shortcode, returns a fallback.
 */
export function parseEmoji(emoji: string | undefined, fallback = "💬"): string {
  if (!emoji) return fallback;

  // Already unicode (doesn't start with colon)
  if (!emoji.startsWith(":")) return emoji;

  // Look up in map
  return EMOJI_MAP[emoji] || fallback;
}
