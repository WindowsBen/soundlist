// ================== CONFIG ==================
// TODO: move this fallback image to R2
const FALLBACK_EMOTE_IMAGE = "https://files.catbox.moe/ab5icu.png";

// ================== STATE ==================
let userFiles = {};
let avatars   = {};

const listCache     = new Map(); // user → parsed sound list
const emoteMapCache = new Map(); // user → Map(emoteName_lower → { imageUrl, id })
const globalSources = [];

// ================== AUDIO CONTEXT (lazy) ==================
let _audioCtx = null;
function getAudioContext() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state === "suspended") _audioCtx.resume();
    return _audioCtx;
}

// ================== AUDIO UTILITIES ==================

async function fetchAndDecode(url) {
    const ctx = getAudioContext();
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    return ctx.decodeAudioData(buf);
}

function stopAllSounds() {
    globalSources.forEach(src => {
        try { src.stop();       } catch(e) {}
        try { src.disconnect(); } catch(e) {}
    });
    globalSources.length = 0;
}

function pickWeighted(subSounds) {
    const table = subSounds
        .map(s => ({ url: s.clip, weight: parseFloat(s.chance), vol: s.volume }))
        .filter(s => !isNaN(s.weight) && s.weight > 0);
    if (!table.length) return { url: subSounds[0].clip, perSoundVolume: subSounds[0].volume };
    const total = table.reduce((a, b) => a + b.weight, 0);
    let roll = Math.random() * total;
    for (const row of table) {
        if ((roll -= row.weight) <= 0) return { url: row.url, perSoundVolume: row.vol };
    }
    return { url: table[table.length - 1].url, perSoundVolume: table[table.length - 1].vol };
}

function createReversedBuffer(src) {
    const ctx = getAudioContext();
    const rev = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    for (let c = 0; c < src.numberOfChannels; c++) {
        const ch  = src.getChannelData(c);
        const rch = rev.getChannelData(c);
        for (let i = 0, L = ch.length; i < L; i++) rch[i] = ch[L - 1 - i];
    }
    return rev;
}

// ================== SOUND LINK HELPERS ==================

function getSoundLinkUrl(sound) {
    if (Array.isArray(sound)) return sound[0]?.clip || sound[0] || "#";
    return sound || "#";
}

function getSoundFilename(sound) {
    const url = getSoundLinkUrl(sound);
    if (!url || url === "#") return "Sound Link";
    try {
        const parts = new URL(url).pathname.split("/");
        return decodeURIComponent(parts[parts.length - 1]) || "Sound Link";
    } catch { return "Sound Link"; }
}

// ================== 7TV EMOTE FETCHING ==================
//
// Flow:
//   1. ivr.fi  — convert Twitch username → numeric Twitch ID (no auth needed)
//   2. 7tv.io  — fetch that user's active emote set
//
// Returns: Map of lowercased emote name → { imageUrl, id }
// Returns an empty Map if the user isn't on 7TV or either call fails.

async function fetchTwitchId(username) {
    const res  = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(username)}`);
    if (!res.ok) throw new Error(`ivr.fi ${res.status}`);
    const data = await res.json();
    // ivr.fi returns an array when queried by login
    const user = Array.isArray(data) ? data[0] : data;
    if (!user?.id) throw new Error("No Twitch ID returned");
    return user.id;
}

async function fetchUserEmotes(username) {
    // Return cached result if available
    if (emoteMapCache.has(username)) return emoteMapCache.get(username);

    const emoteMap = new Map();

    try {
        const twitchId = await fetchTwitchId(username);
        const res      = await fetch(`https://7tv.io/v3/users/twitch/${twitchId}`);
        if (!res.ok) throw new Error(`7TV ${res.status}`);
        const data = await res.json();

        const emotes = data?.emote_set?.emotes ?? [];
        for (const emote of emotes) {
            const name = emote.name;
            const id   = emote.data?.id;
            if (!name || !id) continue;
            emoteMap.set(name.toLowerCase(), {
                id,
                imageUrl: `https://cdn.7tv.app/emote/${id}/4x.webp`,
                pageUrl:  `https://7tv.app/emotes/${id}`
            });
        }

        console.log(`7TV: loaded ${emoteMap.size} emotes for ${username}`);
    } catch(err) {
        console.warn(`7TV emote fetch failed for ${username}:`, err.message);
        // Falls through with an empty map — all emotes show fallback image
    }

    emoteMapCache.set(username, emoteMap);
    return emoteMap;
}

