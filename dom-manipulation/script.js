/*********************
 * Config & Constants
 *********************/
const SERVER_URL = "https://jsonplaceholder.typicode.com/posts";
const SYNC_INTERVAL_MS = 30000;

// Keys in localStorage
const LS_QUOTES = "quotes";
const LS_SELECTED_CATEGORY = "selectedCategory";
const LS_AUTO_SYNC = "autoSync";
const LS_LAST_SYNC = "lastSync";

/*********************
 * State
 *********************/
let quotes = loadQuotes();
let conflictQueue = []; // {id, local, server, resolution: 'server'|'local'|null}
let autoSyncTimer = null;

/*********************
 * DOM
 *********************/
const quoteDisplay = document.getElementById("quoteDisplay");
const categoryFilter = document.getElementById("categoryFilter");
const newQuoteBtn = document.getElementById("newQuote");
const addQuoteBtn = document.getElementById("addQuoteBtn");
const newQuoteText = document.getElementById("newQuoteText");
const newQuoteCategory = document.getElementById("newQuoteCategory");
const exportBtn = document.getElementById("exportBtn");
const importFile = document.getElementById("importFile");

const syncNowBtn = document.getElementById("syncNowBtn");
const autoSyncToggle = document.getElementById("autoSyncToggle");
const reviewConflictsBtn = document.getElementById("reviewConflictsBtn");
const syncSummary = document.getElementById("syncSummary");

const conflictModal = document.getElementById("conflictModal");
const conflictList = document.getElementById("conflictList");
const closeConflictModalBtn = document.getElementById("closeConflictModal");
const applyAllServerBtn = document.getElementById("applyAllServer");
const applyAllLocalBtn = document.getElementById("applyAllLocal");

/*********************
 * Storage Helpers
 *********************/
function loadQuotes() {
  const saved = localStorage.getItem(LS_QUOTES);
  if (saved) {
    try {
      const arr = JSON.parse(saved);
      // migrate older shapes if needed
      return arr.map(q => ({
        id: q.id || (q.source === "server" ? `server-${Math.random().toString(36).slice(2)}` : `local-${Date.now()}`),
        text: q.text,
        category: q.category,
        updatedAt: q.updatedAt || new Date().toISOString(),
        source: q.source || "local",
        synced: q.synced ?? (q.source === "server")
      }));
    } catch {
      return seedQuotes();
    }
  }
  return seedQuotes();
}

function seedQuotes() {
  const seeded = [
    { id: `local-${Date.now()}-1`, text: "The best way to get started is to quit talking and begin doing.", category: "Motivation", updatedAt: new Date().toISOString(), source: "local", synced: false },
    { id: `local-${Date.now()}-2`, text: "Don’t let yesterday take up too much of today.", category: "Motivation", updatedAt: new Date().toISOString(), source: "local", synced: false },
    { id: `local-${Date.now()}-3`, text: "Your time is limited, so don’t waste it living someone else’s life.", category: "Life", updatedAt: new Date().toISOString(), source: "local", synced: false },
    { id: `local-${Date.now()}-4`, text: "If life were predictable it would cease to be life, and be without flavor.", category: "Life", updatedAt: new Date().toISOString(), source: "local", synced: false },
    { id: `local-${Date.now()}-5`, text: "The greatest glory in living lies not in never falling, but in rising every time we fall.", category: "Inspiration", updatedAt: new Date().toISOString(), source: "local", synced: false },
  ];
  localStorage.setItem(LS_QUOTES, JSON.stringify(seeded));
  return seeded;
}

function saveQuotes() {
  localStorage.setItem(LS_QUOTES, JSON.stringify(quotes));
}

/*********************
 * UI: Categories & Display
 *********************/
