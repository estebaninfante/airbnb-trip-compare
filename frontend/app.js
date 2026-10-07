const API = "/api";
const PERSON_KEY = "atc_person";

const state = {
  trip: null,
  anchors: {},
  criteria: [],
  listings: [],
  results: null,
  votes: [],
  segment: null,
  view: (typeof window !== "undefined" && window.innerWidth < 640) ? "cards" : "table",
  sort: { key: "rank", dir: "asc" },
  detail: null,
  map: null,
  markers: [],
  poll: null,
  weights: {},
  fx: 4000,
};

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function api(path, options) {
  const res = await fetch(API + path, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

function post(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => toastEl.classList.remove("show"), 2600);
}

function person() {
  return (localStorage.getItem(PERSON_KEY) || "").trim();
}

function fmtMoney(value, digits) {
  if (value == null) return "—";
  return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: digits || 0, maximumFractionDigits: digits || 0 });
}

function cop(usd) {
  if (usd == null) return "—";
  return "$" + Math.round(Number(usd) * (state.fx || 4000)).toLocaleString("es-CO") + " COP";
}

function copc(usd) {
  if (usd == null) return "—";
  return "$" + Math.round(Number(usd) * (state.fx || 4000)).toLocaleString("es-CO");
}

function people() {
  const n = parseInt(localStorage.getItem("atc_people") || "11", 10);
  return n > 0 ? n : 11;
}

function perPersonNight(row) {
  const p = people();
  if (row.pricePerNight != null) return row.pricePerNight / p;
  if (row.pricePPN != null) return (row.pricePPN * 11) / p;
  return null;
}

function totalPrice(row) {
  if (row.priceTotal != null) return row.priceTotal;
  if (row.pricePerNight != null) return row.pricePerNight * (nightsOf(currentSeg()) || 0);
  return null;
}

