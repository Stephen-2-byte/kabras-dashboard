const $ = s => document.querySelector(s);
const fmt = n => Math.round(n).toLocaleString("en-US");
const YEARS = Array.from({length: 12}, (_, i) => 2010 + i);
const AGE = ["10-12 months", "12-15 months", "15+ months"], HEALTH = ["Low", "Moderate", "High"];
const AGE_COL = ["#9ecae1", "#4292c6", "#08519c"], HEALTH_COL = ["#d73027", "#f1b82d", "#1a9850"];
const TYPE_COL = {Starting: "#2c7fb8", Continuing: "#41ab5d"};
const UNIT = {fields: "Fields", ha: "Hectares"};
const TYPES = {farmlands: "All farmlands", starting: "Starting fields", continuing: "Continuing fields",
  active: "Active fields", harvested: "Harvested fields", mature: "Mature fields (health class)",
  predicted: "Predicted yield (t/ha)", actual: "Actual yield (t/ha)", error: "Prediction error (t/ha)"};
const FLAT = {farmlands: "#9e9e9e", starting: "#2c7fb8", continuing: "#41ab5d", active: "#1b6b3a", harvested: "#e08214"};
const YPROP = {predicted: "p", actual: "a", error: "e"};
let S, AVAIL = new Set(), year = 2021, units = "fields";

const val = (y, t, c = units) => (S.fc.find(r => r.year === y && r.type === t) || {})[c] || 0;
const pick = (rows, y, cls, c = units) => (rows.find(r => r.year === y && r.cls === cls) || {})[c] || 0;
const base = {margin: {l: 50, r: 10, t: 50, b: 40}, height: 340, legend: {orientation: "h"}};
const cfg = {displaylogo: false, responsive: true};

function donut(id, labels, values, colors, title) {
  if (!values.some(v => v > 0)) { Plotly.newPlot(id, [], {...base, title: title + " - no data"}, cfg); return; }
  Plotly.newPlot(id, [{type: "pie", labels, values, hole: .55, sort: false, marker: {colors},
    textinfo: "percent", hovertemplate: "%{label}: %{value:,.0f}<extra></extra>"}], {...base, title}, cfg);
}
function bars(id, rows, groups, colors, title) {
  const tr = groups.map((g, i) => ({type: "bar", name: g, x: rows.filter(r => r.cls === g).map(r => r.year),
    y: rows.filter(r => r.cls === g).map(r => r[units]), marker: {color: colors[i]},
    hovertemplate: "Year %{x}<br>" + g + ": %{y:,.0f}<extra></extra>"}));
  Plotly.newPlot(id, tr, {...base, barmode: "stack", title, xaxis: {dtick: 1, title: "Year"},
    yaxis: {tickformat: ",.0f", title: UNIT[units]},
    shapes: [{type: "rect", xref: "x", yref: "paper", x0: year - .5, x1: year + .5, y0: 0, y1: 1,
      fillcolor: "grey", opacity: .15, line: {width: 0}}]}, cfg);
}
const asCls = t => S.fc.filter(r => r.type === t).map(r => ({...r, cls: t[0].toUpperCase() + t.slice(1)}));

function render() {
  const harv = S.age.filter(r => r.year === year).reduce((a, r) => a + r.fields, 0);
  const mat = pick(S.age, year, "15+ months", "fields");
  $("#kpis").innerHTML = [["Active fields", val(year, "active", "fields")], ["Starting fields", val(year, "starting", "fields")],
    ["Continuing fields", val(year, "continuing", "fields")], ["Active area (ha)", val(year, "active", "ha")],
    ["Harvested fields", harv], ["Mature fields", mat]]
    .map(([l, v]) => `<div class="card kpi"><b>${fmt(v)}</b><span>${l}</span></div>`).join("");
  const lab = UNIT[units];
  donut("ov_donut", ["Starting", "Continuing"], [val(year, "starting"), val(year, "continuing")],
    Object.values(TYPE_COL), `Starting vs continuing, ${year} (${lab})`);
  bars("ov_bar", [...asCls("starting"), ...asCls("continuing")], ["Starting", "Continuing"],
    Object.values(TYPE_COL), `Active sugarcane per year (${lab})`);
  const act = S.fc.filter(r => r.type === "active");
  Plotly.newPlot("ov_line", [{type: "scatter", mode: "lines+markers", x: act.map(r => r.year), y: act.map(r => r[units]),
    line: {color: "#6c5ce7"}, hovertemplate: "Year %{x}<br>Active: %{y:,.0f}<extra></extra>"}],
    {...base, height: 300, title: `Total active sugarcane (${lab})`, xaxis: {dtick: 1, title: "Year"},
     yaxis: {tickformat: ",.0f", title: lab}}, cfg);
  donut("ag_donut", AGE, AGE.map(k => pick(S.age, year, k)), AGE_COL, `Age at harvest, ${year} (${lab})`);
  bars("ag_bar", S.age, AGE, AGE_COL, `Age at harvest per year (${lab})`);
  donut("hl_donut", HEALTH, HEALTH.map(k => pick(S.health, year, k)), HEALTH_COL, `Health class, ${year} (${lab})`);
  bars("hl_bar", S.health, HEALTH, HEALTH_COL, `Health class per year (${lab})`);
}

