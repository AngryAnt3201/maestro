import { type TamagotchiMood } from "@/lib/usageParser";

interface TamagotchiCharacterProps {
  mood: TamagotchiMood;
  size?: number;
}

/** Map mood to image state number */
const MOOD_TO_STATE: Record<TamagotchiMood, number> = {
  sleeping: 0,
  hungry: 1,
  bored: 2,
  content: 3,
  happy: 4,
  ecstatic: 4, // No state 5, use state 4
};

/** Animation class for each mood state. */
const MOOD_ANIMATIONS: Record<TamagotchiMood, string> = {
  sleeping: "",
  hungry: "animate-tama-hungry",
  bored: "animate-tama-droop",
  content: "animate-breathe",
  happy: "animate-tama-float",
  ecstatic: "animate-tama-bounce",
};

/**
 * Tamagotchi character component.
 * Uses custom images from /public/tamagotchi/usage_state_N.png
 */
export function TamagotchiCharacter({
  mood,
  size = 32,
}: TamagotchiCharacterProps) {
  const stateNum = MOOD_TO_STATE[mood];
  const imagePath = `/tamagotchi/usage_state_${stateNum}.png`;
  const animClass = MOOD_ANIMATIONS[mood];

  return (
    <div className={`${animClass} transition-all duration-500`}>
      <img
        src={imagePath}
        alt={`Tamagotchi ${mood}`}
        width={size}
        height={size}
        className="object-contain"
        style={{ imageRendering: "pixelated" }}
      />
    </div>
  );
}

