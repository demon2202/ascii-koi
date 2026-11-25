/*
 * The page around the pond: the clock and the day (or your own words) in
 * character cells, the date under them, the three waters, and the controls.
 *
 *   ?theme=pond|black|light    the water (remembered when you switch)
 *   ?title=One%20Page&tag=is%20all%20you%20need   your own words instead of the clock
 *   ?ui=0                       no controls (for a wallpaper or a recording)
 *   keys: 1 2 3 or T for the water, space to pause
 */
(() => {
  "use strict";
  const { createPond, AsciiMark } = window.AsciiKoi;
  const root = document.documentElement;
  const q = new URLSearchParams(location.search);
  const THEMES = ["pond", "black", "light"];
  const KEY = "ascii-koi-theme";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private window: not remembered */ } }
  };

  /* the water: the URL, then a page that fixes it (light.html …), then the last one chosen, then the pond */
  const fixed = root.dataset.lock;
  const first = [q.get("theme"), fixed, store.get(), "pond"].find(v => THEMES.includes(v));
  root.dataset.theme = first;

  const pondCanvas = document.getElementById("pond");
  const box = document.getElementById("intro-box");
  const titleCanvas = document.getElementById("wordmark");
  const tagCanvas = document.getElementById("wordmark-tag");
  const srTitle = document.getElementById("sr-title");
  const dateCanvas = document.getElementById("intro-date");
  const ui = document.getElementById("ui");
  if (q.get("ui") === "0") ui.hidden = true;
  if (location.protocol === "chrome-extension:") document.getElementById("gh")?.remove();

  const cssVar = n => getComputedStyle(root).getPropertyValue(n).trim();
  const palette = () => ({
    water: cssVar("--pond"), ink: cssVar("--ink"), accent: cssVar("--accent"),
    koiLight: cssVar("--koi-light"), koiDark: cssVar("--koi-dark"),
    dark: cssVar("color-scheme").includes("dark")
  });

  const pond = createPond({
    canvas: pondCanvas, palette, reduce,
    /* the title's box in pond pixels: the koi fade under it, so the letters can wear their colour */
    dim: () => { const r = box.getBoundingClientRect(); return r.width ? r : null; }
  });
  pond.size(innerWidth, innerHeight);
  window.AsciiKoi.pond = pond;

  /* ── the words: the time as the title, the day under it, then the date ── */
  const own = q.get("title");
  const narrow = () => innerWidth < 720;
  const words = () => {
    const now = new Date();
    const date = now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    if (own) return { title: own, tag: q.get("tag") || "", date };
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
    return { title: time, tag: now.toLocaleDateString("en-GB", { weekday: "long" }), date };
  };
  let current = words();
  const serif = `"Noto Serif Display", "Iowan Old Style", Georgia, serif`;
  /* the words take on the koi colour and the water's light in the pond under them */
  const look = { tint: pond.tint, light: pond.light };
  const title = AsciiMark(titleCanvas, () => ({
    text: current.title, font: `700 ${narrow() ? 120 : own ? 170 : 230}px ${serif}`,
    cw: narrow() ? 4 : 7, ch: narrow() ? 5 : 9, maxW: Math.min(innerWidth * (narrow() ? 0.9 : 0.8), own ? 700 : 820), edge: true, glow: 1
  }), look);
  /* the day, drawn the same way as the clock, with crisp pixel spread and full colour */
  const tag = AsciiMark(tagCanvas, () => ({
    text: current.tag || " ", font: `700 ${narrow() ? 68 : 90}px ${serif}`,
    cw: narrow() ? 4 : 5, ch: narrow() ? 5 : 6, maxW: Math.min(innerWidth * (narrow() ? 0.72 : 0.48), 460), tone: 0.96, edge: !narrow(), glow: 0.85
  }), look);
  const dateMark = AsciiMark(dateCanvas, () => ({
    text: current.date || " ", font: `700 ${narrow() ? 26 : 34}px ${serif}`,
    cw: 3, ch: 4, maxW: Math.min(innerWidth * (narrow() ? 0.85 : 0.6), 560), tone: 1, edge: false, glow: 0.7
  }), look);
  const clock = () => performance.now() / 1000;
  const buildWords = () => Promise.all([title.build(clock()), tag.build(clock() + 0.35), dateMark.build(clock() + 0.6)]);
  srTitle.textContent = own ? `${current.title} ${current.tag}` : "ASCII Koi";

  let lastWords = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    /* the words redraw at about 15 fps, like a sign; the koi under them move at full rate */
    if (now - lastWords < 66) return;
    lastWords = now;
    const s = now / 1000;
    title.draw(s); tag.draw(s); dateMark.draw(s);
    if (!own) {
      const w = words();
      if (w.title !== current.title || w.tag !== current.tag || w.date !== current.date) { current = w; buildWords(); }
    }
  }

  /* ── the waters ── */
  const snap = document.getElementById("snap");
  const picks = [...document.querySelectorAll("[data-theme-pick]")];
  function mark() {
    for (const b of picks) b.setAttribute("aria-checked", String(b.dataset.themePick === root.dataset.theme));
  }
  /*
   * A new water spreads like a ripple from where you chose it: the old frame
   * (pond, words and their glow) is kept on a canvas on top, and a widening
   * hole in it shows the new water underneath.
   */
  function setTheme(name, at) {
    if (!THEMES.includes(name) || name === root.dataset.theme) return;
    const dpr = pondCanvas.width / innerWidth;
    if (!reduce) {
      snap.width = pondCanvas.width; snap.height = pondCanvas.height;
      const s = snap.getContext("2d");
      s.drawImage(pondCanvas, 0, 0);
      for (const [m, cv] of [[title, titleCanvas], [tag, tagCanvas], [dateMark, dateCanvas]]) {
        for (const c of [m.glow, cv]) {
          const r = c && c.getBoundingClientRect();
          if (!r || !r.width || !c.width) continue;
          s.filter = c === m.glow ? `blur(${14 * dpr}px)` : "none";
          s.drawImage(c, r.left * dpr, r.top * dpr, r.width * dpr, r.height * dpr);
        }
      }
      s.filter = "none";
      s.setTransform(1, 0, 0, 1, 0, 0); s.globalAlpha = 1;
      const x = at ? at.x : innerWidth / 2, y = at ? at.y : innerHeight / 2;
      snap.style.setProperty("--x", x + "px");
      snap.style.setProperty("--y", y + "px");
      snap.classList.remove("wipe");
      snap.classList.add("show");
      void snap.offsetWidth;
      snap.classList.add("wipe");
    }
    root.dataset.theme = name;
    if (!fixed) store.set(name);
    pond.colors();
    mark();
  }
  snap.addEventListener("transitionend", () => snap.classList.remove("show", "wipe"));
  for (const b of picks) b.addEventListener("click", e => {
    const r = b.getBoundingClientRect();
    setTheme(b.dataset.themePick, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
    e.stopPropagation();
  });
  mark();

  /* ── the hands, paw toggle & dock toggle ── */
  const PAW_KEY = "ascii-koi-paw";
  const DOCK_KEY = "ascii-koi-dock";
  const pawBtn = document.getElementById("paw-toggle");
  const dockBtn = document.getElementById("dock-toggle");
  const shortcutsEl = document.getElementById("shortcuts");
  let pawEnabled = (() => { try { return localStorage.getItem(PAW_KEY) !== "0"; } catch (e) { return true; } })();
  let dockOpen = (() => { try { return localStorage.getItem(DOCK_KEY) !== "0"; } catch (e) { return true; } })();

  const syncPawUi = () => {
    document.body.classList.toggle("paw-on", pawEnabled);
    if (!pawBtn) return;
    pawBtn.setAttribute("aria-pressed", String(pawEnabled));
    pawBtn.title = pawEnabled ? "Cat paw: on" : "Cat paw: off";
  };
  const syncDockUi = () => {
    if (shortcutsEl) shortcutsEl.hidden = !dockOpen;
    if (!dockBtn) return;
    dockBtn.setAttribute("aria-pressed", String(dockOpen));
    dockBtn.title = dockOpen ? "Shortcuts: shown" : "Shortcuts: hidden";
  };
  pawBtn?.addEventListener("click", e => {
    e.stopPropagation();
    pawEnabled = !pawEnabled;
    try { localStorage.setItem(PAW_KEY, pawEnabled ? "1" : "0"); } catch (e) { /* private window */ }
    syncPawUi();
  });
  dockBtn?.addEventListener("click", e => {
    e.stopPropagation();
    dockOpen = !dockOpen;
    try { localStorage.setItem(DOCK_KEY, dockOpen ? "1" : "0"); } catch (e) { /* private window */ }
    syncDockUi();
  });
  syncPawUi();
  syncDockUi();

  const onUi = e => e.target.closest && e.target.closest(".ui, .shortcuts, .top-controls");
  let held = null, fedAt = 0;
  const feedAt = (x, y) => { const now = performance.now(); if (now - fedAt < 500) return; fedAt = now; pond.feed(x, y); };
  addEventListener("pointerdown", e => {
    if (e.button !== 0 || onUi(e)) return;
    /* a tap is a paw (when enabled), a long press is food */
    if (e.pointerType === "touch" || e.pointerType === "pen") {
      clearTimeout(held?.timer);
      held = { x: e.clientX, y: e.clientY, at: performance.now(), timer: setTimeout(() => { if (held) { feedAt(held.x, held.y); held = null; } }, 450) };
      return;
    }
    if (pawEnabled) pond.paw(e.clientX, e.clientY);
  });
  addEventListener("pointermove", e => { if (held && Math.hypot(e.clientX - held.x, e.clientY - held.y) > 14) { clearTimeout(held.timer); held = null; } });
  addEventListener("pointerup", () => { if (held) { clearTimeout(held.timer); if (pawEnabled) pond.paw(held.x, held.y); held = null; } });
  addEventListener("pointercancel", () => { if (held) clearTimeout(held.timer); held = null; });
  addEventListener("contextmenu", e => {
    if (onUi(e)) return;
    e.preventDefault();
    if (held) { clearTimeout(held.timer); held = null; }
    feedAt(e.clientX, e.clientY);
  });

  /* ── quick-access shortcuts (user-managed + chrome.storage.sync backup + drag-reorder) ── */
  const CUSTOM_KEY = "ascii-koi-shortcuts";
  const readShortcuts = () => {
    try {
      const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  };
  const writeShortcuts = v => {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(v)); } catch (e) { /* private window */ }
    if (typeof chrome !== "undefined" && chrome.storage?.sync) {
      try { chrome.storage.sync.set({ [CUSTOM_KEY]: v }); } catch (e) { /* ignore quota/unavailable */ }
    }
  };
  const faviconUrl = url => {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      return `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(url)}&size=64`;
    }
    try {
      const host = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    } catch (e) { return ""; }
  };
  const normalizeUrl = raw => {
    const s = raw.trim();
    if (!s) return "";
    return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(s) ? s : `https://${s}`;
  };
  const labelFor = (title, url) => {
    if (title && title.trim()) return title.trim();
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; }
  };

  /* formMode: null | { mode: "add" } | { mode: "edit", idx: number } */
  let formMode = null;
  let dragIdx = -1;

  function renderShortcuts() {
    if (!shortcutsEl) return;
    const items = readShortcuts();
    shortcutsEl.textContent = "";

    const grid = document.createElement("div");
    grid.className = "shortcut-grid";

    items.forEach((item, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "shortcut-wrap";
      wrap.draggable = true;

      wrap.addEventListener("dragstart", e => {
        dragIdx = idx;
        wrap.classList.add("dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", String(idx));
        }
      });
      wrap.addEventListener("dragend", () => {
        dragIdx = -1;
        wrap.classList.remove("dragging");
        grid.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
      });
      wrap.addEventListener("dragover", e => {
        if (dragIdx < 0 || dragIdx === idx) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        wrap.classList.add("drag-over");
      });
      wrap.addEventListener("dragleave", () => wrap.classList.remove("drag-over"));
      wrap.addEventListener("drop", e => {
        e.preventDefault();
        wrap.classList.remove("drag-over");
        if (dragIdx < 0 || dragIdx === idx) return;
        const next = readShortcuts();
        const [moved] = next.splice(dragIdx, 1);
        if (!moved) return;
        next.splice(idx, 0, moved);
        dragIdx = -1;
        writeShortcuts(next);
        renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
      });

      const a = document.createElement("a");
      a.className = "shortcut";
      a.href = item.url;
      const name = labelFor(item.title, item.url);
      a.title = `${name}\n${item.url}`;

      const icon = document.createElement("span");
      icon.className = "shortcut-icon";
      const img = document.createElement("img");
      img.alt = "";
      img.src = faviconUrl(item.url);
      img.addEventListener("error", () => {
        icon.textContent = name.charAt(0).toUpperCase() || "?";
      });
      icon.appendChild(img);

      const label = document.createElement("span");
      label.className = "shortcut-label";
      label.textContent = name;

      a.append(icon, label);

      const actions = document.createElement("div");
      actions.className = "shortcut-actions";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "shortcut-act";
      edit.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
      edit.title = `Edit ${name}`;
      edit.setAttribute("aria-label", `Edit ${name}`);
      edit.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        formMode = { mode: "edit", idx };
        renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
        shortcutsEl.querySelector(".shortcut-form input")?.focus();
      });

      const del = document.createElement("button");
      del.type = "button";
      del.className = "shortcut-act";
      del.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
      del.title = `Remove ${name}`;
      del.setAttribute("aria-label", `Remove ${name}`);
      del.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        const next = readShortcuts();
        next.splice(idx, 1);
        writeShortcuts(next);
        if (formMode?.mode === "edit" && formMode.idx === idx) formMode = null;
        renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
      });

      actions.append(edit, del);
      wrap.append(a, actions);
      grid.appendChild(wrap);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "shortcut shortcut-add";
    addBtn.setAttribute("aria-label", "Add shortcut");
    addBtn.innerHTML = `<span class="shortcut-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg></span><span class="shortcut-label">Add</span>`;
    addBtn.addEventListener("click", () => {
      formMode = formMode?.mode === "add" ? null : { mode: "add" };
      renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
      if (formMode) shortcutsEl.querySelector(".shortcut-form input")?.focus();
    });
    grid.appendChild(addBtn);
    shortcutsEl.appendChild(grid);

    if (formMode) {
      const editing = formMode.mode === "edit" ? items[formMode.idx] : null;
      const form = document.createElement("form");
      form.className = "shortcut-form";

      const nameIn = document.createElement("input");
      nameIn.type = "text";
      nameIn.placeholder = "Name (optional)";
      nameIn.value = editing ? editing.title || "" : "";
      nameIn.setAttribute("aria-label", "Shortcut name");

      const urlIn = document.createElement("input");
      urlIn.type = "text";
      urlIn.placeholder = "https://example.com";
      urlIn.value = editing ? editing.url || "" : "";
      urlIn.required = true;
      urlIn.setAttribute("aria-label", "Website URL");

      const saveBtn = document.createElement("button");
      saveBtn.type = "submit";
      saveBtn.textContent = editing ? "Update" : "Save";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", () => { formMode = null; renderShortcuts(); });

      form.addEventListener("submit", e => {
        e.preventDefault();
        const url = normalizeUrl(urlIn.value);
        if (!url) return;
        const entry = { title: labelFor(nameIn.value, url), url };
        const next = readShortcuts();
        if (formMode.mode === "edit" && next[formMode.idx]) next[formMode.idx] = entry;
        else next.push(entry);
        writeShortcuts(next);
        formMode = null;
        renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
      });

      form.append(nameIn, urlIn, saveBtn, cancelBtn);
      shortcutsEl.appendChild(form);
    }
  }

  renderShortcuts();
  if (typeof chrome !== "undefined" && chrome.storage?.sync) {
    chrome.storage.sync.get([CUSTOM_KEY], res => {
      const synced = res?.[CUSTOM_KEY];
      const local = readShortcuts();
      if (Array.isArray(synced) && synced.length && !local.length) {
        try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(synced)); } catch (e) {}
        renderShortcuts();
      } else if (local.length && (!Array.isArray(synced) || !synced.length)) {
        try { chrome.storage.sync.set({ [CUSTOM_KEY]: local }); } catch (e) {}
      }
    });
    chrome.storage.onChanged?.addListener((changes, area) => {
      if (area !== "sync" || !changes[CUSTOM_KEY]) return;
      const next = changes[CUSTOM_KEY].newValue;
      if (!Array.isArray(next)) return;
      try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)); } catch (e) {}
      renderShortcuts();
    });
  }

  let userPaused = false;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (!pond.paused) pond.pause(true);
    } else if (!userPaused) {
      pond.pause(false);
    }
  });
  addEventListener("keydown", e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea")) return;
    const n = "123".indexOf(e.key);
    if (n >= 0) setTheme(THEMES[n]);
    else if (e.key === "t" || e.key === "T") setTheme(THEMES[(THEMES.indexOf(root.dataset.theme) + 1) % 3]);
    else if (e.key === " ") { e.preventDefault(); userPaused = pond.pause(); const ps = document.getElementById("pause-state"); if (ps) ps.textContent = userPaused ? "paused" : ""; }
  });

  /* the controls fade out while you leave the mouse alone */
  let idle = 0;
  const wake = () => { ui.classList.remove("idle"); clearTimeout(idle); idle = setTimeout(() => ui.classList.add("idle"), 3500); };
  addEventListener("pointermove", wake);
  addEventListener("keydown", wake);
  wake();

  /* ── koi count ── */
  const koiCountEl = document.getElementById("koi-count");
  function updateKoiCount() {
    if (!koiCountEl) return;
    koiCountEl.textContent = `${pond.count} koi`;
  }
  updateKoiCount();

  let resizeTimer = 0;
  addEventListener("resize", () => {
    pond.size(innerWidth, innerHeight);
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { buildWords(); updateKoiCount(); }, 120);
  });

  pond.start();
  buildWords().then(() => { box.classList.add("go"); requestAnimationFrame(frame); });
  /* canvas text cannot trigger a webfont load; redraw once the mono face is in */
  document.fonts?.load(`600 12px "Geist Mono"`).then(() => pond.colors());
})();
