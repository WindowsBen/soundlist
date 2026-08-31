// ================== CONFIG ==================
// TODO: move this fallback image to R2
const FALLBACK_EMOTE_IMAGE = "https://files.catbox.moe/ab5icu.png";

// ================== STATE ==================
let userFiles = {};
let avatars = {};
const listCache     = new Map(); // cache parsed JSON per user after first load
const emoteMapCache = new Map(); // cache 7TV emote maps per user
const overrideCache = new Map(); // cache per-streamer manual overrides
const globalSources = []; // all active AudioBufferSourceNodes
let _renderGen = 0; // incremented on every navigation; aborts stale async renders

// ================== AUDIO CONTEXT ==================
// Created lazily on first play to avoid browser autoplay warnings.
let _audioCtx = null;
function getAudioContext() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// ================== UTILITY FUNCTIONS ==================

// Append glow divs required by the notification card design
// https://uiverse.io/SouravBandyopadhyay/rude-tiger-29
function addCardGlows(div) {
  const notiglow = document.createElement("div");
  notiglow.className = "notiglow";
  const notiborderglow = document.createElement("div");
  notiborderglow.className = "notiborderglow";
  div.prepend(notiborderglow);
  div.prepend(notiglow);
}

// Fetch + decode audio buffer
async function fetchAndDecode(url) {
  const ctx = getAudioContext();
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return await ctx.decodeAudioData(arrayBuffer);
}

// Stop all playing sounds globally
function stopAllSounds() {
  globalSources.forEach((src) => {
    try { src.stop(); } catch (e) {}
    try { src.disconnect(); } catch (e) {}
  });
  globalSources.length = 0;
}

// Pick a weighted random sound from array [{clip, chance, volume}]
function pickWeighted(subSounds) {
  const table = [];
  subSounds.forEach((s) => {
    const pct = parseFloat(s.chance);
    if (!isNaN(pct) && pct > 0) table.push({ url: s.clip, weight: pct, vol: s.volume });
  });
  if (!table.length) return { url: subSounds[0].clip, perSoundVolume: subSounds[0].volume };
  const total = table.reduce((a, b) => a + b.weight, 0);
  let roll = Math.random() * total;
  for (const row of table) {
    if ((roll -= row.weight) <= 0) return { url: row.url, perSoundVolume: row.vol };
  }
  return { url: table[table.length - 1].url, perSoundVolume: table[table.length - 1].vol };
}

// Create reversed audio buffer
function createReversedBuffer(srcBuffer) {
  const ctx = getAudioContext();
  const numChannels = srcBuffer.numberOfChannels;
  const rev = ctx.createBuffer(numChannels, srcBuffer.length, srcBuffer.sampleRate);
  for (let c = 0; c < numChannels; c++) {
    const ch = srcBuffer.getChannelData(c);
    const revCh = rev.getChannelData(c);
    for (let i = 0, L = ch.length; i < L; i++) revCh[i] = ch[L - 1 - i];
  }
  return rev;
}

// Extract a readable filename from a sound URL
function getSoundFilename(sound) {
  const url = Array.isArray(sound) ? sound[0]?.clip || sound[0] || "" : sound || "";
  if (!url || url === "#") return "Sound Link";
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]) || "Sound Link";
  } catch {
    return "Sound Link";
  }
}

function getSoundLinkUrl(sound) {
  if (Array.isArray(sound)) return sound[0]?.clip || sound[0] || "#";
  return sound || "#";
}

// ================== 7TV EMOTE FETCHING ==================
//
// Flow:
//   1. ivr.fi  — convert Twitch username → numeric Twitch ID (no auth needed)
//   2. 7tv.io  — fetch that user's active emote set
//
// Returns a Map of lowercased emote name → { imageUrl, pageUrl }
// Returns an empty Map if the user isn't on 7TV or either call fails — all
// emotes will show the fallback image, nothing breaks.

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