// ================== RESOURCE LOADING ==================

async function loadUserFiles() {
    const res = await fetch("lists/index.json");
    if (!res.ok) throw new Error("lists/index.json not found — add it to your repo.");
    return await res.json();
}

async function loadResources() {
    try {
        const res = await fetch("lists/internals/avatars.json");
        avatars = await res.json();
    } catch(err) {
        console.error("Failed to load avatars:", err);
    }
}

// ================== DOM HELPERS ==================

function createBackButton() {
    const btn = document.createElement("button");
    btn.textContent = "⬅ Back";
    btn.className   = "back-btn";
    btn.addEventListener("click", () => {
        history.replaceState(null, "", " ");
        displayUserLists();
    });
    return btn;
}

function createSearchInput(placeholder, extraClass = "") {
    const input       = document.createElement("input");
    input.type        = "text";
    input.placeholder = placeholder;
    input.className   = "search-input" + (extraClass ? " " + extraClass : "");
    return input;
}

// ================== USER LIST ==================

function displayUserLists() {
    const container = document.getElementById("list");
    container.innerHTML = "";

    const searchInput = createSearchInput("Search users...", "user-search");
    container.appendChild(searchInput);

    const userDivs = [];

    Object.keys(userFiles).forEach(user => {
        const div       = document.createElement("div");
        div.className   = "sound-item";
        div.style.cursor = "pointer";

        const img = document.createElement("img");
        img.src   = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
        img.alt   = user;

        const link   = document.createElement("a");
        link.href    = `https://twitch.tv/${user}`;
        link.target  = "_blank";
        link.appendChild(img);
        div.appendChild(link);

        const text   = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = user;
        const span   = document.createElement("span");
        span.textContent   = "Click to view sounds";
        text.appendChild(strong);
        text.appendChild(document.createElement("br"));
        text.appendChild(span);
        div.appendChild(text);

        div.addEventListener("click", e => {
            if (e.target.closest("a")) return;
            loadList(user);
        });

        container.appendChild(div);
        userDivs.push({ div, name: user.toLowerCase() });
    });

    searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase();
        userDivs.forEach(o => o.div.style.display = o.name.includes(q) ? "flex" : "none");
    });
}

// ================== LOAD A USER'S SOUND LIST ==================

async function loadList(user) {
    const container = document.getElementById("list");

    try {
        // Fetch sound list (cached after first load)
        let list;
        if (listCache.has(user)) {
            list = listCache.get(user);
        } else {
            const res  = await fetch(userFiles[user]);
            const data = await res.json();
            list = Array.isArray(data) ? data : Object.values(data).find(v => Array.isArray(v)) || [];
            listCache.set(user, list);
        }

        history.replaceState(null, "", "#" + user);

        // Show loading state while emotes are fetched
        container.innerHTML = "";
        const loadingMsg = document.createElement("p");
        loadingMsg.className   = "loading-msg";
        loadingMsg.textContent = `Loading emotes for ${user}...`;
        container.appendChild(loadingMsg);

        // Fetch 7TV emotes for this user (cached after first load)
        const emoteMap = await fetchUserEmotes(user);

        displaySoundList(list, user, emoteMap);
    } catch(err) {
        console.error("Error loading list:", err);
        container.innerHTML = "";
        container.appendChild(createBackButton());
        const msg = document.createElement("p");
        msg.style.color  = "red";
        msg.textContent  = "Failed to load sound list.";
        container.appendChild(msg);
    }
}