function populateCategories() {
  const categories = [...new Set(quotes.map(q => q.category))].sort((a, b) => a.localeCompare(b));
  categoryFilter.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "All";
  allOption.textContent = "All Categories";
  categoryFilter.appendChild(allOption);

  categories.forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    categoryFilter.appendChild(option);
  });

  const savedFilter = localStorage.getItem(LS_SELECTED_CATEGORY);
  if (savedFilter && [...categoryFilter.options].some(o => o.value === savedFilter)) {
    categoryFilter.value = savedFilter;
  } else {
    categoryFilter.value = "All";
  }
}

function displayQuotesList(list) {
  quoteDisplay.innerHTML = "";
  if (!list.length) {
    quoteDisplay.textContent = "No quotes available for this filter.";
    return;
  }
  list.forEach(q => {
    const div = document.createElement("div");
    div.className = "quoteItem";
    div.innerHTML = `
      "${q.text}"
      <div class="category">— ${q.category} <span class="badge">${q.source}</span></div>
    `;
    quoteDisplay.appendChild(div);
  });
}

function filterQuotes() {
  const selectedCategory = categoryFilter.value;
  localStorage.setItem(LS_SELECTED_CATEGORY, selectedCategory);

  const list = selectedCategory === "All" ? quotes : quotes.filter(q => q.category === selectedCategory);
  displayQuotesList(list);
}

function showRandomQuote() {
  if (!quotes.length) return;
  const randomIndex = Math.floor(Math.random() * quotes.length);
  const q = quotes[randomIndex];
  quoteDisplay.innerHTML = `"${q.text}" <div class="category">— ${q.category} <span class="badge">${q.source}</span></div>`;
}

/*********************
 * Add / Import / Export
 *********************/
function addQuote() {
  const text = newQuoteText.value.trim();
  const category = newQuoteCategory.value.trim();

  if (!text || !category) {
    alert("Please fill in both fields!");
    return;
  }

  const q = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text,
    category,
    updatedAt: new Date().toISOString(),
    source: "local",
    synced: false
  };

  quotes.push(q);
  saveQuotes();
  populateCategories();
  filterQuotes();

  newQuoteText.value = "";
  newQuoteCategory.value = "";
  alert("Quote added locally! It will sync to server on the next sync.");
}

function exportQuotes() {
  const blob = new Blob([JSON.stringify(quotes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "quotes.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importFromJsonFile(event) {
  const fileReader = new FileReader();
  fileReader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Invalid format");
      // Normalize and merge
      const normalized = imported.map(q => ({
        id: q.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        text: q.text,
        category: q.category,
        updatedAt: q.updatedAt || new Date().toISOString(),
        source: q.source || "local",
        synced: q.synced ?? false
      }));
      quotes.push(...normalized);
      saveQuotes();
      populateCategories();
      filterQuotes();
      alert("Quotes imported successfully!");
    } catch {
      alert("Invalid JSON file format!");
    }
  };
  fileReader.readAsText(event.target.files[0]);
}

/*********************
 * Server Sync (Simulated)
 *********************/
// Map JSONPlaceholder posts to "server quotes"
function mapPostsToQuotes(posts) {
  // Use post.title as text; derive category from userId
  return posts.map(p => ({
    id: `server-${p.id}`, // server-stable id
    text: (p.title || "").trim(), // keep it short/clean
    category: `Server Cat ${p.userId}`, // simple derived category
    updatedAt: new Date().toISOString(), // simulate "freshness"
    source: "server",
    synced: true
  }));
}

// Fetch server-side quotes (simulation)
async function fetchServerQuotes(limit = 10) {
  const res = await fetch(`${SERVER_URL}?_limit=${limit}`);
  if (!res.ok) throw new Error(`Server fetch failed (${res.status})`);
  const posts = await res.json();
  return mapPostsToQuotes(posts);
}

// Push local unsynced quotes to server (simulation)
async function pushLocalQuotes(localUnsynced) {
  let successCount = 0;
  for (const q of localUnsynced) {
    try {
      const res = await fetch(SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: q.text, body: q.text, userId: 1 })
      });
      if (res.ok) {
        // JSONPlaceholder returns a fake id; treat as "synced"
        q.synced = true;
        q.source = "local"; // still local origin, but synced
        successCount++;
      }
    } catch {
      // ignore per-item error; overall status will show issues
    }
  }
  return successCount;
}

