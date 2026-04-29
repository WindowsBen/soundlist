/**
 * download-sounds.js
 *
 * Scans all JSON files in your lists/ folder, finds every sound URL,
 * and downloads them all into a local "sounds/" folder, named after
 * the trigger_word they belong to (e.g. catBoom.mp3 instead of mguhzd.mp3).
 *
 * Also writes sounds/url-map.json mapping old URLs → new filenames,
 * which update-links.js reads to rewrite your JSON files.
 *
 * Usage:
 *   node download-sounds.js
 *
 * Run this from the root of your repo (same folder as index.html).
 * After it finishes, upload the entire "sounds/" folder to R2,
 * then run: node update-links.js https://pub-xxxx.r2.dev
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const url   = require("url");

const LISTS_DIR  = path.join(__dirname, "lists");
const OUTPUT_DIR = path.join(__dirname, "sounds");

// ── Sanitize a trigger_word for use as a filename ───────────────────────────

function sanitize(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, "_")  // illegal filename chars
        .replace(/\s+/g, "_")            // spaces to underscores
        .trim();
}

// ── Extract all clip URLs from a sound value ─────────────────────────────────

function extractClipUrls(sound) {
    const clips = [];
    if (!sound) return clips;

    if (typeof sound === "string" && sound.startsWith("http")) {
        clips.push(sound);
    } else if (Array.isArray(sound)) {
        sound.forEach(v => {
            if (typeof v === "string" && v.startsWith("http")) clips.push(v);
            else if (v && typeof v === "object" && v.clip) clips.push(v.clip);
        });
    } else if (sound && typeof sound === "object" && sound.clip) {
        clips.push(sound.clip);
    }

    return clips;
}

// ── Collect all sounds with their trigger words ──────────────────────────────
//
// Returns an array of: { fileUrl, triggerWord, user }
// If the same URL appears under multiple trigger words, the first one wins.
// If the same trigger word appears in multiple users with different URLs,
// the filename becomes triggerWord_Username.ext to avoid collisions.

function collectSounds() {
    const urlToEntry = new Map();  // url -> { triggerWord, user, filename }
    const nameCount  = new Map();  // sanitized triggerWord -> count across all users

    const files = fs.readdirSync(LISTS_DIR).filter(f =>
        f.endsWith(".json") && !f.includes("internals")
    );

    for (const file of files) {
        const user = path.basename(file, ".json");
        try {
            const raw  = fs.readFileSync(path.join(LISTS_DIR, file), "utf8");
            const data = JSON.parse(raw);
            const list = Array.isArray(data)
                ? data
                : Object.values(data).find(v => Array.isArray(v)) || [];

            for (const item of list) {
                if (!item.trigger_word || !item.sound) continue;
                const clips = extractClipUrls(item.sound);

                for (const clipUrl of clips) {
                    if (urlToEntry.has(clipUrl)) continue; // same URL already mapped

                    const base = sanitize(item.trigger_word);
                    const ext  = path.extname(url.parse(clipUrl).pathname) || ".mp3";

                    // Track how many times this trigger_word name appears
                    const prev = nameCount.get(base) || 0;
                    nameCount.set(base, prev + 1);

                    urlToEntry.set(clipUrl, {
                        fileUrl:     clipUrl,
                        triggerWord: item.trigger_word,
                        user,
                        baseName:    base,
                        ext
                    });
                }
            }
        } catch(e) {
            console.warn(`  Skipping ${file}: ${e.message}`);
        }
    }

    // Resolve collisions: if a baseName appears more than once, append _Username
    const namesSeen = new Map(); // baseName -> count of how many we've assigned so far

    const entries = [];
    for (const entry of urlToEntry.values()) {
        const count = nameCount.get(entry.baseName) || 1;
        let filename;

        if (count > 1) {
            // Same trigger_word in multiple users — disambiguate with username
            filename = `${entry.baseName}_${sanitize(entry.user)}${entry.ext}`;
        } else {
            filename = `${entry.baseName}${entry.ext}`;
        }

        // Last-resort dedup: if somehow filename still collides, append a counter
        const seen = namesSeen.get(filename) || 0;
        namesSeen.set(filename, seen + 1);
        if (seen > 0) filename = filename.replace(entry.ext, `_${seen}${entry.ext}`);

        entries.push({ ...entry, filename });
    }

    return entries;
}

// ── Download a single file ──────────────────────────────────────────────────

function download(fileUrl, destPath) {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(destPath)) {
            console.log(`  ⏭  Already exists, skipping: ${path.basename(destPath)}`);
            return resolve();
        }

        const proto     = fileUrl.startsWith("https") ? https : http;
        const tmp       = destPath + ".tmp";
        const file      = fs.createWriteStream(tmp);
        const parsedUrl = url.parse(fileUrl);

        const options = {
            hostname: parsedUrl.hostname,
            path:     parsedUrl.path,
            headers:  {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
        };

        const request = proto.get(options, res => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                fs.unlinkSync(tmp);
                return download(res.headers.location, destPath).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                file.close();
                fs.unlinkSync(tmp);
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            res.pipe(file);
            file.on("finish", () => {
                file.close();
                fs.renameSync(tmp, destPath);
                resolve();
            });
        });

        request.on("error", err => {
            if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
            reject(err);
        });
    });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

    console.log("Scanning JSON files for sound URLs...");
    const entries = collectSounds();
    console.log(`Found ${entries.length} unique sound URLs.\n`);

    let success = 0;
    let failed  = 0;
    const failures = [];
    const urlMap   = {}; // old url -> new filename (written for update-links.js)

    for (const entry of entries) {
        const destPath = path.join(OUTPUT_DIR, entry.filename);
        process.stdout.write(`  ⬇  ${entry.triggerWord} → ${entry.filename}... `);

        try {
            await download(entry.fileUrl, destPath);
            console.log("✓");
            urlMap[entry.fileUrl] = entry.filename;
            success++;
        } catch(err) {
            console.log(`✗  ${err.message}`);
            failures.push({ url: entry.fileUrl, trigger: entry.triggerWord, error: err.message });
            failed++;
        }
    }

    // Write url-map.json so update-links.js knows the new filenames
    const mapPath = path.join(OUTPUT_DIR, "url-map.json");
    fs.writeFileSync(mapPath, JSON.stringify(urlMap, null, 2), "utf8");
    console.log(`\nWrote url-map.json with ${Object.keys(urlMap).length} entries.`);

    console.log(`\nDone. ${success} downloaded, ${failed} failed.`);

    if (failures.length) {
        const logPath = path.join(__dirname, "download-failures.log");
        fs.writeFileSync(logPath, failures.map(f => `[${f.trigger}] ${f.url}\n  ${f.error}`).join("\n\n"));
        console.log(`Failed URLs written to: download-failures.log`);
    }

    console.log(`\nNext step: Upload everything in the "sounds/" folder to your R2 bucket.`);
    console.log(`           (You can skip url-map.json — that's only used locally.)`);
    console.log(`Then run:  node update-links.js https://pub-xxxx.r2.dev`);
}

main().catch(err => { console.error(err); process.exit(1); });