// ================== MAIN ==================
// Entry point. Wires together loading, display, and browser navigation.
// All heavy logic lives in the other modules — this file stays thin.

import { loadUserFiles, loadResources, userFiles } from "./loader.js";
import { displayUserLists, loadList }              from "./display.js";
import "./particles.js"; // side-effect only — starts the canvas animation

// ── Browser back / forward ────────────────────────────────────────────────────
// popstate fires when the user presses back/forward or history.back() is called.
// push=false so we don't add a duplicate entry on top of the existing one.

window.addEventListener("popstate", () => {
  const hashUser = window.location.hash.slice(1);
  if (hashUser && userFiles[hashUser]) loadList(hashUser, false);
  else displayUserLists();
});

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", async () => {
  const listEl = document.getElementById("list");
  listEl.innerHTML = "<p class='loading-msg'>Loading...</p>";

  await loadResources();

  try {
    await loadUserFiles();
  } catch (err) {
    listEl.innerHTML = `<p style="color:red;">${err.message}</p>`;
    return;
  }

  const hashUser = window.location.hash.slice(1);
  if (hashUser && userFiles[hashUser]) loadList(hashUser, false);
  else displayUserLists();
});