// ================== SOUND LIST DISPLAY ==================

async function displaySoundList(list, user, emoteMap) {
    const container = document.getElementById("list");
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "header-wrapper";
    header.appendChild(createBackButton());

    const searchInput = createSearchInput("Search emotes...");
    header.appendChild(searchInput);
    container.appendChild(header);

    if (!list.length) {
        const p = document.createElement("p");
        p.textContent = "No sounds found.";
        container.appendChild(p);
        return;
    }

    const emoteDivs = [];

    for (const item of list) {
        if (item.enabled !== "true") continue;

        const div       = document.createElement("div");
        div.className   = "sound-item";
        div.style.position = "relative";

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

        // ── Resolve emote image from 7TV emote map ──
        // Lookup is case-insensitive; same trigger_word on different streamers
        // will now correctly show that streamer's version of the emote.
        const emoteEntry = emoteMap.get(item.trigger_word.toLowerCase());
        const imageUrl   = emoteEntry?.imageUrl ?? FALLBACK_EMOTE_IMAGE;
        const pageUrl    = emoteEntry?.pageUrl  ?? "#";

        const emoteAnchor   = document.createElement("a");
        emoteAnchor.href    = pageUrl;
        emoteAnchor.target  = "_blank";
        const emoteImg  = document.createElement("img");
        emoteImg.src    = imageUrl;
        emoteImg.alt    = item.trigger_word;
        emoteAnchor.appendChild(emoteImg);
        div.appendChild(emoteAnchor);

        // ── Text column ──
        const text   = document.createElement("div");
        text.className = "sound-text";
        const strong   = document.createElement("strong");
        strong.textContent = item.trigger_word;
        const soundLink    = document.createElement("a");
        soundLink.href     = getSoundLinkUrl(item.sound);
        soundLink.target   = "_blank";
        soundLink.textContent = getSoundFilename(item.sound);
        text.appendChild(strong);
        text.appendChild(document.createElement("br"));
        text.appendChild(soundLink);
        div.appendChild(text);

        // ── Controls ──
        const controls = document.createElement("div");
        controls.className = "sound-controls";

        const volWrapper = document.createElement("div");
        volWrapper.className = "vol-wrapper";
        const volLabel = document.createElement("label");
        volLabel.textContent = "Vol";
        const volInput = document.createElement("input");
        volInput.type  = "range"; volInput.min = "0"; volInput.max = "100";
        volInput.value = typeof item.volume === "number" ? Math.round(item.volume * 100) : 50;
        volWrapper.appendChild(volLabel);
        volWrapper.appendChild(volInput);

        const pitchRow = document.createElement("div");
        pitchRow.className = "pitch-row";
        const pitchLabel = document.createElement("label");
        pitchLabel.textContent = "Speed";
        const pitchInput = document.createElement("input");
        pitchInput.type = "number"; pitchInput.min = "50"; pitchInput.max = "200"; pitchInput.value = "100";
        pitchRow.appendChild(pitchLabel);
        pitchRow.appendChild(pitchInput);

        const reverseBtn = document.createElement("button");
        reverseBtn.textContent = "Reverse ▶";
        reverseBtn.className   = "reverse-btn";

        const stopBtn = document.createElement("button");
        stopBtn.textContent = "Stop All";
        stopBtn.className   = "stop-btn";

        controls.appendChild(volWrapper);
        controls.appendChild(pitchRow);
        controls.appendChild(reverseBtn);
        controls.appendChild(stopBtn);
        div.appendChild(controls);

        // ================== AUDIO ==================
        const bufferCache  = new Map();
        const reversedCache = new Map();
        let playingCount = 0;

        async function getBuffer(url) {
            if (bufferCache.has(url)) return bufferCache.get(url);
            loader.style.display = "flex";
            try {
                const decoded = await fetchAndDecode(url);
                bufferCache.set(url, decoded);
                loader.style.display = "none";
                return decoded;
            } catch(err) {
                loader.style.display = "none";
                throw err;
            }
        }

        async function play({ reversed = false } = {}) {
            let chosenUrl = null;
            let perSoundVolume = null;

            if (Array.isArray(item.sound)) {
                if (item.sound.length && typeof item.sound[0] === "object") {
                    const picked = pickWeighted(item.sound);
                    chosenUrl = picked.url; perSoundVolume = picked.perSoundVolume;
                } else {
                    chosenUrl = item.sound[Math.floor(Math.random() * item.sound.length)];
                }
            } else {
                chosenUrl = item.sound;
            }

            const ctx = getAudioContext();
            let buf   = await getBuffer(chosenUrl);

            if (reversed) {
                if (!reversedCache.has(chosenUrl)) reversedCache.set(chosenUrl, createReversedBuffer(buf));
                buf = reversedCache.get(chosenUrl);
            }

            const src      = ctx.createBufferSource();
            src.buffer     = buf;
            const gain     = ctx.createGain();
            gain.gain.value = ((parseFloat(volInput.value) || 50) / 100) * (perSoundVolume ?? 1);
            src.playbackRate.value = Math.max(0.01, (parseFloat(pitchInput.value) || 100) / 100);
            src.connect(gain).connect(ctx.destination);
            globalSources.push(src);

            playingCount++;
            div.classList.add("playing");
            src.start(0);

            src.onended = () => {
                try { src.disconnect(); gain.disconnect(); } catch(e) {}
                const idx = globalSources.indexOf(src);
                if (idx !== -1) globalSources.splice(idx, 1);
                if (--playingCount <= 0) { playingCount = 0; div.classList.remove("playing"); }
            };
        }

        function flashError() {
            div.classList.remove("sound-error");
            void div.offsetWidth;
            div.classList.add("sound-error");
        }

        div.addEventListener("click", e => {
            if (e.target.closest("a")) return;
            play({ reversed: false }).catch(err => { console.error(err); flashError(); });
        });
        reverseBtn.addEventListener("click", e => {
            e.stopPropagation();
            play({ reversed: true }).catch(err => { console.error(err); flashError(); });
        });
        stopBtn.addEventListener("click", e => {
            e.stopPropagation();
            stopAllSounds();
            playingCount = 0;
            div.classList.remove("playing");
        });
        pitchInput.addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });

        container.appendChild(div);
        emoteDivs.push({ div, trigger: item.trigger_word.toLowerCase() });
    }

    searchInput.addEventListener("input", () => {
        const q = searchInput.value.toLowerCase();
        emoteDivs.forEach(o => o.div.style.display = o.trigger.includes(q) ? "flex" : "none");
    });
}

// ================== HASH NAVIGATION ==================
window.addEventListener("hashchange", () => {
    const user = window.location.hash.slice(1);
    if (user && userFiles[user]) loadList(user);
    else displayUserLists();
});

// ================== DARK/LIGHT MODE ==================
const darkModeSwitch = document.getElementById("darkModeSwitch").querySelector("input");
darkModeSwitch.checked = document.body.classList.contains("lightmode");
darkModeSwitch.addEventListener("change", () => {
    document.body.classList.toggle("lightmode", darkModeSwitch.checked);
});

// ================== INIT ==================
window.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("list").innerHTML = "<p class='loading-msg'>Loading...</p>";
    await loadResources();
    try {
        userFiles = await loadUserFiles();
    } catch(err) {
        document.getElementById("list").innerHTML = `<p style='color:red;'>${err.message}</p>`;
        return;
    }
    const hashUser = window.location.hash.slice(1);
    if (hashUser && userFiles[hashUser]) loadList(hashUser);
    else displayUserLists();
});