function fmtDate(iso) {
  if (!iso) return "";
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function nightsOf(seg) {
  return Math.round((new Date(seg.check_out) - new Date(seg.check_in)) / 86400000);
}

function currentSeg() {
  return (state.trip && state.trip.segments.find((s) => s.id === state.segment)) || null;
}

function segResult() {
  if (!state.results) return null;
  return state.results.segments.find((s) => s.id === state.segment) || null;
}

function scoreClass(score) {
  if (score == null) return "faint";
  if (score >= 8) return "good";
  if (score >= 6) return "warn";
  return "bad";
}

function ratingChip(r) {
  if (r == null) return "";
  return `<span class="chip">★ ${Number(r).toFixed(2)}</span>`;
}

function safetyChip(score, note) {
  if (score == null) return "";
  const cls = scoreClass(score);
  const title = note ? ` title="${esc(note)}"` : "";
  return `<span class="chip ${cls}"${title}>Seguridad ${Number(score).toFixed(1)}</span>`;
}

async function loadAll() {
  const [trip, listings, results, votes] = await Promise.all([
    api("/trip"), api("/listings"), api("/results"), api("/votes"),
  ]);
  state.trip = trip.trip;
  if (trip.fx && trip.fx.usd_cop) state.fx = trip.fx.usd_cop;
  state.anchors = trip.anchors || {};
  state.criteria = trip.criteria || results.criteria || [];
  state.listings = listings.listings || [];
  state.results = results;
  state.votes = votes.votes || [];
  state.weights = results.weights || {};
  if (!state.segment) {
    const withItems = state.trip.segments.find((s) => (results.segments.find((r) => r.id === s.id) || {}).listings && (results.segments.find((r) => r.id === s.id) || {}).listings.length);
    state.segment = (withItems || state.trip.segments[0]).id;
  }
  const dm = location.hash.match(/^#d=([\w-]+)/);
  if (dm && state.listings.some((l) => l.id === dm[1])) state.detail = dm[1];
  render();
  schedulePoll();
}

function schedulePoll() {
  const busy = state.listings.some((l) => l.status === "enriching");
  if (state.poll) { clearTimeout(state.poll); state.poll = null; }
  if (busy) {
    state.poll = setTimeout(async () => {
      try { await refreshData(); } catch (e) { state.poll = setTimeout(refreshData, 8000); }
    }, 5000);
  }
}

async function refreshData() {
  const [listings, results, votes] = await Promise.all([api("/listings"), api("/results"), api("/votes")]);
  state.listings = listings.listings || [];
  state.results = results;
  state.votes = votes.votes || [];
  render();
  schedulePoll();
}

function topbarHTML() {
  return `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>
          </div>
          <div class="brand-text">
            <div class="brand-title">${esc(state.trip ? state.trip.name : "Comparador de alojamientos")}</div>
            <div class="brand-sub">30 dic – 10 ene · ${people()} personas · ${state.trip ? state.trip.group.couples : 5} parejas + 1</div>
          </div>
        </div>
        <div class="topbar-spacer"></div>
        <div class="topbar-actions">
          <div class="identity">
            <label for="who">Voto como</label>
            <input id="who" type="text" placeholder="tu nombre" value="${esc(person())}" />
          </div>
          <div class="identity">
            <label for="people">Personas</label>
            <input id="people" type="number" min="1" max="30" inputmode="numeric" value="${people()}" />
          </div>
          <button class="btn" id="refresh">Actualizar</button>
        </div>
      </div>
    </header>`;
}

function segmentsHTML() {
  return `<div class="segments">${state.trip.segments.map((s) => `
    <button class="seg-tab" role="tab" aria-selected="${s.id === state.segment}" data-seg="${s.id}">
      <span class="seg-name">${esc(s.label)}</span>
      <span class="seg-date">${fmtDate(s.check_in)} – ${fmtDate(s.check_out)} · ${nightsOf(s)} noches</span>
    </button>`).join("")}</div>`;
}

function addHTML() {
  const seg = currentSeg();
  return `
    <div class="panel">
      <div class="panel-head">
        <div class="panel-title">Añadir alojamiento</div>
        <div class="panel-hint">Pega el enlace de Airbnb y se procesa solo</div>
      </div>
      <div class="add-row">
        <input class="input" id="url" type="url" placeholder="https://www.airbnb.com/rooms/…" />
        <select class="select" id="seg-select">
          ${state.trip.segments.map((s) => `<option value="${s.id}" ${s.id === state.segment ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
        </select>
        <button class="btn btn-primary" id="add">Añadir</button>
      </div>
      <div class="inline-msg" id="add-msg"></div>
      <div class="panel-hint" style="margin-top:10px">Se extraen ubicación, capacidad, habitaciones, precio, reseñas, seguridad del barrio y tiempos a puntos clave (${seg ? esc(seg.city) : ""}).</div>
    </div>`;
}

function listingById(id) {
  return state.listings.find((l) => l.id === id);
}

function cardHTML(row) {
  const l = listingById(row.id) || {};
  const img = row.image || (l.images || [])[0];
    const price = row.priceAvailable === false
      ? `<span class="chip">Precio no disponible</span>`
    : (totalPrice(row) != null ? `<div class="card-price">${cop(totalPrice(row))} <small>total · ${cop(perPersonNight(row))} por persona</small></div>` : "");
  const rooms = [row.bedrooms ? `${row.bedrooms} hab` : null, row.beds ? `${row.beds} camas` : null, row.baths ? `${row.baths} baños` : null].filter(Boolean).join(" · ");
  return `
    <article class="card" data-detail="${row.id}">
      <div class="card-media">
        ${img ? `<img loading="lazy" src="${esc(img)}" alt="" />` : `<div class="skeleton" style="height:100%"></div>`}
        <div class="card-rank ${row.rank === 1 ? "win" : ""}">${row.rank === 1 ? "★ Ganadora actual" : "#" + row.rank}</div>
      </div>
      <div class="card-body">
        <div class="card-title">${esc(row.name || "Sin nombre")}</div>
        <div class="card-meta">${esc(row.district || "—")} · ${row.capacity ? row.capacity + " huéspedes" : ""}</div>
        ${rooms ? `<div class="card-meta">${esc(rooms)}</div>` : ""}
        <div class="card-stats">
          ${ratingChip(row.rating)}
          ${safetyChip(row.safety)}
          ${row.walkScore != null ? `<span class="chip">Entorno ${Number(row.walkScore).toFixed(1)}</span>` : ""}
          ${row.available === false ? `<span class="chip">No disponible en estas fechas</span>` : ""}
          ${statusBadge(l.status)}
        </div>
        ${price}
        <div class="card-actions">
          <button class="btn btn-sm" data-detail="${row.id}">Ver detalle</button>
          <a class="btn btn-sm btn-ghost" href="${esc(l.url || "#")}" target="_blank" rel="noopener">Airbnb ↗</a>
        </div>
      </div>
    </article>`;
}

function statusBadge(status) {
  if (!status) return "";
  const label = { ready: "Listo", enriching: "Procesando", partial: "Parcial", error: "Error" }[status] || status;
  const inner = status === "enriching" ? `<span class="spinner"></span> ${label}` : label;
  return `<span class="badge ${status}">${inner}</span>`;
}

function sortedRows(rows) {
  const { key, dir } = state.sort;
  const mul = dir === "asc" ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string") return av.localeCompare(bv) * mul;
    return (av - bv) * mul;
  });
}

function th(key, label, extra) {
  const active = state.sort.key === key;
  const mark = active ? `<span class="sort-mark">${state.sort.dir === "asc" ? "▲" : "▼"}</span>` : "";
  return `<th data-sort="${key}" class="${extra || ""}">${label} ${mark}</th>`;
}

function tableHTML(rows) {
  const sorted = sortedRows(rows);
  return `
    <div class="table-wrap">
      <table class="rank">
        <thead>
          <tr>
            ${th("rank", "#")}
            ${th("name", "Alojamiento")}
            ${th("capacity", "Cap.")}
            <th class="no-sort">Hab·Cam·Baños</th>
            ${th("pricePPN", "COP total")}
            ${th("rating", "Rating")}
            ${th("safety", "Seguridad")}
            ${th("walkScore", "Entorno")}
            ${th("final", "Score")}
            <th class="no-sort"></th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((row) => {
            const l = listingById(row.id) || {};
            const img = row.image || (l.images || [])[0];
            return `
            <tr class="${row.rank === 1 ? "win" : ""} ${row.available === false ? "off" : ""}">
              <td class="num">${row.rank}</td>
              <td>
                <div class="cell-listing">
                  ${img ? `<img loading="lazy" src="${esc(img)}" alt="" />` : `<div class="skeleton" style="width:46px;height:46px"></div>`}
                  <div>
                    <div class="nm">${esc(row.name || "Sin nombre")}</div>
                    <div class="faint" style="font-size:var(--fs-xs)">${statusBadge(l.status)}${row.available === false ? ` <span style="color:var(--muted)">no disponible</span>` : ""}</div>
                  </div>
                </div>
              </td>
              <td class="num">${row.capacity || "—"}</td>
              <td class="num">${row.bedrooms || "—"} · ${row.beds || "—"} · ${row.baths || "—"}</td>
              <td class="num" style="white-space:nowrap">${row.priceAvailable === false ? "<span class='chip'>n/d</span>" : `${copc(totalPrice(row))}<br><span class="faint" style="font-size:var(--fs-xs)">${copc(perPersonNight(row))} /persona</span>`}</td>
              <td class="num">${row.rating != null ? Number(row.rating).toFixed(2) : "—"}</td>
              <td class="num">${row.safety != null ? Number(row.safety).toFixed(1) : "—"}</td>
              <td class="num">${row.walkScore != null ? Number(row.walkScore).toFixed(1) : "—"}</td>
              <td class="score-cell">${row.final != null ? row.final.toFixed(2) : "—"}<div class="bar"><span style="width:${Math.max(0, Math.min(100, (row.final || 0) * 10))}%"></span></div></td>
              <td><button class="btn btn-sm" data-detail="${row.id}">Detalle</button></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:var(--fs-xs);margin:8px 2px 0">Score = 0,5·objetivo + 0,5·voto del grupo. Las opciones sin disponibilidad para estas fechas se muestran al final, atenuadas.</p>`;
}

function emptyHTML() {
  return `<div class="empty">
    <h3>Aún no hay alojamientos en esta etapa</h3>
    <p>Pega el enlace de un alojamiento de Airbnb arriba y se procesará automáticamente. Cualquiera del grupo puede añadir los que vaya encontrando.</p>
  </div>`;
}

function winnerHTML() {
  const seg = segResult();
  if (!seg || !seg.listings.length) {
    return `<div class="panel"><div class="panel-title">Ganadora</div><div class="panel-hint" style="margin-top:8px">Sin candidatos todavía.</div></div>`;
  }
  if (!seg.winner) {
    return `<div class="panel"><div class="panel-title">Ganadora</div><div class="panel-hint" style="margin-top:8px">Ninguna opción tiene disponibilidad para estas fechas. Añade más opciones o revisa las fechas.</div></div>`;
  }
  const w = seg.listings.find((r) => r.id === seg.winner) || seg.listings[0];
  const l = listingById(w.id) || {};
  const hasVotes = w.community != null && w.votes > 0;
  const scores = hasVotes
    ? `<div class="winner-scores">
        <div class="s"><b>${w.final != null ? w.final.toFixed(2) : "—"}</b><span>Score final</span></div>
        <div class="s"><b>${w.objective != null ? w.objective.toFixed(2) : "—"}</b><span>Objetivo</span></div>
        <div class="s"><b>${w.community != null ? w.community.toFixed(2) : "—"}</b><span>Comunidad</span></div>
        <div class="s"><b>${w.votes}</b><span>Votos</span></div>
      </div>`
    : `<div class="winner-scores">
        <div class="s"><b>${w.final != null ? w.final.toFixed(2) : "—"}</b><span>Score objetivo</span></div>
        <div class="s"><b>0</b><span>Votos · sin votar</span></div>
      </div>`;
  return `
    <div class="winner-card">
      <div class="winner-eyebrow">Ganadora actual · ${esc(seg.label)}</div>
      <div class="winner-name">${esc(w.name || "Sin nombre")}</div>
      <div class="winner-meta">${esc(w.district || "—")} · ${w.capacity ? w.capacity + " huéspedes" : ""} ${w.bedrooms ? "· " + w.bedrooms + " hab" : ""}</div>
      ${scores}
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn btn-sm" data-detail="${w.id}">Ver detalle</button>
        <a class="btn btn-sm btn-ghost" href="${esc(l.url || "#")}" target="_blank" rel="noopener">Abrir en Airbnb ↗</a>
      </div>
    </div>`;
}

function detailHTML() {
  const id = state.detail;
  if (!id) return "";
  const l = listingById(id) || {};
  const row = (segResult() && segResult().listings.find((r) => r.id === id)) || {};
  const images = (l.images || []).slice(0, 3);
  const routes = (row.routes || []).map((r) => `
    <div class="route-row">
      <span class="lbl">${esc(r.label)}${r.approx ? " (aprox.)" : ""}</span>
      <span class="val">${r.durationMin != null ? r.durationMin + " min" : "—"} · ${r.distanceKm != null ? r.distanceKm + " km" : ""}</span>
    </div>`).join("");
  const amenities = (l.amenities || []).slice(0, 18).map((a) => `<span class="chip">${esc(a)}</span>`).join("");
  const votes = state.votes.filter((v) => v.listingId === id);
  const me = person();
  const myVote = votes.find((v) => v.person === me);
  const canVote = !!me;
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="Detalle del alojamiento">
      <div class="modal-head">
        <div class="panel-title">Detalle</div>
        <button class="btn btn-sm btn-ghost" id="close-detail">Cerrar ✕</button>
      </div>
      ${images.length ? `<div style="display:grid;grid-template-columns:repeat(${images.length},1fr);gap:6px;border-radius:12px;overflow:hidden">${images.map((u) => `<img src="${esc(u)}" style="width:100%;height:88px;object-fit:cover" alt="" />`).join("")}</div>` : ""}
      <h3 style="margin-top:12px;font-size:var(--fs-lg)">${esc(l.name || row.name || "Sin nombre")}</h3>
      <div class="muted" style="font-size:var(--fs-sm);margin-top:4px">${esc((l.geo && l.geo.display) || row.district || "")}</div>
      <div class="card-stats" style="margin-top:10px">
        ${row.capacity ? `<span class="chip">${row.capacity} huéspedes</span>` : ""}
        ${row.bedrooms ? `<span class="chip">${row.bedrooms} hab</span>` : ""}
        ${row.beds ? `<span class="chip">${row.beds} camas</span>` : ""}
        ${row.baths ? `<span class="chip">${row.baths} baños</span>` : ""}
        ${ratingChip(row.rating)}
        ${safetyChip(row.safety, l.safety && l.safety.note)}
        ${l.isSuperhost ? `<span class="chip accent">Superhost</span>` : ""}
      </div>
      ${row.priceAvailable === false
        ? `<div class="inline-msg" style="color:var(--warn)">Precio no disponible para estas fechas (${esc((l.price && l.price.reason) || "")}).</div>`
        : `<div style="margin-top:10px;font-weight:700;font-size:var(--fs-xl)">${cop(totalPrice(row))} <small class="muted" style="font-weight:400;font-size:var(--fs-sm)">total</small></div>
           <div class="muted" style="font-size:var(--fs-sm)">${cop(perPersonNight(row))} por persona · ${cop(row.pricePerNight)} / noche</div>`}
      ${routes ? `<div class="detail"><h4>Tiempos a puntos clave</h4><div class="routes">${routes}</div></div>` : ""}
      ${amenities ? `<div class="detail"><h4>Servicios</h4><div class="amenities">${amenities}</div></div>` : ""}
      <div class="detail">
        <h4>Votación del grupo</h4>
        ${canVote ? `
          <div class="vote-box">
            <div class="field-label">Tu puntaje (1–10)</div>
            <div class="vote-scale" id="vote-scale">
              ${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<button data-score="${n}" aria-pressed="${myVote && myVote.score === n}">${n}</button>`).join("")}
            </div>
            <textarea class="textarea" id="vote-comment" placeholder="Comentario (opcional)">${myVote ? esc(myVote.comment || "") : ""}</textarea>
            <div style="margin-top:8px"><button class="btn btn-primary btn-sm" id="save-vote" data-id="${id}">Guardar voto</button></div>
          </div>` : `<div class="panel-hint">Escribe tu nombre arriba para votar.</div>`}
        <div class="votes-list">
          ${votes.length ? votes.map((v) => `<div class="vote-item"><b>${esc(v.person)}</b> <span class="score-cell">${v.score}</span> <span class="cmt">${esc(v.comment || "")}</span></div>`).join("") : `<div class="panel-hint">Sin votos todavía.</div>`}
        </div>
      </div>
      <div style="margin-top:12px"><a class="btn btn-sm btn-ghost" href="${esc(l.url || "#")}" target="_blank" rel="noopener">Abrir en Airbnb ↗</a></div>
      </div>
    </div>`;
}

function mapPanelHTML() {
  return `<div class="panel"><div class="panel-head"><div class="panel-title">Mapa</div><div class="panel-hint">Zona y puntos clave</div></div><div id="map"></div></div>`;
}

function weightsHTML() {
  if (!state.criteria.length) return "";
  return `
    <div class="panel">
      <div class="panel-head"><div class="panel-title">Pesos</div><div class="panel-hint">Importancia de cada criterio</div></div>
      <div class="weights">
        ${state.criteria.map((c) => `
          <div class="weight-row">
            <label for="w-${c.key}">${esc(c.key)}</label>
            <input type="range" id="w-${c.key}" data-weight="${c.key}" min="0" max="3" step="0.1" value="${state.weights[c.key] != null ? state.weights[c.key] : c.defaultWeight}" />
            <output data-out="${c.key}">${(state.weights[c.key] != null ? state.weights[c.key] : c.defaultWeight).toFixed(1)}</output>
          </div>`).join("")}
      </div>
      <div style="margin-top:12px"><button class="btn btn-primary btn-sm" id="save-weights">Guardar pesos</button></div>
    </div>`;
}

function layoutHTML() {
  const seg = segResult();
  const rows = seg ? seg.listings : [];
  const body = rows.length
    ? (state.view === "table" ? tableHTML(rows) : `<div class="cards">${rows.map(cardHTML).join("")}</div>`)
    : emptyHTML();
  return `
    <div class="container">
      ${segmentsHTML()}
      <div class="layout">
        <div class="col-main">
          ${addHTML()}
          <div class="panel">
            <div class="viewbar">
              <div class="segmented">
                <button data-view="table" aria-pressed="${state.view === "table"}">Tabla</button>
                <button data-view="cards" aria-pressed="${state.view === "cards"}">Tarjetas</button>
              </div>
              <div class="count-pill">${rows.length} opciones en esta etapa</div>
            </div>
            ${body}
          </div>
        </div>
        <aside class="col-side">
          ${winnerHTML()}
          ${mapPanelHTML()}
          ${weightsHTML()}
        </aside>
      </div>
    </div>`;
}

function render() {
  app.innerHTML = topbarHTML() + layoutHTML() + detailHTML();
  bind();
  renderMap();
}

function bind() {
  app.querySelectorAll("[data-seg]").forEach((b) => b.addEventListener("click", () => {
    state.segment = b.dataset.seg;
    state.detail = null;
    render();
  }));
  app.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
    state.view = b.dataset.view;
    render();
  }));
  app.querySelectorAll("[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
    else state.sort = { key, dir: key === "name" || key === "district" ? "asc" : "desc" };
    render();
  }));
  app.querySelectorAll("[data-detail]").forEach((el) => el.addEventListener("click", (ev) => {
    ev.preventDefault();
    state.detail = el.dataset.detail;
    render();
  }));
  const backdrop = app.querySelector("#modal-backdrop");
  if (backdrop) backdrop.addEventListener("click", (ev) => { if (ev.target === backdrop) { state.detail = null; render(); } });
  document.onkeydown = (ev) => { if (ev.key === "Escape" && state.detail) { state.detail = null; render(); } };
  const close = app.querySelector("#close-detail");
  if (close) close.addEventListener("click", () => { state.detail = null; render(); });

  const who = app.querySelector("#who");
  if (who) who.addEventListener("change", () => {
    localStorage.setItem(PERSON_KEY, who.value.trim());
    toast(who.value.trim() ? `Identidad: ${who.value.trim()}` : "Identidad borrada");
    render();
  });

  const peopleInput = app.querySelector("#people");
  if (peopleInput) peopleInput.addEventListener("change", () => {
    const n = Math.max(1, parseInt(peopleInput.value, 10) || 11);
    localStorage.setItem("atc_people", String(n));
    toast(`Precio por persona calculado para ${n} personas`);
    render();
  });

  const refresh = app.querySelector("#refresh");
  if (refresh) refresh.addEventListener("click", async () => { await refreshData(); toast("Datos actualizados"); });

  const add = app.querySelector("#add");
  if (add) add.addEventListener("click", addListing);
  const urlInput = app.querySelector("#url");
  if (urlInput) urlInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addListing(); });

  const saveVote = app.querySelector("#save-vote");
  if (saveVote) saveVote.addEventListener("click", () => sendVote(saveVote.dataset.id));

  app.querySelectorAll("#vote-scale button").forEach((b) => b.addEventListener("click", () => {
    app.querySelectorAll("#vote-scale button").forEach((x) => x.setAttribute("aria-pressed", "false"));
    b.setAttribute("aria-pressed", "true");
  }));

  app.querySelectorAll("[data-weight]").forEach((input) => input.addEventListener("input", () => {
    const out = app.querySelector(`[data-out="${input.dataset.weight}"]`);
    if (out) out.textContent = Number(input.value).toFixed(1);
  }));
  const saveWeights = app.querySelector("#save-weights");
  if (saveWeights) saveWeights.addEventListener("click", saveWeightsFn);
}

