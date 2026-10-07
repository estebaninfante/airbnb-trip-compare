const state = {
  trip: null,
  anchors: {},
  criteria: [],
  listings: [],
  results: null,
  votes: [],
  people: [],
  segment: null,
  map: null,
  layers: null,
  pollTimer: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

const person = {
  get: () => localStorage.getItem("atc_person") || "",
  set: (v) => localStorage.setItem("atc_person", v.trim()),
};

function toast(msg) {
  let el = $(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

function money(v) {
  return v == null ? "—" : `US$ ${Number(v).toLocaleString("es-PE")}`;
}

function currentSegment() {
  return (state.trip?.segments || []).find((s) => s.id === state.segment);
}

function anchorSetFor(seg) {
  return state.anchors[seg?.anchor_set] || [];
}

function segListings() {
  return state.listings.filter((l) => l.segment === state.segment);
}

function resultFor(id) {
  const seg = (state.results?.segments || []).find((s) => s.id === state.segment);
  return seg?.listings.find((l) => l.id === id) || null;
}

function votesFor(id) {
  return state.votes.filter((v) => v.listingId === id);
}

async function loadAll() {
  const [trip, list, results, votes] = await Promise.all([
    api("/api/trip"),
    api("/api/listings"),
    api("/api/results"),
    api("/api/votes"),
  ]);
  state.trip = trip.trip;
  state.anchors = trip.anchors;
  state.criteria = trip.criteria;
  state.listings = list.listings;
  state.results = results;
  state.votes = votes.votes;
  state.people = votes.people;
  if (!state.segment) state.segment = state.trip.segments[0]?.id || null;
}

function render() {
  const seg = currentSegment();
  const anchorNames = anchorSetFor(seg).map((a) => a.name);
  $("#app").innerHTML = `
    ${headerHTML()}
    <div class="wrap">
      ${tabsHTML()}
      <div class="layout">
        <div>
          ${addHTML()}
          ${cardsHTML()}
        </div>
        <div>
          ${mapPanelHTML(seg)}
          ${resultsHTML()}
          ${weightsHTML()}
        </div>
      </div>
    </div>`;
  bind();
  renderMap(seg);
}

function headerHTML() {
  const t = state.trip;
  const dates = t ? `${t.segments[0].check_in} → ${t.segments[t.segments.length - 1].check_out}` : "";
  return `
    <header class="top">
      <div>
        <h1>${esc(t?.name || "Comparador de Airbnbs")}</h1>
        <div class="sub">${esc(dates)} · ${t?.group?.total || 11} personas · ${t?.group?.couples || 5} parejas</div>
      </div>
      <div class="grow"></div>
      <div class="identity">
        <span class="sub">Sos:</span>
        <input id="me" placeholder="Tu nombre" value="${esc(person.get())}" />
      </div>
    </header>`;
}

function tabsHTML() {
  return `<div class="tabs">${(state.trip?.segments || []).map((s) => `
    <button class="tab ${s.id === state.segment ? "active" : ""}" data-seg="${s.id}">
      ${esc(s.label)}<small>${esc(s.check_in)} → ${esc(s.check_out)}</small>
    </button>`).join("")}</div>`;
}

function addHTML() {
  return `
    <div class="panel">
      <h2>Agregar opción</h2>
      <p class="hint">Pega el enlace del Airbnb. Extraemos ubicación, precio, capacidad, reseñas, seguridad del barrio y tiempos a los puntos clave automáticamente.</p>
      <div class="addrow">
        <input class="url" id="new-url" placeholder="https://www.airbnb.com/rooms/..." />
        <button class="primary" id="add-btn">Agregar</button>
      </div>
    </div>`;
}

function cardHTML(l) {
  const r = resultFor(l.id);
  const busy = l.status === "enriching";
  const img = (l.images || [])[0];
  const routes = l.routes || [];
  const safety = l.safety || {};
  const cap = l.personCapacity;
  const okCap = cap >= 11;
  return `
    <div class="card ${r?.rank === 1 ? "winner" : ""}">
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy" />` : `<div class="thumb"></div>`}
      <div class="body">
        <div>
          <div class="title">${esc(l.name || "Sin título")}</div>
          <div class="status ${l.status === "error" ? "error" : ""}">
            ${busy ? `<span class="spinner"></span> Analizando…` : l.status === "error" ? esc(l.error || "Error") : `Agregado por ${esc(l.addedBy || "anónimo")}`}
          </div>
        </div>
        <div class="meta">
          ${l.district ? `<span class="badge accent">${esc(l.district)}</span>` : ""}
          ${cap ? `<span class="badge ${okCap ? "good" : "warn"}">${cap} huéspedes</span>` : ""}
          ${l.isSuperhost ? `<span class="badge good">Superhost</span>` : ""}
          ${safety.score ? `<span class="badge ${safety.score >= 8 ? "good" : safety.score >= 6 ? "warn" : "bad"}">Seguridad ${safety.score}</span>` : ""}
          ${r?.pricePPN != null ? `<span class="badge">US$ ${r.pricePPN}/pers/noche</span>` : ""}
        </div>
        ${safety.note ? `<div class="stat"><span>Barrio</span><b>${esc(safety.note)}</b></div>` : ""}
        ${(l.rating?.overall) ? `<div class="stat"><span>Calificación</span><b>${l.rating.overall}★ · ${l.rating.reviews || 0} reseñas</b></div>` : ""}
        ${l.pois ? `<div class="stat"><span>Entorno (a pie, 1 km)</span><b>${l.pois.total} lugares · score ${l.pois.walkScore}</b></div>` : ""}
        ${routes.length ? `<ul class="routes">${routes.map((x) => `
          <li><span>${esc(x.label)}</span><span>${x.durationMin} min · ${x.distanceKm} km</span></li>`).join("")}</ul>` : ""}
        ${r ? `<div class="stat"><span>Puntaje objetivo${r.community != null ? " · comunidad" : ""}</span><b>${r.objective}${r.community != null ? ` · ${r.community}` : ""} → final ${r.final}</b></div>` : ""}
        <div class="actions">
          ${l.url ? `<a class="badge" href="${esc(l.url)}" target="_blank" rel="noopener">Ver en Airbnb</a>` : ""}
          <button class="ghost" data-refresh="${l.id}">Actualizar</button>
          <button class="ghost" data-del="${l.id}">Quitar</button>
        </div>
        ${voteHTML(l)}
      </div>
    </div>`;
}

function voteHTML(l) {
  const vs = votesFor(l.id);
  const me = person.get();
  const mine = vs.find((v) => v.person === me);
  return `
    <div class="vote-box">
      <div class="vrow">
        <span class="sub" style="min-width:52px">Voto</span>
        <input type="range" min="1" max="10" value="${mine?.score || 7}" data-vote-range="${l.id}" />
        <b data-vote-val="${l.id}" style="min-width:24px">${mine?.score || 7}</b>
        <button class="primary" data-vote="${l.id}">${mine ? "Cambiar" : "Votar"}</button>
      </div>
      <input data-vote-comment="${l.id}" placeholder="Comentario (opcional)" value="${esc(mine?.comment || "")}" />
      ${vs.length ? `<div class="votes-list">${vs.map((v) => `<div class="v"><b>${esc(v.person)}</b>: ${v.score}/10${v.comment ? ` — ${esc(v.comment)}` : ""}</div>`).join("")}</div>` : ""}
    </div>`;
}

function cardsHTML() {
  const ls = segListings();
  if (!ls.length) return `<div class="empty">Todavía no hay opciones en esta etapa. Pega el primer enlace de Airbnb arriba.</div>`;
  return `<div class="cards">${ls.map(cardHTML).join("")}</div>`;
}

function mapPanelHTML(seg) {
  return `
    <div class="panel">
      <h2>Mapa · ${esc(seg?.label || "")}</h2>
      <p class="hint">Ubicación de cada opción y los puntos clave que priorizamos.</p>
      <div id="map"></div>
    </div>`;
}

function renderMap(seg) {
  if (!window.L || !seg) return;
  const el = $("#map");
  if (!el) return;
  if (state.map) { state.map.remove(); state.map = null; }
  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap · © CARTO", maxZoom: 19,
  }).addTo(map);
  const pts = [];
  anchorSetFor(seg).forEach((a) => {
    L.circleMarker([a.lat, a.lng], { radius: 6, color: "#8b95a7", weight: 2, fillColor: "#8b95a7", fillOpacity: 0.6 })
      .addTo(map).bindPopup(`<b>${esc(a.name)}</b><br/>punto clave`);
    pts.push([a.lat, a.lng]);
  });
  const ranked = (state.results?.segments || []).find((s) => s.id === seg.id)?.listings || [];
  segListings().forEach((l) => {
    if (l.lat == null || l.lng == null) return;
    const r = ranked.find((x) => x.id === l.id);
    const isWin = r?.rank === 1;
    L.marker([l.lat, l.lng], {
      icon: L.divIcon({
        className: "",
        html: `<div style="background:${isWin ? "#e8853a" : "#4a5263"};color:${isWin ? "#1a1207" : "#fff"};width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:2px solid #10131a">${r?.rank || "?"}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 13],
      }),
    }).addTo(map).bindPopup(`<b>${esc(l.name)}</b><br/>${esc(l.district || "")}`);
    pts.push([l.lat, l.lng]);
  });
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 13 });
  else map.setView([-12.09, -77.04], 11);
  state.map = map;
}