async function fetchUserEmotes(username) {
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

// ================== OVERRIDE LOADING ==================
//
// Per-streamer manual overrides live in lists/overrides/{username}.json
// Format: { "triggerWord": "https://image-url" | null }
//   - A URL:  use this image instead of whatever 7TV would return
//   - null:   this trigger is just a word — show a text badge, no image
//
// The file is optional — if it doesn't exist, nothing changes for that streamer.

async function fetchOverrides(username) {
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

// ================== RESOURCE LOADING ==================

async function loadUserFiles() {
  const res = await fetch("lists/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("lists/index.json not found — add it to your repo.");
  return await res.json();
}

async function loadResources() {
  try {
    const resAvatars = await fetch("lists/internals/avatars.json", { cache: "no-cache" });
    avatars = await resAvatars.json();
  } catch (err) {
    console.error("Failed to load avatars:", err);
  }
}

// ================== DOM HELPERS ==================

function createDarkModeToggle() {
  const label = document.createElement("label");
  label.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = document.body.classList.contains("lightmode");
  const span = document.createElement("span");
  span.className = "slider";
  label.appendChild(input);
  label.appendChild(span);
  input.addEventListener("change", () => {
    document.body.classList.toggle("lightmode", input.checked);
  });
  return label;
}

function createBackButton() {
  const btn = document.createElement("button");
  btn.textContent = "⬅ Back";
  btn.className = "back-btn";
  btn.addEventListener("click", () => history.back());
  return btn;
}

function createJsonLink(user, extraClass = "") {
  const link = document.createElement("a");
  link.className = "json-link" + (extraClass ? " " + extraClass : "");
  link.href = userFiles[user];
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "{ } JSON";
  link.title = `Open ${user}'s raw sound list JSON`;
  return link;
}

function createSearchInput(placeholder, extraClass = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.className = "search-input" + (extraClass ? " " + extraClass : "");
  return input;
}

// ================== DISPLAY FUNCTIONS ==================

// Show main user list
function displayUserLists() {
  const myGen = ++_renderGen;
  const container = document.getElementById("list");
  container.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "list-panel";
  container.appendChild(panel);

  const searchRow = document.createElement("div");
  searchRow.className = "search-toggle-row";
  const searchInput = createSearchInput("Search streamers...", "user-search");
  searchRow.appendChild(searchInput);
  searchRow.appendChild(createDarkModeToggle());
  panel.appendChild(searchRow);

  const grid = document.createElement("div");
  grid.className = "streamer-grid";
  panel.appendChild(grid);

  const streamerDivs = [];
  const countBadges = {};

  Object.keys(userFiles).forEach((user) => {
    const div = document.createElement("div");
    div.className = "streamer-card";
    addCardGlows(div);

    const avatarLink = document.createElement("a");
    avatarLink.href = `https://twitch.tv/${user}`;
    avatarLink.target = "_blank";
    const img = document.createElement("img");
    img.src = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
    img.alt = user;
    img.className = "streamer-avatar";
    avatarLink.appendChild(img);
    div.appendChild(avatarLink);

    const nameEl = document.createElement("div");
    nameEl.className = "streamer-card-name";
    nameEl.textContent = user;
    div.appendChild(nameEl);

    const badge = document.createElement("span");
    badge.className = "sound-count-badge";
    const cached = listCache.get(user);
    badge.textContent = cached ? `${cached.length} sounds` : "-- sounds";
    countBadges[user] = badge;
    div.appendChild(badge);

    div.appendChild(createJsonLink(user, "card-json-link"));

    div.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      loadList(user);
    });

    grid.appendChild(div);
    streamerDivs.push({ div, name: user.toLowerCase() });
  });

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase();
    streamerDivs.forEach((obj) => {
      obj.div.style.display = obj.name.includes(query) ? "flex" : "none";
    });
  });

  // Load sound counts in background for uncached streamers
  Object.keys(userFiles).forEach(async (user) => {
    if (listCache.has(user)) return;
    try {
      const res = await fetch(userFiles[user], { cache: "no-cache" });
      const data = await res.json();
      const list = Array.isArray(data) ? data : Object.values(data).find((v) => Array.isArray(v)) || [];
      listCache.set(user, list);
      if (_renderGen === myGen && countBadges[user]) {
        countBadges[user].textContent = `${list.length} sounds`;
      }
    } catch {
      /* non-critical */
    }
  });
}

// Load and display a specific user's sounds
// push=true when the user clicks a streamer (adds a history entry);
// push=false when called from popstate or initial load (URL is already correct).
async function loadList(user, push = true) {
  try {
    let list;

    // use cached JSON if available
    if (listCache.has(user)) {
      list = listCache.get(user);
    } else {
      const res = await fetch(userFiles[user], { cache: "no-cache" });
      const data = await res.json();
      list = Array.isArray(data) ? data : Object.values(data).find((v) => Array.isArray(v)) || [];
      listCache.set(user, list);
    }

    if (push) history.pushState(null, "", "#" + user);
    displaySoundList(list, user);
  } catch (err) {
    console.error("Error loading list:", err);
    const container = document.getElementById("list");
    container.innerHTML = "";
    container.appendChild(createBackButton());

    const errorMsg = document.createElement("p");
    errorMsg.style.color = "red";
    errorMsg.textContent = "Failed to load list.";
    container.appendChild(errorMsg);
  }
}

