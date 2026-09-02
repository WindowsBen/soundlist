// ================== UI HELPERS ==================
// Reusable DOM factory functions used across display.js.
// No imports needed — no dependency on app state.

// Glow divs for the notification card design
// https://uiverse.io/SouravBandyopadhyay/rude-tiger-29
export function addCardGlows(div) {
  const notiglow = document.createElement("div");
  notiglow.className = "notiglow";
  const notiborderglow = document.createElement("div");
  notiborderglow.className = "notiborderglow";
  div.prepend(notiborderglow);
  div.prepend(notiglow);
}

// Extract a human-readable filename from a sound value
export function getSoundFilename(sound) {
  const url = Array.isArray(sound) ? sound[0]?.clip || sound[0] || "" : sound || "";
  if (!url || url === "#") return "Sound Link";
  try {
    const parts = new URL(url).pathname.split("/");
    return decodeURIComponent(parts[parts.length - 1]) || "Sound Link";
  } catch {
    return "Sound Link";
  }
}

export function getSoundLinkUrl(sound) {
  if (Array.isArray(sound)) return sound[0]?.clip || sound[0] || "#";
  return sound || "#";
}

// Dark/light mode toggle switch — creates a fresh one each render
// so it always reflects current body state
export function createDarkModeToggle() {
  const label = document.createElement("label");
  label.className = "switch";
  const input = document.createElement("input");
  input.type    = "checkbox";
  input.checked = document.body.classList.contains("lightmode");
  const span    = document.createElement("span");
  span.className = "slider";
  label.appendChild(input);
  label.appendChild(span);
  input.addEventListener("change", () => {
    document.body.classList.toggle("lightmode", input.checked);
  });
  return label;
}

export function createBackButton() {
  const btn = document.createElement("button");
  btn.textContent = "⬅ Back";
  btn.className   = "back-btn";
  btn.addEventListener("click", () => history.back());
  return btn;
}

export function createSearchInput(placeholder, extraClass = "") {
  const input       = document.createElement("input");
  input.type        = "text";
  input.placeholder = placeholder;
  input.className   = "search-input" + (extraClass ? " " + extraClass : "");
  return input;
}