function resultsHTML() {
  const seg = (state.results?.segments || []).find((s) => s.id === state.segment);
  const rows = seg?.listings || [];
  const winner = rows.find((r) => r.rank === 1);
  return `
    <div class="panel">
      <h2>Ranking de esta etapa</h2>
      <p class="hint">Puntaje objetivo (ubicación, precio, capacidad, calidad, seguridad, entorno) combinado 50/50 con los votos del grupo.</p>
      ${winner ? `<div class="winner-banner">
        ${winner.image ? `<img src="${esc(winner.image)}" alt="" />` : ""}
        <div><div class="t">Ganador parcial: ${esc(winner.name)}</div><div class="sub">Final ${winner.final} · objetivo ${winner.objective}${winner.community != null ? ` · comunidad ${winner.community}` : ""}</div></div>
      </div>` : ""}
      ${rows.length ? `<table class="rank"><thead><tr><th>#</th><th>Opción</th><th class="num">Objetivo</th><th class="num">Comunidad</th><th class="num">Final</th></tr></thead><tbody>
        ${rows.map((r) => `<tr>
          <td>${r.rank}</td>
          <td>${esc(r.name)}</td>
          <td class="num">${r.objective}</td>
          <td class="num">${r.community ?? "—"}</td>
          <td class="num"><b>${r.final}</b> <div class="bar"><i style="width:${Math.min(100, r.final * 10)}%"></i></div></td>
        </tr>`).join("")}
      </tbody></table>` : `<div class="empty">Agrega opciones para ver el ranking.</div>`}
    </div>`;
}

