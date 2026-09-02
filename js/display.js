// ================== DISPLAY ==================
// All page rendering: the streamer grid, individual sound lists,
// and the audio playback wired to each card.

import { FALLBACK_EMOTE_IMAGE, NO_EMOTE_IMAGE } from "./config.js";
import {
  getAudioContext,
  globalSources,
  fetchAndDecode,
  stopAllSounds,
  pickWeighted,
  createReversedBuffer,
} from "./audio.js";
import { fetchUserEmotes, fetchOverrides } from "./emotes.js";
import { userFiles, avatars, listCache } from "./loader.js";
import {
  addCardGlows,
  getSoundFilename,
  getSoundLinkUrl,
  createDarkModeToggle,
  createBackButton,
  createSearchInput,
} from "./ui.js";

// Incremented on every navigation; async callbacks check against this
// to discard work that belongs to a page the user already left.
let _renderGen = 0;

// ── Streamer-specific JSON link ───────────────────────────────────────────────
// Lives here rather than ui.js because it needs userFiles from loader.js.

function createJsonLink(user, extraClass = "") {
  const link      = document.createElement("a");
  link.className  = "json-link" + (extraClass ? " " + extraClass : "");
  link.href       = userFiles[user];
  link.target     = "_blank";
  link.rel        = "noopener";
  link.textContent = "{ } JSON";
  link.title      = `Open ${user}'s raw sound list JSON`;
  return link;
}

// ── Streamer grid ─────────────────────────────────────────────────────────────