// Merge server quotes into local, detect conflicts
function mergeServerData(serverQuotes, autoResolve = true) {
  let added = 0, updated = 0, conflictsFound = 0;
  const byId = new Map(quotes.map(q => [q.id, q]));

  for (const s of serverQuotes) {
    if (!byId.has(s.id)) {
      // New from server → add
      quotes.push(s);
      added++;
      continue;
    }
    const local = byId.get(s.id);
    // Same id exists both sides → potential conflict if fields differ
    const differs =
      local.text !== s.text ||
      local.category !== s.category;

    if (differs) {
      conflictsFound++;
      if (autoResolve) {
        // server-wins auto policy
        conflictQueue.push({ id: s.id, local: { ...local }, server: { ...s }, resolution: "server" });
        Object.assign(local, s); // overwrite local with server
        updated++;
      } else {
        // queue for manual resolution; leave local as-is for now
        const existing = conflictQueue.find(c => c.id === s.id);
        if (!existing) conflictQueue.push({ id: s.id, local: { ...local }, server: { ...s }, resolution: null });
      }
    } else {
      // No difference; ensure it's marked as synced and source kept as server
      local.synced = true;
      local.source = "server";
    }
  }

  saveQuotes();
  return { added, updated, conflictsFound };
}

function updateSyncSummary({ added = 0, updated = 0, conflicts = 0, pushed = 0 } = {}) {
  const last = new Date().toLocaleString();
  localStorage.setItem(LS_LAST_SYNC, last);
  const parts = [];
  if (added) parts.push(`added ${added}`);
  if (updated) parts.push(`updated ${updated}`);
  if (pushed) parts.push(`pushed ${pushed} local`);
  if (conflicts) parts.push(`conflicts ${conflicts}`);
  syncSummary.textContent = parts.length ? `Last sync ${last}: ${parts.join(", ")}.` : `Last sync ${last}: no changes.`;
  reviewConflictsBtn.classList.toggle("hidden", conflictQueue.filter(c => c.resolution === null).length === 0);
}

/*********************
 * Conflict Modal
 *********************/
function openConflictModal() {
  conflictList.innerHTML = "";
  const pending = conflictQueue.filter(c => c.resolution === null);
  if (!pending.length) {
    const info = document.createElement("div");
    info.textContent = "No pending conflicts.";
    conflictList.appendChild(info);
  } else {
    pending.forEach(c => {
      const wrap = document.createElement("div");
      wrap.className = "conflict";
      wrap.innerHTML = `
        <h4>ID: ${c.id}</h4>
        <div class="cols">
          <div class="box">
            <strong>Local</strong><br/>
            "<em>${c.local.text}</em>"<br/>
            <span class="category">— ${c.local.category}</span>
          </div>
          <div class="box">
            <strong>Server</strong><br/>
            "<em>${c.server.text}</em>"<br/>
            <span class="category">— ${c.server.category}</span>
          </div>
        </div>
      `;
      const actions = document.createElement("div");
      actions.className = "actions";
      const keepLocal = document.createElement("button");
      keepLocal.textContent = "Keep Local";
      keepLocal.onclick = () => {
        // replace server version with local in our store
        const idx = quotes.findIndex(q => q.id === c.id);
        if (idx !== -1) {
          quotes[idx] = { ...c.local, synced: false }; // mark unsynced, will re-push
          saveQuotes();
          filterQuotes();
        }
        c.resolution = "local";
        wrap.remove();
      };
      const useServer = document.createElement("button");
      useServer.textContent = "Use Server";
      useServer.onclick = () => {
        const idx = quotes.findIndex(q => q.id === c.id);
        if (idx !== -1) {
          quotes[idx] = { ...c.server, synced: true };
          saveQuotes();
          filterQuotes();
        }
        c.resolution = "server";
        wrap.remove();
      };
      actions.appendChild(keepLocal);
      actions.appendChild(useServer);
      wrap.appendChild(actions);
      conflictList.appendChild(wrap);
    });
  }
  conflictModal.style.display = "flex";
}