// Render sound list for a user
async function displaySoundList(list, user) {
  const myGen = ++_renderGen;
  const container = document.getElementById("list");
  container.innerHTML = "";

  // Streamer mini-header
  const header = document.createElement("div");
  header.className = "sound-list-header";
  header.appendChild(createBackButton());

  const infoBadge = document.createElement("div");
  infoBadge.className = "streamer-info-badge";
  const headerAvatar = document.createElement("img");
  headerAvatar.src = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
  headerAvatar.alt = user;
  headerAvatar.className = "header-avatar";
  const headerName = document.createElement("span");
  headerName.className = "header-username";
  headerName.textContent = user;
  infoBadge.appendChild(headerAvatar);
  infoBadge.appendChild(headerName);
  infoBadge.appendChild(createJsonLink(user, "header-json-link"));
  header.appendChild(infoBadge);

  header.appendChild(createDarkModeToggle());
  const searchInput = createSearchInput("Search emotes...");
  header.appendChild(searchInput);
  container.appendChild(header);

  // Glass panel wrapping all sound cards
  const panel = document.createElement("div");
  panel.className = "list-panel";
  container.appendChild(panel);

  if (!list.length) {
    const p = document.createElement("p");
    p.textContent = "No sounds found.";
    panel.appendChild(p);
    return;
  }

  const soundGrid = document.createElement("div");
  soundGrid.className = "sound-grid";
  panel.appendChild(soundGrid);

  const emoteDivs = [];

  // Attach search listener before the loop so it works during async loading
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase();
    emoteDivs.forEach((obj) => {
      obj.div.style.display = obj.trigger_word.includes(query) ? "flex" : "none";
    });
  });

  // Start fetching 7TV emotes and manual overrides before the loop —
  // both are shared across all cards. Cards render immediately; images fill
  // in once the fetches resolve. Overrides take priority over 7TV.
  const emoteMapPromise  = fetchUserEmotes(user);
  const overridesPromise = fetchOverrides(user);

  for (const item of list) {
    if (!item.enabled || item.enabled !== "true") continue;

    const div = document.createElement("div");
    div.className = "sound-item";
    div.style.position = "relative";
    addCardGlows(div);

    // Loader
    const loader = document.createElement("div");
    loader.className = "loader";
    loader.style.cssText =
      "display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:10;";
    ["", "", ""].forEach(() => {
      const bar = document.createElement("span");
      bar.className = "bar";
      loader.appendChild(bar);
    });
    div.appendChild(loader);

    // Emote image + link — src filled in asynchronously below
    const emoteAnchor = document.createElement("a");
    emoteAnchor.href = "#";
    emoteAnchor.target = "_blank";
    const emoteImg = document.createElement("img");
    emoteImg.alt = item.trigger_word;
    emoteAnchor.appendChild(emoteImg);
    div.appendChild(emoteAnchor);

    // Text column
    const text = document.createElement("div");
    text.className = "sound-text";
    const strong = document.createElement("strong");
    strong.textContent = item.trigger_word;
    text.appendChild(strong);
    text.appendChild(document.createElement("br"));

    const isMultiSound = Array.isArray(item.sound) && item.sound.length > 1;

    if (isMultiSound) {
      // Badge that toggles a clip list
      const isWeighted = typeof item.sound[0] === "object";

      const badge = document.createElement("button");
      badge.className = "multi-sound-badge";
      badge.textContent = `🎲 ${item.sound.length} clips ▾`;

      const clipList = document.createElement("div");
      clipList.className = "multi-sound-list";
      clipList.hidden = true;

      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        clipList.hidden = !clipList.hidden;
        badge.textContent = clipList.hidden
          ? `🎲 ${item.sound.length} clips ▾`
          : `🎲 ${item.sound.length} clips ▴`;
      });

      const equalChance = Math.round(100 / item.sound.length);

      item.sound.forEach((s) => {
        const url = isWeighted ? s.clip : s;
        const chance = isWeighted ? s.chance : equalChance;

        const entry = document.createElement("div");
        entry.className = "multi-sound-entry";

        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.textContent = getSoundFilename(url);
        entry.appendChild(link);

        const pct = document.createElement("span");
        pct.className = "multi-sound-chance";
        pct.textContent = `${String(chance).replace(/%/g, "")}%`;
        entry.appendChild(pct);

        clipList.appendChild(entry);
      });

      text.appendChild(badge);
      text.appendChild(clipList);
    } else {
      // Single sound — show filename link as before
      const soundLink = document.createElement("a");
      soundLink.href = getSoundLinkUrl(item.sound);
      soundLink.target = "_blank";
      soundLink.textContent = getSoundFilename(item.sound);
      text.appendChild(soundLink);
    }

    div.appendChild(text);

    // Controls
    const controls = document.createElement("div");
    controls.className = "sound-controls";
    controls.addEventListener("click", (e) => e.stopPropagation());

    // Volume
    const volWrapper = document.createElement("div");
    volWrapper.className = "slider-row";
    const volLabel = document.createElement("label");
    volLabel.textContent = "Vol";
    const volContent = document.createElement("div");
    volContent.className = "slider-content";
    const volSliderWrap = document.createElement("div");
    volSliderWrap.className = "slider-wrapper";
    const volInput = document.createElement("input");
    volInput.type = "range";
    volInput.min = "0";
    volInput.max = "100";
    volInput.className = "custom-slider";
    volInput.value = typeof item.volume === "number" ? Math.round(item.volume * 100) : 50;
    const volDivider = document.createElement("div");
    volDivider.className = "slider-divider";
    const volDisplay = document.createElement("span");
    volDisplay.className = "slider-value";
    volDisplay.textContent = volInput.value;
    volInput.addEventListener("input", () => {
      volDisplay.textContent = volInput.value;
    });
    volSliderWrap.appendChild(volInput);
    volContent.appendChild(volSliderWrap);
    volContent.appendChild(volDivider);
    volContent.appendChild(volDisplay);
    volWrapper.appendChild(volLabel);
    volWrapper.appendChild(volContent);

    // Speed
    const pitchRow = document.createElement("div");
    pitchRow.className = "slider-row";
    const pitchLabel = document.createElement("label");
    pitchLabel.textContent = "Spd";
    const pitchContent = document.createElement("div");
    pitchContent.className = "slider-content";
    const pitchInput = document.createElement("input");
    pitchInput.type = "number";
    pitchInput.value = "100";
    pitchInput.className = "speed-input";
    const pitchPct = document.createElement("span");
    pitchPct.className = "slider-value";
    pitchPct.textContent = "%";
    pitchContent.appendChild(pitchInput);
    pitchContent.appendChild(pitchPct);
    pitchRow.appendChild(pitchLabel);
    pitchRow.appendChild(pitchContent);

    // Buttons
    const reverseBtn = document.createElement("button");
    reverseBtn.textContent = "Reverse ▶";
    reverseBtn.title = "Play reversed";
    reverseBtn.className = "reverse-btn";

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop All";
    stopBtn.className = "stop-btn";

    const btnRow = document.createElement("div");
    btnRow.className = "btn-row";
    btnRow.appendChild(reverseBtn);
    btnRow.appendChild(stopBtn);

    controls.appendChild(volWrapper);
    controls.appendChild(pitchRow);
    controls.appendChild(btnRow);
    div.appendChild(controls);

    // ================== AUDIO HANDLING ==================
    const bufferCache = new Map();
    const reversedCache = new Map();
    let playingCount = 0;

    async function getBufferForUrl(url) {
      if (bufferCache.has(url)) return bufferCache.get(url);
      loader.style.display = "flex";
      try {
        const decoded = await fetchAndDecode(url);
        bufferCache.set(url, decoded);
        loader.style.display = "none";
        return decoded;
      } catch (err) {
        loader.style.display = "none";
        throw err;
      }
    }

    async function playRandomBuffer({ reversed = false } = {}) {
      let chosenUrl = null;
      let perSoundVolume = null;

      if (Array.isArray(item.sound)) {
        if (item.sound.length > 0 && typeof item.sound[0] === "object") {
          const picked = pickWeighted(item.sound);
          chosenUrl = picked.url;
          perSoundVolume = picked.perSoundVolume;
        } else {
          chosenUrl = item.sound[Math.floor(Math.random() * item.sound.length)];
        }
      } else {
        chosenUrl = item.sound;
      }

      const ctx = getAudioContext();
      const buf = await getBufferForUrl(chosenUrl);

      let bufferToPlay = buf;
      if (reversed) {
        if (!reversedCache.has(chosenUrl)) reversedCache.set(chosenUrl, createReversedBuffer(buf));
        bufferToPlay = reversedCache.get(chosenUrl);
      }

      const src = ctx.createBufferSource();
      src.buffer = bufferToPlay;
      globalSources.push(src);

      const gainNode = ctx.createGain();
      gainNode.gain.value = (parseFloat(volInput.value) / 100) * (perSoundVolume != null ? perSoundVolume : 1);
      src.playbackRate.value = Math.max(0.01, (parseFloat(pitchInput.value) || 100) / 100);

      src.connect(gainNode).connect(ctx.destination);
      src.start(0);

      playingCount++;
      div.classList.add("playing");

      src.onended = () => {
        try { src.disconnect(); gainNode.disconnect(); } catch (e) {}
        const idx = globalSources.indexOf(src);
        if (idx !== -1) globalSources.splice(idx, 1);
        playingCount--;
        if (playingCount <= 0) {
          playingCount = 0;
          div.classList.remove("playing");
        }
      };

      return src;
    }

    div.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      playRandomBuffer({ reversed: false }).catch((err) => {
        console.error("Playback error:", err);
        div.classList.remove("sound-error");
        void div.offsetWidth;
        div.classList.add("sound-error");
      });
    });
    reverseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playRandomBuffer({ reversed: true }).catch((err) => {
        console.error("Playback error:", err);
        div.classList.remove("sound-error");
        void div.offsetWidth;
        div.classList.add("sound-error");
      });
    });
    stopBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stopAllSounds();
      playingCount = 0;
      div.classList.remove("playing");
    });
    pitchInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") ev.target.blur();
    });

    if (_renderGen !== myGen) return; // user navigated away — abort stale render
    // Apply active search filter before inserting so the card isn't briefly visible
    const currentQuery = searchInput.value.toLowerCase();
    if (currentQuery && !item.trigger_word.toLowerCase().includes(currentQuery)) {
      div.style.display = "none";
    }
    soundGrid.appendChild(div);
    emoteDivs.push({ div, trigger_word: item.trigger_word.toLowerCase() });

    // Resolve emote image — overrides take priority, then 7TV, then fallback.
    const capturedGen     = myGen;
    const capturedTrigger = item.trigger_word;
    Promise.all([emoteMapPromise, overridesPromise]).then(([emoteMap, overrides]) => {
      if (_renderGen !== capturedGen) return; // navigated away — discard

      // 1. Check manual override
      if (capturedTrigger in overrides) {
        const override = overrides[capturedTrigger];
        if (override === null) {
          emoteImg.src     = "https://files.catbox.moe/ab5icu.png";
          emoteAnchor.href = override;
        } else {
          // Manual image URL
          emoteImg.src     = override;
          emoteAnchor.href = override;
        }
        return;
      }

      // 2. Fall back to 7TV
      const entry      = emoteMap.get(capturedTrigger.toLowerCase());
      emoteImg.src     = entry?.imageUrl ?? FALLBACK_EMOTE_IMAGE;
      emoteAnchor.href = entry?.pageUrl  ?? "#";
    });
  }
}

