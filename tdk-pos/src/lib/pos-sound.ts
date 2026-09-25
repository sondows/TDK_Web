const CLICK_SOUND_URL = "/sounds/pos-click.wav";
const POS_SOUND_VOLUME = 0.4;
const CLICK_AUDIO_POOL_SIZE = 4;

let clickAudioPool: HTMLAudioElement[] = [];
let nextClickAudioIndex = 0;
let hasUserGesture = false;
let lastClickAt = 0;

function hasActiveUserGesture() {
  if (typeof navigator === "undefined" || !navigator.userActivation) return hasUserGesture;
  return navigator.userActivation.isActive;
}

function createClickAudio(): HTMLAudioElement {
  const audio = new Audio(CLICK_SOUND_URL);
  audio.preload = "auto";
  audio.volume = POS_SOUND_VOLUME;
  audio.muted = false;
  audio.load();
  return audio;
}

function getClickAudioPool(): HTMLAudioElement[] {
  if (typeof window === "undefined" || typeof Audio === "undefined") return [];

  if (clickAudioPool.length === 0) {
    clickAudioPool = Array.from({ length: CLICK_AUDIO_POOL_SIZE }, createClickAudio);
  }

  return clickAudioPool;
}

/** Initializes the reusable click-sound pool without playing audio. */
export function preloadPosClickSound() {
  getClickAudioPool();
}

/** Must be called synchronously from a real pointer, touch, click, or key event. */
export function unlockPosClickSound() {
  hasUserGesture = true;
  getClickAudioPool();
}

async function playClickAudio(): Promise<boolean> {
  const pool = getClickAudioPool();
  if (pool.length === 0) {
    console.error("[POS SOUND] play failed:", new Error("HTMLAudioElement is unavailable."));
    return false;
  }

  const audioIndex = nextClickAudioIndex;
  nextClickAudioIndex = (nextClickAudioIndex + 1) % pool.length;
  let audio = pool[audioIndex];

  // A WAV file may be added while the POS page is already open. Replace a
  // pool entry that previously failed to load so the next click retries it.
  if (audio.error) {
    audio = createClickAudio();
    pool[audioIndex] = audio;
  }

  try {
    console.log("[POS SOUND] click requested");
    console.log("[POS SOUND] src:", audio.currentSrc || audio.src || CLICK_SOUND_URL);
    console.log("[POS SOUND] readyState:", audio.readyState);
    console.log("[POS SOUND] volume:", audio.volume);
    console.log("[POS SOUND] muted:", audio.muted);
    audio.currentTime = 0;
    const playback = audio.play();
    await playback;
    console.log("[POS SOUND] play success");
    return true;
  } catch (error) {
    // An autoplay rejection is expected outside a browser user gesture. It is
    // intentionally ignored rather than surfaced as a Next.js console error.
    if (!(error instanceof DOMException && error.name === "NotAllowedError")) console.error("[POS SOUND] play failed:", error);
    return false;
  }
}

/** Plays one short WAV click using a small reusable pool for rapid touch input. */
export function playPosClickSound() {
  if (!hasUserGesture || !hasActiveUserGesture()) return Promise.resolve(false);
  const now = performance.now();
  if (now - lastClickAt < 18) return Promise.resolve(false);
  lastClickAt = now;
  return playClickAudio();
}

/** Temporary diagnostic trigger for the same WAV file used by POS buttons. */
export async function playPosSoundTest() {
  unlockPosClickSound();
  console.log("[POS SOUND] click requested");
  void fetch(CLICK_SOUND_URL)
    .then(response => console.log("[POS SOUND] fetch:", { status: response.status, contentType: response.headers.get("content-type"), contentLength: response.headers.get("content-length") }))
    .catch(error => console.error("[POS SOUND] fetch failed:", error));

  // Intentionally bypass the pool for diagnosis. This is the smallest
  // possible HTMLAudioElement playback path from a user click.
  const audio = new Audio(CLICK_SOUND_URL);
  audio.preload = "auto";
  audio.volume = 1;
  audio.muted = false;
  audio.addEventListener("error", () => console.error("[POS SOUND] audio element error:", audio.error));
  console.log("[POS SOUND] src:", audio.src);
  console.log("[POS SOUND] currentSrc:", audio.currentSrc);
  console.log("[POS SOUND] readyState:", audio.readyState);
  console.log("[POS SOUND] networkState:", audio.networkState);
  console.log("[POS SOUND] volume:", audio.volume);
  console.log("[POS SOUND] muted:", audio.muted);
  console.log("[POS SOUND] error:", audio.error);

  try {
    audio.currentTime = 0;
    await audio.play();
    console.log("[POS SOUND] play success");
    return true;
  } catch (error) {
    console.error("[POS SOUND] play failed:", error, "media error:", audio.error);
    return false;
  }
}

export function playPosSuccessSound() {}
export function playPosErrorSound() {}