function closeConflictModal() {
  conflictModal.style.display = "none";
}

applyAllServerBtn.onclick = () => {
  const pending = conflictQueue.filter(c => c.resolution === null);
  pending.forEach(c => {
    const idx = quotes.findIndex(q => q.id === c.id);
    if (idx !== -1) quotes[idx] = { ...c.server, synced: true };
    c.resolution = "server";
  });
  saveQuotes();
  filterQuotes();
  conflictList.innerHTML = "<div>Applied server version for all pending conflicts.</div>";
};

applyAllLocalBtn.onclick = () => {
  const pending = conflictQueue.filter(c => c.resolution === null);
  pending.forEach(c => {
    const idx = quotes.findIndex(q => q.id === c.id);
    if (idx !== -1) quotes[idx] = { ...c.local, synced: false };
    c.resolution = "local";
  });
  saveQuotes();
  filterQuotes();
  conflictList.innerHTML = "<div>Kept local version for all pending conflicts.</div>";
};

/*********************
 * Sync Orchestration
 *********************/
async function syncOnce({ autoResolve = true } = {}) {
  try {
    // 1) Push unsynced local quotes
    const unsynced = quotes.filter(q => q.source === "local" && !q.synced);
    const pushed = await pushLocalQuotes(unsynced);

    // 2) Fetch fresh server quotes
    const serverQuotes = await fetchServerQuotes(12);

    // 3) Merge (server-wins if autoResolve)
    const { added, updated, conflictsFound } = mergeServerData(serverQuotes, autoResolve);

    // 4) Update UI
    updateSyncSummary({ added, updated, pushed, conflicts: conflictsFound });
    populateCategories();
    filterQuotes();
  } catch (err) {
    syncSummary.textContent = `Sync failed: ${err.message}`;
  }
}

function startAutoSync() {
  stopAutoSync();
  autoSyncTimer = setInterval(() => {
    const autoResolve = true; // default background policy: server-wins
    syncOnce({ autoResolve });
  }, SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  autoSyncTimer = null;
}

/*********************
 * Events
 *********************/
newQuoteBtn.addEventListener("click", showRandomQuote);
addQuoteBtn.addEventListener("click", addQuote);
exportBtn.addEventListener("click", exportQuotes);
importFile.addEventListener("change", importFromJsonFile);
categoryFilter.addEventListener("change", filterQuotes);

syncNowBtn.addEventListener("click", () => {
  // Manual sync uses auto-resolve policy (server-wins) by default.
  // For manual conflict handling, toggle off below and click "Review Conflicts".
  syncOnce({ autoResolve: true });
});

autoSyncToggle.addEventListener("change", (e) => {
  const enabled = e.target.checked;
  localStorage.setItem(LS_AUTO_SYNC, enabled ? "1" : "0");
  if (enabled) startAutoSync(); else stopAutoSync();
});

reviewConflictsBtn.addEventListener("click", openConflictModal);
closeConflictModalBtn.addEventListener("click", closeConflictModal);

/*********************
 * Init
 *********************/
(function init() {
  // restore auto-sync preference
  const autoPref = localStorage.getItem(LS_AUTO_SYNC) === "1";
  autoSyncToggle.checked = autoPref;

  populateCategories();
  filterQuotes();

  // show last sync time if any
  const last = localStorage.getItem(LS_LAST_SYNC);
  if (last) syncSummary.textContent = `Last sync ${last}.`;

  if (autoPref) startAutoSync();
})();
