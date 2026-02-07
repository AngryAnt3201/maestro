import { useEffect, useRef } from "react";

interface UseSwipeNavigationOptions {
  /** Called when user swipes left (navigate to next tab) */
  onSwipeLeft: () => void;
  /** Called when user swipes right (navigate to previous tab) */
  onSwipeRight: () => void;
  /** Whether swipe navigation is enabled (disable when < 2 tabs) */
  enabled?: boolean;
}

/** Single-event |deltaX| must exceed this to trigger a swipe */
const SWIPE_THRESHOLD = 15;
/**
 * Minimum cooldown after a swipe fires before we start watching for
 * momentum decay.  Absorbs the strongest initial momentum burst.
 */
const MIN_COOLDOWN_MS = 150;
/**
 * Once past the minimum cooldown we monitor incoming events.
 * When every event's |deltaX| drops below this value the momentum
 * has decayed and we unlock.
 */
const DECAY_THRESHOLD = 4;

/**
 * Detects trackpad horizontal two-finger swipe gestures via `wheel` events.
 *
 * After firing a swipe the hook blocks further triggers.
 * It unlocks when momentum has visibly decayed:
 *   1. A hard 150 ms cooldown absorbs the initial momentum burst.
 *   2. After that, each incoming event is checked — once |deltaX| < 4
 *      the momentum is considered over and the hook is ready again.
 *   3. If no events arrive for 200 ms (trackpad idle) it also unlocks.
 *
 * This adapts naturally to swipe strength: a gentle flick unlocks quickly,
 * while a hard swipe waits longer — but always as short as possible.
 */
export function useSwipeNavigation({ onSwipeLeft, onSwipeRight, enabled = true }: UseSwipeNavigationOptions): void {
  const state = useRef<"ready" | "cooldown" | "wait_decay">("ready");
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onSwipeLeftRef = useRef(onSwipeLeft);
  const onSwipeRightRef = useRef(onSwipeRight);
  onSwipeLeftRef.current = onSwipeLeft;
  onSwipeRightRef.current = onSwipeRight;

  useEffect(() => {
    if (!enabled) return;

    // Reset state in case a previous effect cycle left it mid-gesture
    state.current = "ready";

    function unlock() {
      state.current = "ready";
      if (cooldownTimer.current) { clearTimeout(cooldownTimer.current); cooldownTimer.current = null; }
      if (idleTimer.current) { clearTimeout(idleTimer.current); idleTimer.current = null; }
    }

    function handleWheel(event: WheelEvent) {
      if (state.current === "cooldown") return;

      if (state.current === "wait_decay") {
        // Reset idle timer on every event
        if (idleTimer.current) clearTimeout(idleTimer.current);
        idleTimer.current = setTimeout(unlock, 200);

        // Momentum decayed enough → unlock
        if (Math.abs(event.deltaX) < DECAY_THRESHOLD) {
          unlock();
          // Don't process this event — it's the tail of the old gesture
        }
        return;
      }

      // state === "ready"
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 2) return;

      if (event.deltaX > SWIPE_THRESHOLD) {
        onSwipeLeftRef.current();
      } else if (event.deltaX < -SWIPE_THRESHOLD) {
        onSwipeRightRef.current();
      } else {
        return;
      }

      // Fire → enter cooldown → then wait for decay
      state.current = "cooldown";
      cooldownTimer.current = setTimeout(() => {
        state.current = "wait_decay";
        // If trackpad already idle by this point, unlock via timer
        idleTimer.current = setTimeout(unlock, 200);
      }, MIN_COOLDOWN_MS);
    }

    window.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [enabled]);
}