async function addListing() {
  const input = app.querySelector("#url");
  const msg = app.querySelector("#add-msg");
  const seg = app.querySelector("#seg-select");
  const url = (input.value || "").trim();
  if (!url || url.indexOf("airbnb.") === -1) {
    msg.className = "inline-msg error";
    msg.textContent = "Pega un enlace válido de Airbnb.";
    return;
  }
  const btn = app.querySelector("#add");
  btn.disabled = true;
  msg.className = "inline-msg";
  msg.textContent = "Añadiendo y procesando…";
  try {
    await post("/listings", { url, segment: seg.value, person: person() || "anon" });
    input.value = "";
    msg.className = "inline-msg ok";
    msg.textContent = "Añadido. Procesando en segundo plano.";
    await refreshData();
    toast("Alojamiento añadido");
  } catch (e) {
    msg.className = "inline-msg error";
    msg.textContent = "Error: " + e.message;
  } finally {
    btn.disabled = false;
  }
}

async function sendVote(id) {
  const me = person();
  if (!me) { toast("Escribe tu nombre para votar"); return; }
  const pressed = app.querySelector("#vote-scale button[aria-pressed='true']");
  if (!pressed) { toast("Elige un puntaje 1–10"); return; }
  const comment = (app.querySelector("#vote-comment").value || "").trim();
  try {
    await post("/votes", { listingId: id, person: me, score: Number(pressed.dataset.score), comment });
    toast("Voto guardado");
    await refreshData();
  } catch (e) {
    toast("Error al votar: " + e.message);
  }
}

