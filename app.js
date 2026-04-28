// ================== CONFIG (point 9) ==================
// Fallback user list — used only if lists/index.json is not found.
// To add streamers without touching this file, create lists/index.json instead.
const FALLBACK_USER_FILES = {
    Amedoll:            "lists/Amedoll.json",
    Boshiitime:         "lists/BoshiiTime.json",
    Favorite:           "lists/Favorite.json",
    Fubuki_Vr:          "lists/Fubuki_Vr.json",
    Greywolf:           "lists/Greywolf.json",
    HeyImRadiant:       "lists/HeyImRadiant.json",
    I3orje:             "lists/I3orje.json",
    Jakkuba_VR:         "lists/Jakkuba_VR.json",
    Kasimina:           "lists/Kasimina.json",
    Kohrean:            "lists/Kohrean.json",
    Krisuna:            "lists/Krisuna.json",
    Kromia:             "lists/Kromia.json",
    La_Wafflez:         "lists/La_Wafflez.json",
    LittleMiri_CZ:      "lists/LittleMiri_CZ.json",
    Luuna:              "lists/Luuna.json",
    Puck:               "lists/Puck.json",
    PuertoRicanPup:     "lists/PuertoRicanPup.json",
    RadiantSoul_Tv:     "lists/RadiantSoul_Tv.json",
    RadiantSoul_Tv_Sub: "lists/RadiantSoul_Tv_SubSounds.json",
    RinMunchkin:        "lists/RinMunchkin.json",
    SKTKawaiiNeko:      "lists/SKTKawaiiNeko.json",
    Taletrap:           "lists/Taletrap.json",
    Totless:            "lists/Totless.json",
    Wolfi_VR:           "lists/Wolfi_VR.json"
};

// TODO: move this fallback image to R2
const FALLBACK_EMOTE_IMAGE = "https://files.catbox.moe/ab5icu.png";

// ================== STATE ==================
let userFiles = {};
let triggerImages = {};
let avatars = {};
const listCache = new Map();     // point 3: cache parsed JSON per user
const globalSources = [];        // point 2: off window, module-level

// ================== AUDIO CONTEXT (point 1) ==================
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

// Fetch + decode audio buffer
async function fetchAndDecode(url) {
    const ctx = getAudioContext();
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    return await ctx.decodeAudioData(arrayBuffer);
}

// Stop all playing sounds globally
function stopAllSounds() {
    globalSources.forEach(src => {
        try { src.stop(); } catch(e) {}
        try { src.disconnect(); } catch(e) {}
    });
    globalSources.length = 0;
}

