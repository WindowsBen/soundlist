/**
 * update-links.js
 *
 * Rewrites every sound URL in all your JSON files to point to your R2 bucket,
 * using the renamed filenames produced by download-sounds.js.
 *
 * Usage:
 *   node update-links.js https://pub-xxxx.r2.dev
 *
 * Run this AFTER uploading your sounds/ folder to R2.
 * Run it from the root of your repo (same folder as index.html).
 *
 * Requires sounds/url-map.json to exist (created by download-sounds.js).
 * A backup of each original JSON file is saved as filename.json.bak
 * before any changes are made.
 */

const fs   = require("fs");
const path = require("path");

const LISTS_DIR = path.join(__dirname, "lists");
const MAP_PATH  = path.join(__dirname, "sounds", "url-map.json");

// ── Get R2 base URL from args ────────────────────────────────────────────────

const r2Base = (process.argv[2] || "").replace(/\/$/, "");

if (!r2Base || !r2Base.startsWith("http")) {
    console.error("Usage: node update-links.js https://pub-xxxx.r2.dev");
    process.exit(1);
}

// ── Load url-map.json ────────────────────────────────────────────────────────

if (!fs.existsSync(MAP_PATH)) {
    console.error("sounds/url-map.json not found. Run download-sounds.js first.");
    process.exit(1);
}

const urlMap = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
console.log(`Loaded url-map.json with ${Object.keys(urlMap).length} entries.`);
console.log(`R2 base URL: ${r2Base}\n`);

// ── Rewrite a sound URL using the map ───────────────────────────────────────

function rewriteUrl(oldUrl) {
    if (typeof oldUrl !== "string" || !oldUrl.startsWith("http")) return oldUrl;
    if (urlMap[oldUrl]) return `${r2Base}/${urlMap[oldUrl]}`;
    // URL not in map (wasn't downloaded / failed) — leave it unchanged
    console.warn(`  ⚠  No mapping found for: ${oldUrl}`);
    return oldUrl;
}

// ── Recursively rewrite sound-bearing fields ─────────────────────────────────

function rewriteValue(value) {
    if (typeof value === "string") return rewriteUrl(value);
    if (Array.isArray(value))      return value.map(rewriteValue);
    if (value && typeof value === "object") {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = (k === "sound" || k === "clip") ? rewriteValue(v) : v;
        }
        return out;
    }
    return value;
}

// ── Process a single JSON file ───────────────────────────────────────────────

function processFile(filePath) {
    const raw  = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);

    const list = Array.isArray(data)
        ? data
        : Object.values(data).find(v => Array.isArray(v));

    if (!list) {
        console.warn(`  Skipping ${path.basename(filePath)}: no sound array found`);
        return false;
    }

    let changeCount = 0;

    const updatedList = list.map(item => {
        if (!item.sound) return item;
        const before = JSON.stringify(item.sound);
        const after  = rewriteValue(item.sound);
        if (JSON.stringify(after) !== before) changeCount++;
        return { ...item, sound: after };
    });

    if (changeCount === 0) {
        console.log(`  ⏭  No changes needed: ${path.basename(filePath)}`);
        return false;
    }

    // Back up original before writing
    fs.copyFileSync(filePath, filePath + ".bak");

    let updatedData;
    if (Array.isArray(data)) {
        updatedData = updatedList;
    } else {
        updatedData = { ...data };
        for (const [k, v] of Object.entries(data)) {
            if (Array.isArray(v)) { updatedData[k] = updatedList; break; }
        }
    }

    fs.writeFileSync(filePath, JSON.stringify(updatedData, null, 2), "utf8");
    console.log(`  ✓  Updated ${changeCount} sound(s): ${path.basename(filePath)}`);
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
    const files = fs.readdirSync(LISTS_DIR).filter(f =>
        f.endsWith(".json") && !f.includes("internals")
    );

    console.log(`Found ${files.length} JSON files to process.\n`);

    let updated = 0;
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(LISTS_DIR, file);
        try {
            const changed = processFile(filePath);
            if (changed) updated++; else skipped++;
        } catch(e) {
            console.warn(`  ✗  Failed ${file}: ${e.message}`);
        }
    }

    console.log(`\nDone. ${updated} files updated, ${skipped} files unchanged.`);
    console.log(`Original files backed up as *.json.bak — delete them once you've verified everything works.`);
}

main();