// ------------------------------------------------------------ map
const TILES = {Light: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", "Esri, HERE, Garmin"],
  Streets: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", "© OpenStreetMap"],
  Satellite: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", "Esri World Imagery"]};
let map, tile, group, cache = {}, fitted = false;
const ramp = (v, lo, hi, div) => {
  let t = Math.max(0, Math.min(1, (v - lo) / ((hi - lo) || 1)));
  if (div) { t = Math.max(-1, Math.min(1, v / (Math.max(Math.abs(lo), Math.abs(hi)) || 1)));
    return t < 0 ? `rgb(${255 + 70 * t | 0},${255 + 130 * t | 0},255)` : `rgb(255,${255 - 150 * t | 0},${255 - 200 * t | 0})`; }
  return `rgb(${255 - 230 * t | 0},${255 - 90 * t | 0},${200 - 150 * t | 0})`;
};
async function getLayer(key) {
  if (!cache[key]) cache[key] = fetch(`data/layers/${key}.geojson`).then(r => r.json());
  return cache[key];
}
function setBasemap() {
  const [u, a] = TILES[$("#basemap").value];
  if (tile) map.removeLayer(tile);
  tile = L.tileLayer(u, {attribution: a, maxZoom: 19}).addTo(map).bringToBack();
}
async function drawMap() {
  group.clearLayers();
  const types = [...document.querySelectorAll("#m_types input:checked")].map(i => i.value);
  const years = [...document.querySelectorAll("#m_years input:checked")].map(i => +i.value);
  const op = +$("#opacity").value; let chips = [];
  for (const k of Object.keys(TYPES).filter(k => types.includes(k))) {
    const keys = k === "farmlands" ? ["farmlands"] : years.map(y => `${YPROP[k] ? "yield" : k}_${y}`);
    for (const key of keys.filter(x => AVAIL.has(x))) {
      const gj = await getLayer(key);
      let lo = 0, hi = 1;
      if (YPROP[k]) { const v = gj.features.map(f => f.properties[YPROP[k]]).filter(x => x != null).sort((a, b) => a - b);
        if (!v.length) continue; lo = v[Math.floor(v.length * .02)]; hi = v[Math.floor(v.length * .98)]; }
      const style = f => {
        const p = f.properties; let c = FLAT[k];
        if (k === "mature") c = HEALTH_COL[HEALTH.indexOf(p.h)] || "#999";
        if (YPROP[k]) c = ramp(p[YPROP[k]], lo, hi, k === "error");
        return {color: "#333", weight: .3, fillColor: c, fillOpacity: op};
      };
      L.geoJSON(gj, {style, onEachFeature: (f, l) => {
        l.bindTooltip(f.properties.t, {sticky: true});
        l.on("click", () => $("#detail").innerHTML = "<table>" + f.properties.t.split("<br>")
          .map(r => r.split(" = ")).map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("") + "</table>");
      }}).addTo(group);
      if (!fitted && key === "farmlands") { map.fitBounds(L.geoJSON(gj).getBounds()); fitted = true; }
    }
    if (FLAT[k]) chips.push(`<span class="chip" style="background:${FLAT[k]}"></span>${TYPES[k]}`);
    if (k === "mature") chips.push(...HEALTH.map((h, i) => `<span class="chip" style="background:${HEALTH_COL[i]}"></span>Health: ${h}`));
  }
  $("#legend").innerHTML = chips.join("");
}

async function init() {
  S = await (await fetch("data/summary.json")).json();
  AVAIL = new Set(await (await fetch("data/manifest.json")).json());
  $("#year").innerHTML = YEARS.map(y => `<option ${y === year ? "selected" : ""}>${y}</option>`).join("");
  $("#year").onchange = e => { year = +e.target.value; render(); };
  document.querySelectorAll("[name=units]").forEach(r => r.onchange = e => { units = e.target.value; render(); });
  document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
    document.querySelectorAll("nav button,.tab").forEach(x => x.classList.remove("on"));
    b.classList.add("on"); $("#" + b.dataset.tab).classList.add("on");
    if (b.dataset.tab === "map") map.invalidateSize(); else window.dispatchEvent(new Event("resize"));
  });
  $("#m_types").innerHTML = Object.entries(TYPES).map(([k, v]) =>
    `<label><input type="checkbox" value="${k}" ${["farmlands", "mature"].includes(k) ? "checked" : ""}> ${v}</label>`).join("");
  $("#m_years").innerHTML = YEARS.map(y => `<label><input type="checkbox" value="${y}" ${y === 2021 ? "checked" : ""}> ${y}</label>`).join("");
  document.querySelectorAll("#m_types input,#m_years input,#opacity").forEach(i => i.onchange = drawMap);
  map = L.map("lmap", {preferCanvas: true}).setView([0.4, 34.6], 10);
  group = L.layerGroup().addTo(map); setBasemap();
  $("#basemap").onchange = setBasemap;
  render(); drawMap();
}
init();