export function displayUserLists() {
  const myGen     = ++_renderGen;
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
  const countBadges  = {};

  Object.keys(userFiles).forEach((user) => {
    const div       = document.createElement("div");
    div.className   = "streamer-card";
    addCardGlows(div);

    const avatarLink   = document.createElement("a");
    avatarLink.href    = `https://twitch.tv/${user}`;
    avatarLink.target  = "_blank";
    const img          = document.createElement("img");
    img.src            = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
    img.alt            = user;
    img.className      = "streamer-avatar";
    avatarLink.appendChild(img);
    div.appendChild(avatarLink);

    const nameEl       = document.createElement("div");
    nameEl.className   = "streamer-card-name";
    nameEl.textContent = user;
    div.appendChild(nameEl);

    const badge       = document.createElement("span");
    badge.className   = "sound-count-badge";
    const cached      = listCache.get(user);
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
      const res  = await fetch(userFiles[user], { cache: "no-cache" });
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

// ── Load a streamer's sound list ──────────────────────────────────────────────
// push=true  → user clicked a card (adds a history entry)
// push=false → called from popstate or initial load (URL already correct)

export async function loadList(user, push = true) {
  try {
    let list;
    if (listCache.has(user)) {
      list = listCache.get(user);
    } else {
      const res  = await fetch(userFiles[user], { cache: "no-cache" });
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
    errorMsg.style.color  = "red";
    errorMsg.textContent  = "Failed to load list.";
    container.appendChild(errorMsg);
  }
}

// ── Sound list ────────────────────────────────────────────────────────────────

async function displaySoundList(list, user) {
  const myGen     = ++_renderGen;
  const container = document.getElementById("list");
  container.innerHTML = "";

  // Header
  const header    = document.createElement("div");
  header.className = "sound-list-header";
  header.appendChild(createBackButton());

  const infoBadge        = document.createElement("div");
  infoBadge.className    = "streamer-info-badge";
  const headerAvatar     = document.createElement("img");
  headerAvatar.src       = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
  headerAvatar.alt       = user;
  headerAvatar.className = "header-avatar";
  const headerName       = document.createElement("span");
  headerName.className   = "header-username";
  headerName.textContent = user;
  infoBadge.appendChild(headerAvatar);
  infoBadge.appendChild(headerName);
  infoBadge.appendChild(createJsonLink(user, "header-json-link"));
  header.appendChild(infoBadge);
  header.appendChild(createDarkModeToggle());

  const searchInput = createSearchInput("Search emotes...");
  header.appendChild(searchInput);
  container.appendChild(header);

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

  // Attach search before the loop so it works during async rendering
  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase();
    emoteDivs.forEach((obj) => {
      obj.div.style.display = obj.trigger_word.includes(query) ? "flex" : "none";
    });
  });

  // Kick off both fetches once — shared across all cards in this list
  const emoteMapPromise  = fetchUserEmotes(user);
  const overridesPromise = fetchOverrides(user);

  for (const item of list) {
    if (!item.enabled || item.enabled !== "true") continue;

    const div       = document.createElement("div");
    div.className   = "sound-item";
    div.style.position = "relative";
    addCardGlows(div);

    // Loader bars
    const loader = document.createElement("div");
    loader.className = "loader";
    loader.style.cssText = "display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:10;";
    for (let i = 0; i < 3; i++) {
      const bar = document.createElement("span");
      bar.className = "bar";
      loader.appendChild(bar);
    }
    div.appendChild(loader);

    // Emote image (src filled in asynchronously after the loop)
    const emoteAnchor  = document.createElement("a");
    emoteAnchor.href   = "#";
    emoteAnchor.target = "_blank";
    const emoteImg     = document.createElement("img");
    emoteImg.alt       = item.trigger_word;
    emoteAnchor.appendChild(emoteImg);
    div.appendChild(emoteAnchor);

    // Text column
    const text    = document.createElement("div");
    text.className = "sound-text";
    const strong   = document.createElement("strong");
    strong.textContent = item.trigger_word;
    text.appendChild(strong);
    text.appendChild(document.createElement("br"));

    const isMultiSound = Array.isArray(item.sound) && item.sound.length > 1;

    if (isMultiSound) {
      const isWeighted = typeof item.sound[0] === "object";
      const badge      = document.createElement("button");
      badge.className  = "multi-sound-badge";
      badge.textContent = `🎲 ${item.sound.length} clips ▾`;

      const clipList   = document.createElement("div");
      clipList.className = "multi-sound-list";
      clipList.hidden  = true;

      badge.addEventListener("click", (e) => {
        e.stopPropagation();
        clipList.hidden   = !clipList.hidden;
        badge.textContent = clipList.hidden
          ? `🎲 ${item.sound.length} clips ▾`
          : `🎲 ${item.sound.length} clips ▴`;
      });

      const equalChance = Math.round(100 / item.sound.length);
      item.sound.forEach((s) => {
        const clipUrl  = isWeighted ? s.clip : s;
        const chance   = isWeighted ? s.chance : equalChance;
        const entry    = document.createElement("div");
        entry.className = "multi-sound-entry";
        const link     = document.createElement("a");
        link.href      = clipUrl;
        link.target    = "_blank";
        link.textContent = getSoundFilename(clipUrl);
        const pct      = document.createElement("span");
        pct.className  = "multi-sound-chance";
        pct.textContent = `${String(chance).replace(/%/g, "")}%`;
        entry.appendChild(link);
        entry.appendChild(pct);
        clipList.appendChild(entry);
      });

      text.appendChild(badge);
      text.appendChild(clipList);
    } else {
      const soundLink      = document.createElement("a");
      soundLink.href       = getSoundLinkUrl(item.sound);
      soundLink.target     = "_blank";
      soundLink.textContent = getSoundFilename(item.sound);
      text.appendChild(soundLink);
    }

    div.appendChild(text);

    // Controls
    const controls  = document.createElement("div");
    controls.className = "sound-controls";
    controls.addEventListener("click", (e) => e.stopPropagation());

    // Volume slider
    const volWrapper   = document.createElement("div");
    volWrapper.className = "slider-row";
    const volLabel     = document.createElement("label");
    volLabel.textContent = "Vol";
    const volContent   = document.createElement("div");
    volContent.className = "slider-content";
    const volSliderWrap = document.createElement("div");
    volSliderWrap.className = "slider-wrapper";
    const volInput     = document.createElement("input");
    volInput.type      = "range";
    volInput.min       = "0";
    volInput.max       = "100";
    volInput.className = "custom-slider";
    volInput.value     = typeof item.volume === "number" ? Math.round(item.volume * 100) : 50;
    const volDivider   = document.createElement("div");
    volDivider.className = "slider-divider";
    const volDisplay   = document.createElement("span");
    volDisplay.className = "slider-value";
    volDisplay.textContent = volInput.value;
    volInput.addEventListener("input", () => { volDisplay.textContent = volInput.value; });
    volSliderWrap.appendChild(volInput);
    volContent.appendChild(volSliderWrap);
    volContent.appendChild(volDivider);
    volContent.appendChild(volDisplay);
    volWrapper.appendChild(volLabel);
    volWrapper.appendChild(volContent);

    // Speed input
    const pitchRow     = document.createElement("div");
    pitchRow.className = "slider-row";
    const pitchLabel   = document.createElement("label");
    pitchLabel.textContent = "Spd";
    const pitchContent = document.createElement("div");
    pitchContent.className = "slider-content";
    const pitchInput   = document.createElement("input");
    pitchInput.type    = "number";
    pitchInput.value   = "100";
    pitchInput.className = "speed-input";
    const pitchPct     = document.createElement("span");
    pitchPct.className = "slider-value";
    pitchPct.textContent = "%";
    pitchContent.appendChild(pitchInput);
    pitchContent.appendChild(pitchPct);
    pitchRow.appendChild(pitchLabel);
    pitchRow.appendChild(pitchContent);

    // Buttons
    const reverseBtn   = document.createElement("button");
    reverseBtn.textContent = "Reverse ▶";
    reverseBtn.title   = "Play reversed";
    reverseBtn.className = "reverse-btn";

    const stopBtn      = document.createElement("button");
    stopBtn.textContent = "Stop All";
    stopBtn.className  = "stop-btn";

    const btnRow       = document.createElement("div");
    btnRow.className   = "btn-row";
    btnRow.appendChild(reverseBtn);
    btnRow.appendChild(stopBtn);

    controls.appendChild(volWrapper);
    controls.appendChild(pitchRow);
    controls.appendChild(btnRow);
    div.appendChild(controls);

    // ── Audio ──────────────────────────────────────────────────────────────────

    const bufferCache   = new Map();
    const reversedCache = new Map();
    let playingCount    = 0;

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
      let chosenUrl      = null;
      let perSoundVolume = null;

      if (Array.isArray(item.sound)) {
        if (item.sound.length > 0 && typeof item.sound[0] === "object") {
          const picked   = pickWeighted(item.sound);
          chosenUrl      = picked.url;
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

      const src      = ctx.createBufferSource();
      src.buffer     = bufferToPlay;
      globalSources.push(src);

      const gainNode          = ctx.createGain();
      gainNode.gain.value     = (parseFloat(volInput.value) / 100) * (perSoundVolume ?? 1);
      src.playbackRate.value  = Math.max(0.01, (parseFloat(pitchInput.value) || 100) / 100);

      src.connect(gainNode).connect(ctx.destination);
      src.start(0);

      playingCount++;
      div.classList.add("playing");

      src.onended = () => {
        try { src.disconnect(); gainNode.disconnect(); } catch (e) {}
        const idx = globalSources.indexOf(src);
        if (idx !== -1) globalSources.splice(idx, 1);
        if (--playingCount <= 0) { playingCount = 0; div.classList.remove("playing"); }
      };

      return src;
    }

    function flashError() {
      div.classList.remove("sound-error");
      void div.offsetWidth; // force reflow so animation restarts
      div.classList.add("sound-error");
    }

    div.addEventListener("click", (e) => {
      if (e.target.closest("a")) return;
      playRandomBuffer({ reversed: false }).catch((err) => { console.error(err); flashError(); });
    });
    reverseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      playRandomBuffer({ reversed: true }).catch((err) => { console.error(err); flashError(); });
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

    if (_renderGen !== myGen) return; // user navigated away — abort

    // Apply active search filter before inserting so card isn't briefly visible
    const currentQuery = searchInput.value.toLowerCase();
    if (currentQuery && !item.trigger_word.toLowerCase().includes(currentQuery)) {
      div.style.display = "none";
    }
    soundGrid.appendChild(div);
    emoteDivs.push({ div, trigger_word: item.trigger_word.toLowerCase() });

    // ── Emote image resolution ─────────────────────────────────────────────────
    // Awaits both promises (already in-flight) then decides which image to show.
    // Priority: override file → 7TV → FALLBACK_EMOTE_IMAGE

    const capturedGen     = myGen;
    const capturedTrigger = item.trigger_word;

    Promise.all([emoteMapPromise, overridesPromise]).then(([emoteMap, overrides]) => {
      if (_renderGen !== capturedGen) return; // navigated away — discard

      if (capturedTrigger in overrides) {
        const override = overrides[capturedTrigger];
        if (override === null) {
          emoteImg.src                    = NO_EMOTE_IMAGE;
          emoteAnchor.href                = "#";
          emoteAnchor.style.cursor        = "default";
          emoteAnchor.style.pointerEvents = "none";
        } else {
          emoteImg.src     = override;
          emoteAnchor.href = override;
        }
        return;
      }

      const entry      = emoteMap.get(capturedTrigger.toLowerCase());
      emoteImg.src     = entry?.imageUrl ?? FALLBACK_EMOTE_IMAGE;
      emoteAnchor.href = entry?.pageUrl  ?? "#";
    });
  }
}