async function saveWeightsFn() {
  const weights = {};
  app.querySelectorAll("[data-weight]").forEach((input) => { weights[input.dataset.weight] = Number(input.value); });
  try {
    await post("/weights", weights);
    toast("Pesos actualizados");
    await refreshData();
  } catch (e) {
    toast("Error: " + e.message);
  }
}

function renderMap() {
  const el = document.getElementById("map");
  if (!el) return;
  if (!state.map) {
    state.map = L.map(el, { scrollWheelZoom: false }).setView([-12.1, -77.03], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap", maxZoom: 19,
    }).addTo(state.map);
  }
  state.markers.forEach((m) => state.map.removeLayer(m));
  state.markers = [];
  const seg = currentSeg();
  const anchors = seg ? (state.anchors[seg.anchor_set] || []) : [];
  anchors.forEach((a) => {
    const m = L.circleMarker([a.lat, a.lng], { radius: 6, color: "#0a7ea4", fillColor: "#0a7ea4", fillOpacity: 0.85, weight: 2 }).addTo(state.map);
    m.bindTooltip(esc(a.label));
    state.markers.push(m);
  });
  const rows = segResult() ? segResult().listings : [];
  rows.forEach((row) => {
    const l = listingById(row.id);
    if (!l || l.lat == null || l.lng == null) return;
    const win = row.rank === 1;
    const marker = L.circleMarker([l.lat, l.lng], {
      radius: win ? 11 : 8,
      color: win ? "#e31c5f" : "#ff385c",
      fillColor: win ? "#ff385c" : "#ffb3c0",
      fillOpacity: 0.95,
      weight: 2,
    }).addTo(state.map);
    marker.bindPopup(`<b>#${row.rank} · ${esc(row.name || "")}</b><br>${esc(row.district || "")}${row.pricePPN != null ? "<br>" + cop(row.pricePPN) + "/pers·noche" : ""}`);
    state.markers.push(marker);
  });
  if (rows.length) {
    const pts = rows.map((r) => listingById(r.id)).filter((l) => l && l.lat != null).map((l) => [l.lat, l.lng]);
    if (pts.length) state.map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
  }
}

loadAll().catch((e) => {
  app.innerHTML = `<div class="container"><div class="empty"><h3>No se pudo cargar</h3><p>${esc(e.message)}</p></div></div>`;
});
