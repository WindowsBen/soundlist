// ================== EMOTES ==================
// Fetches active emote sets from 7TV for each streamer and
// merges in any manual overrides from lists/overrides/{username}.json.
//
// 7TV needs a numeric Twitch ID, not a username — so we first call
// ivr.fi to convert username → ID (no auth required).

const emoteMapCache = new Map(); // username → Map(name_lower → { imageUrl, pageUrl })
const overrideCache = new Map(); // username → { triggerWord: url | null }

// ── Step 1: Twitch username → numeric ID via ivr.fi ──────────────────────────

async function fetchTwitchId(username) {
  const res = await fetch(
    `https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(username)}`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`ivr.fi ${res.status}`);
  const data = await res.json();
  const user = Array.isArray(data) ? data[0] : data;
  if (!user?.id) throw new Error("No Twitch ID returned");
  return user.id;
}

// ── Step 2: Twitch ID → active 7TV emote set ─────────────────────────────────
//
// Returns a Map of lowercased emote name → { imageUrl, pageUrl }.
// Returns an empty Map if the user isn't on 7TV or either call fails —
// all emotes will show the fallback image, nothing breaks.

export async function fetchUserEmotes(username) {
  if (emoteMapCache.has(username)) return emoteMapCache.get(username);

  const emoteMap = new Map();

  try {
    const twitchId = await fetchTwitchId(username);
    const res = await fetch(`https://7tv.io/v3/users/twitch/${twitchId}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`7TV ${res.status}`);
    const data = await res.json();

    for (const emote of data?.emote_set?.emotes ?? []) {
      const name = emote.name;
      const id   = emote.data?.id;
      if (!name || !id) continue;
      emoteMap.set(name.toLowerCase(), {
        imageUrl: `https://cdn.7tv.app/emote/${id}/4x.webp`,
        pageUrl:  `https://7tv.app/emotes/${id}`,
      });
    }

    console.log(`7TV: loaded ${emoteMap.size} emotes for ${username}`);
  } catch (err) {
    console.warn(`7TV emote fetch failed for ${username}:`, err.message);
  }

  emoteMapCache.set(username, emoteMap);
  return emoteMap;
}

// ── Manual overrides ──────────────────────────────────────────────────────────
//
// Optional file at lists/overrides/{username}.json.
// Format: { "triggerWord": "https://image-url" | null }
//   - URL  → use this image (overrides 7TV)
//   - null → plain word trigger, show the NO_EMOTE_IMAGE placeholder
//
// If the file doesn't exist, returns {} silently.

export async function fetchOverrides(username) {
  if (overrideCache.has(username)) return overrideCache.get(username);
  try {
    const res = await fetch(`lists/overrides/${username}.json`, { cache: "no-cache" });
    if (!res.ok) {
      overrideCache.set(username, {});
      return {};
    }
    const data = await res.json();
    overrideCache.set(username, data);
    return data;
  } catch {
    overrideCache.set(username, {});
    return {};
  }
}