// ================== PARTICLE BACKGROUND ==================
(function initParticles() {
  const canvas = document.getElementById("bg-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const COUNT = 90;
  const MAX_DIST = 160;
  const SPEED = 0.35;
  const DOT_R = 2;
  const MAX_DIST2 = MAX_DIST * MAX_DIST;

  let particles = [];
  let W = 0, H = 0;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticle() {
    const angle = Math.random() * Math.PI * 2;
    const speed = SPEED * (0.5 + Math.random() * 0.5);
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    };
  }

  function init() {
    resize();
    particles = Array.from({ length: COUNT }, makeParticle);
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -5) p.x = W + 5;
      else if (p.x > W + 5) p.x = -5;
      if (p.y < -5) p.y = H + 5;
      else if (p.y > H + 5) p.y = -5;
    }

    const light = document.body.classList.contains("lightmode");
    const dotColor = light ? "rgba(20, 30, 90, 0.7)" : "rgba(180, 215, 255, 0.75)";
    const lineBase = light ? "20, 30, 90" : "160, 200, 255";
    const lineAlphaScale = light ? 0.35 : 0.45;

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < MAX_DIST2) {
          const alpha = (1 - Math.sqrt(d2) / MAX_DIST) * lineAlphaScale;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(${lineBase}, ${alpha})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    ctx.fillStyle = dotColor;
    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(tick);
  }

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(init, 200);
  });

  init();
  tick();
})();

// ================== HISTORY NAVIGATION ==================
window.addEventListener("popstate", () => {
  const hashUser = window.location.hash.slice(1);
  if (hashUser && userFiles[hashUser]) loadList(hashUser, false);
  else displayUserLists();
});

// ================== INIT ==================
window.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("list");
  listEl.innerHTML = "<p class='loading-msg'>Loading...</p>";

  await loadResources();

  try {
    userFiles = await loadUserFiles();
  } catch (err) {
    listEl.innerHTML = `<p style='color:red;'>${err.message}</p>`;
    return;
  }

  const hashUser = window.location.hash.slice(1);
  if (hashUser && userFiles[hashUser]) loadList(hashUser, false);
  else displayUserLists();
});