function weightsHTML() {
  const w = state.results?.weights || {};
  return `
    <div class="panel">
      <h2>Pesos de los criterios</h2>
      <p class="hint">Ajusta qué importa más para el grupo. El ranking se recalcula al instante.</p>
      <div class="weights">
        ${state.criteria.map((c) => `
          <div class="w">
            <label>${esc(c.label)} <span data-w-val="${c.key}">${w[c.key] ?? c.defaultWeight}</span></label>
            <input type="range" min="0" max="3" step="0.1" value="${w[c.key] ?? c.defaultWeight}" data-w="${c.key}" />
          </div>`).join("")}
      </div>
    </div>`;
}

function bind() {
  $("#me")?.addEventListener("change", (e) => {
    person.set(e.target.value);
    toast("Listo, " + (person.get() || "anónimo"));
    render();
  });
  document.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
    state.segment = b.dataset.seg;
    render();
  }));
  $("#add-btn")?.addEventListener("click", addListing);
  $("#new-url")?.addEventListener("keydown", (e) => { if (e.key === "Enter") addListing(); });
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => removeListing(b.dataset.del)));
  document.querySelectorAll("[data-refresh]").forEach((b) => b.addEventListener("click", () => refreshListing(b.dataset.refresh)));
  document.querySelectorAll("[data-vote-range]").forEach((r) => r.addEventListener("input", () => {
    const el = document.querySelector(`[data-vote-val="${r.dataset.voteRange}"]`);
    if (el) el.textContent = r.value;
  }));
  document.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", () => sendVote(b.dataset.vote)));
  document.querySelectorAll("[data-w]").forEach((r) => r.addEventListener("input", () => {
    const el = document.querySelector(`[data-w-val="${r.dataset.w}"]`);
    if (el) el.textContent = r.value;
  }));
  document.querySelectorAll("[data-w]").forEach((r) => r.addEventListener("change", saveWeights));
}

async function addListing() {
  const url = $("#new-url").value.trim();
  if (!url) return;
  if (!person.get()) toast("Escribe tu nombre arriba para saber quién agrega");
  const btn = $("#add-btn");
  btn.disabled = true;
  try {
    await api("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, segment: state.segment, addedBy: person.get() || "anónimo" }),
    });
    $("#new-url").value = "";
    toast("Agregado. Analizando en segundo plano…");
    await refreshData();
    startPolling();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function removeListing(id) {
  if (!confirm("¿Quitar esta opción?")) return;
  await api(`/api/listings/${id}`, { method: "DELETE" });
  toast("Opción quitada");
  await refreshData();
}

async function refreshListing(id) {
  await api(`/api/listings/${id}/refresh`, { method: "POST" });
  toast("Actualizando…");
  await refreshData();
  startPolling();
}

async function sendVote(id) {
  if (!person.get()) { toast("Escribe tu nombre arriba primero"); return; }
  const range = document.querySelector(`[data-vote-range="${id}"]`);
  const comment = document.querySelector(`[data-vote-comment="${id}"]`)?.value || "";
  try {
    await api("/api/votes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: id, person: person.get(), score: Number(range.value), comment }),
    });
    toast("Voto registrado");
    await refreshData();
  } catch (e) {
    toast(e.message);
  }
}

async function saveWeights() {
  const weights = {};
  document.querySelectorAll("[data-w]").forEach((r) => { weights[r.dataset.w] = Number(r.value); });
  try {
    await api("/api/weights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weights),
    });
    await refreshData();
  } catch (e) {
    toast(e.message);
  }
}

async function refreshData() {
  const [list, results, votes] = await Promise.all([api("/api/listings"), api("/api/results"), api("/api/votes")]);
  state.listings = list.listings;
  state.results = results;
  state.votes = votes.votes;
  state.people = votes.people;
  render();
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    const busy = state.listings.some((l) => l.status === "enriching");
    if (!busy) { clearInterval(state.pollTimer); return; }
    await refreshData();
  }, 4000);
}

(async function init() {
  try {
    await loadAll();
    render();
    if (state.listings.some((l) => l.status === "enriching")) startPolling();
  } catch (e) {
    $("#app").innerHTML = `<div class="wrap"><div class="empty">No se pudo cargar el servidor: ${esc(e.message)}</div></div>`;
  }
})();
