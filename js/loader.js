// ================== LOADER ==================
// Owns shared data that multiple modules read:
//   userFiles  — streamer → JSON path mapping (from lists/index.json)
//   avatars    — username → avatar URL
//   listCache  — parsed sound list per streamer, cached after first fetch
//
// userFiles and avatars are exported as live bindings — when this module
// reassigns them after the fetch, all importers see the updated value.

export let userFiles = {};
export let avatars   = {};
export const listCache = new Map();

export async function loadUserFiles() {
  const res = await fetch("data/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("lists/index.json not found — add it to your repo.");
  userFiles = await res.json();
}

export async function loadResources() {
  try {
    const res = await fetch("data/avatars.json", { cache: "no-cache" });
    avatars = await res.json();
  } catch (err) {
    console.error("Failed to load avatars:", err);
  }
}