// Pick a weighted random sound from array [{clip, chance, volume}]
function pickWeighted(subSounds) {
    const table = [];
    subSounds.forEach(s => {
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

// Extract a readable filename from a sound URL (point 8)
function getSoundFilename(sound) {
    const url = Array.isArray(sound)
        ? (sound[0]?.clip || sound[0] || "")
        : (sound || "");
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

function isImageUrl(url) {
    return typeof url === "string" && url.startsWith("http");
}

// ================== 7TV EMOTE RESOLVER ==================
const emoteCache = new Map();

async function resolve7TVEmote(sevenTvUrl) {
    if (emoteCache.has(sevenTvUrl)) return emoteCache.get(sevenTvUrl);

    const match = sevenTvUrl.match(/emotes\/([a-zA-Z0-9]+)/);
    if (!match) return null;

    const emoteId = match[1];
    const res = await fetch(`https://7tv.io/v3/emotes/${emoteId}`);
    const data = await res.json();

    const resolved = {
        image: `https://cdn.7tv.app/emote/${data.id}/4x.webp`,
        link: sevenTvUrl,
        name: data.name
    };

    emoteCache.set(sevenTvUrl, resolved);
    return resolved;
}

// ================== RESOURCE LOADING ==================

// point 9: Try to load user list from lists/index.json, fall back to hardcoded object
async function loadUserFiles() {
    try {
        const res = await fetch("lists/index.json");
        if (res.ok) {
            console.log("Loaded user list from lists/index.json");
            return await res.json();
        }
    } catch {}
    console.log("lists/index.json not found, using built-in user list");
    return { ...FALLBACK_USER_FILES };
}

async function loadResources() {
    try {
        const resTriggers = await fetch("lists/internals/IconTriggers2.json");
        triggerImages = await resTriggers.json();
        const resAvatars = await fetch("lists/internals/avatars.json");
        avatars = await resAvatars.json();
    } catch(err) {
        console.error("Failed to load resources:", err);
        document.getElementById("list").innerHTML = "<p style='color:red;'>Failed to load resources.</p>";
    }
}

// ================== DOM HELPERS ==================

function createBackButton() {
    const btn = document.createElement("button");
    btn.textContent = "⬅ Back";
    btn.className = "back-btn";
    btn.addEventListener("click", () => {
        history.replaceState(null, "", " ");
        displayUserLists();
    });
    return btn;
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
    const container = document.getElementById("list");
    container.innerHTML = "";

    const searchInput = createSearchInput("Search users...", "user-search");
    container.appendChild(searchInput);

    const userDivs = [];

    Object.keys(userFiles).forEach(user => {
        const div = document.createElement("div");
        div.className = "sound-item";
        div.style.cursor = "pointer";

        const img = document.createElement("img");
        img.src = avatars[user] || "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png";
        img.alt = user;

        const link = document.createElement("a");
        link.href = `https://twitch.tv/${user}`;
        link.target = "_blank";
        link.appendChild(img);
        div.appendChild(link);

        const text = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = user;
        const span = document.createElement("span");
        span.textContent = "Click to view sounds";
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
        const query = searchInput.value.toLowerCase();
        userDivs.forEach(obj => {
            obj.div.style.display = obj.name.includes(query) ? "flex" : "none";
        });
    });
}

// Load and display a specific user's sounds
async function loadList(user) {
    try {
        let list;

        // point 3: use cached JSON if available
        if (listCache.has(user)) {
            list = listCache.get(user);
        } else {
            const res = await fetch(userFiles[user]);
            const data = await res.json();
            list = Array.isArray(data) ? data : Object.values(data).find(v => Array.isArray(v)) || [];
            listCache.set(user, list);
        }

        history.replaceState(null, "", "#" + user);
        displaySoundList(list, user);
    } catch(err) {
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
    const container = document.getElementById("list");
    container.innerHTML = "";

    const headerWrapper = document.createElement("div");
    headerWrapper.className = "header-wrapper";
    headerWrapper.appendChild(createBackButton());

    const searchInput = createSearchInput("Search emotes...");
    headerWrapper.appendChild(searchInput);
    container.appendChild(headerWrapper);

    if (!list.length) {
        const p = document.createElement("p");
        p.textContent = "No sounds found.";
        container.appendChild(p);
        return;
    }

    const emoteDivs = [];

    for (const item of list) {
        if (!item.enabled || item.enabled !== "true") continue;

        const div = document.createElement("div");
        div.className = "sound-item";
        div.style.position = "relative";

        // Loader
        const loader = document.createElement("div");
        loader.className = "loader";
        loader.style.cssText = "display:none; position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); z-index:10;";
        ["", "", ""].forEach(() => {
            const bar = document.createElement("span");
            bar.className = "bar";
            loader.appendChild(bar);
        });
        div.appendChild(loader);

        // Resolve emote image
        let emoteData = null;
        const triggerEntry = triggerImages[item.trigger_word];

        if (typeof triggerEntry === "string") {
            if (triggerEntry.includes("7tv.app/emotes")) {
                emoteData = await resolve7TVEmote(triggerEntry);
            } else if (isImageUrl(triggerEntry)) {
                emoteData = { image: triggerEntry, link: triggerEntry, name: item.trigger_word };
            }
        }

        if (!emoteData) {
            emoteData = { image: FALLBACK_EMOTE_IMAGE, link: "#", name: item.trigger_word };
        }

        // Emote image + link
        const emoteAnchor = document.createElement("a");
        emoteAnchor.href = emoteData.link;
        emoteAnchor.target = "_blank";
        const emoteImg = document.createElement("img");
        emoteImg.src = emoteData.image;
        emoteImg.alt = emoteData.name;
        emoteAnchor.appendChild(emoteImg);
        div.appendChild(emoteAnchor);

        // Text column
        const text = document.createElement("div");
        text.className = "sound-text";
        const strong = document.createElement("strong");
        strong.textContent = item.trigger_word;

        // point 8: show actual filename instead of generic "Sound Link"
        const soundLink = document.createElement("a");
        soundLink.href = getSoundLinkUrl(item.sound);
        soundLink.target = "_blank";
        soundLink.textContent = getSoundFilename(item.sound);

        text.appendChild(strong);
        text.appendChild(document.createElement("br"));
        text.appendChild(soundLink);
        div.appendChild(text);

        // Controls
        const controls = document.createElement("div");
        controls.className = "sound-controls";

        // Volume
        const volWrapper = document.createElement("div");
        volWrapper.className = "vol-wrapper";
        const volLabel = document.createElement("label");
        volLabel.textContent = "Vol";
        const volInput = document.createElement("input");
        volInput.type = "range"; volInput.min = "0"; volInput.max = "100";
        volInput.value = typeof item.volume === "number" ? Math.round(item.volume * 100) : 50;
        volWrapper.appendChild(volLabel);
        volWrapper.appendChild(volInput);

        // Speed
        const pitchRow = document.createElement("div");
        pitchRow.className = "pitch-row";
        const pitchLabel = document.createElement("label");
        pitchLabel.textContent = "Speed";
        const pitchInput = document.createElement("input");
        pitchInput.type = "number"; pitchInput.min = "50"; pitchInput.max = "200"; pitchInput.value = "100";
        pitchRow.appendChild(pitchLabel);
        pitchRow.appendChild(pitchInput);

        // Buttons
        const reverseBtn = document.createElement("button");
        reverseBtn.textContent = "Reverse ▶";
        reverseBtn.title = "Play reversed";
        reverseBtn.className = "reverse-btn";

        const stopBtn = document.createElement("button");
        stopBtn.textContent = "Stop All";
        stopBtn.className = "stop-btn";

        controls.appendChild(volWrapper);
        controls.appendChild(pitchRow);
        controls.appendChild(reverseBtn);
        controls.appendChild(stopBtn);
        div.appendChild(controls);

        // ================== AUDIO HANDLING ==================
        const bufferCache = new Map();
        const reversedCache = new Map();
        let playingCount = 0; // point 7: track active sources per card

        async function getBufferForUrl(url) {
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

            const ctx = getAudioContext(); // point 1: lazy context
            const buf = await getBufferForUrl(chosenUrl);

            let bufferToPlay = buf;
            if (reversed) {
                if (!reversedCache.has(chosenUrl)) reversedCache.set(chosenUrl, createReversedBuffer(buf));
                bufferToPlay = reversedCache.get(chosenUrl);
            }

            const src = ctx.createBufferSource();
            src.buffer = bufferToPlay;
            globalSources.push(src); // point 2: module-level array

            const gainNode = ctx.createGain();
            gainNode.gain.value = ((parseFloat(volInput.value) || 50) / 100) * (perSoundVolume != null ? perSoundVolume : 1);
            src.playbackRate.value = Math.max(0.01, (parseFloat(pitchInput.value) || 100) / 100);

            src.connect(gainNode).connect(ctx.destination);
            src.start(0);

            // point 7: add playing glow when sound starts
            playingCount++;
            div.classList.add("playing");

            src.onended = () => {
                try { src.disconnect(); gainNode.disconnect(); } catch(e) {}
                const idx = globalSources.indexOf(src);
                if (idx !== -1) globalSources.splice(idx, 1);

                // point 7: remove glow only when all sources from this card are done
                playingCount--;
                if (playingCount <= 0) {
                    playingCount = 0;
                    div.classList.remove("playing");
                }
            };

            return src;
        }

        div.addEventListener("click", e => {
            if (e.target.closest("a")) return;
            // point 4: visual error feedback on failed playback
            playRandomBuffer({ reversed: false }).catch(err => {
                console.error("Playback error:", err);
                div.classList.remove("sound-error");
                void div.offsetWidth; // force reflow so animation restarts if already erroring
                div.classList.add("sound-error");
            });
        });
        reverseBtn.addEventListener("click", e => {
            e.stopPropagation();
            playRandomBuffer({ reversed: true }).catch(err => {
                console.error("Playback error:", err);
                div.classList.remove("sound-error");
                void div.offsetWidth;
                div.classList.add("sound-error");
            });
        });
        stopBtn.addEventListener("click", e => {
            e.stopPropagation();
            stopAllSounds();
            playingCount = 0;
            div.classList.remove("playing");
        });
        pitchInput.addEventListener("keydown", ev => {
            if (ev.key === "Enter") ev.target.blur();
        });

        container.appendChild(div);
        emoteDivs.push({ div, trigger_word: item.trigger_word.toLowerCase() });
    }

    searchInput.addEventListener("input", () => {
        const query = searchInput.value.toLowerCase();
        emoteDivs.forEach(obj => {
            obj.div.style.display = obj.trigger_word.includes(query) ? "flex" : "none";
        });
    });
}

// ================== HASH NAVIGATION ==================
window.addEventListener("hashchange", () => {
    const hashUser = window.location.hash.slice(1);
    if (hashUser && userFiles[hashUser]) loadList(hashUser);
    else displayUserLists();
});

// ================== DARK/LIGHT MODE TOGGLE ==================
const darkModeSwitch = document.getElementById("darkModeSwitch").querySelector("input");
darkModeSwitch.checked = document.body.classList.contains("lightmode");
darkModeSwitch.addEventListener("change", () => {
    document.body.classList.toggle("lightmode", darkModeSwitch.checked);
});

// ================== INIT ==================
window.addEventListener("DOMContentLoaded", async () => {
    // point 10: show loading state immediately before anything fetches
    const listEl = document.getElementById("list");
    listEl.innerHTML = "<p class='loading-msg'>Loading...</p>";

    await loadResources();
    userFiles = await loadUserFiles(); // point 9

    const hashUser = window.location.hash.slice(1);
    if (hashUser && userFiles[hashUser]) loadList(hashUser);
    else displayUserLists();
});