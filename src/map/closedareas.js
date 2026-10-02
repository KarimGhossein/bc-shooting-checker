// v112: Wildlife Act Closed Areas Regulation (B.C. Reg. 76/84) zones.
//
// The data (src/data/closed-areas-r2.js, Region 2 so far) is loaded lazily the
// first time a lookup or spots search needs it, so it costs nothing on first
// paint. Each zone is a polygon built from the regulation's legal description
// (see that file's header); `unmapped` lists the zones not drawn yet, each
// with a rough reference point and radius used only to warn that one may be
// nearby.
//
// Classic script (see src/config/constants.js for why). Uses helpers defined
// in index.html's main script (pointInGeometry, bboxContainsPoint,
// expandBboxByMeters, metersPerDegree, esc), which exist by the time any of
// these functions is called.

const CLOSED_AREAS_SRC = 'src/data/closed-areas-r2.js';
const CLOSED_AREA_NEARBY_M = 3000; // zones drawn around a report point
const CLOSED_AREA_KIND_LABEL = {
  no_shooting: 'No shooting area',
  no_shooting_hunting: 'No shooting or hunting area',
  shot_only: 'Shotguns only (shot ammunition)',
  rifle_prohibited: 'No rifles',
  nontoxic_shot: 'Non-toxic shot only'
};
// Kinds that rule out shooting entirely (when in season). The others only
// limit what you may shoot with.
const CLOSED_AREA_BANS = ['no_shooting', 'no_shooting_hunting'];
// Schedule 5.1 areas (specified Crown land, mostly road corridors) stop
// target and other non-hunting shooting; the Synopsis notes lawful hunting
// and trapping may still discharge firearms there.
const CLOSED_AREA_HUNTING_NOTE = 'Lawful hunting and trapping are still allowed; target and other recreational shooting is not.';
function closedAreaHuntingNote(p){ return p && p.huntingOk ? ' ' + CLOSED_AREA_HUNTING_NOTE : ''; }

let closedAreasPromise = null;
function loadClosedAreas(){
  if(typeof CLOSED_AREAS_R2 !== 'undefined') return Promise.resolve(CLOSED_AREAS_R2);
  if(closedAreasPromise) return closedAreasPromise;
  closedAreasPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = CLOSED_AREAS_SRC;
    s.onload = () => resolve(typeof CLOSED_AREAS_R2 !== 'undefined' ? CLOSED_AREAS_R2 : null);
    s.onerror = () => { closedAreasPromise = null; resolve(null); };
    document.head.appendChild(s);
  });
  return closedAreasPromise;
}

// season: {from:'MM-DD', to:'MM-DD'}; no season means always in effect.
function closedAreaInSeason(props, date){
  if(!props || !props.season) return true;
  const d = date || new Date();
  const md = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const {from, to} = props.season;
  return from <= to ? (md >= from && md <= to) : (md >= from || md <= to);
}
function closedAreaBans(props, date){ return CLOSED_AREA_BANS.includes(props.kind) && closedAreaInSeason(props, date); }

function closedAreaDistKm(a, b){
  const m = metersPerDegree((a[1] + b[1]) / 2);
  return Math.hypot((a[0] - b[0]) * m.lng, (a[1] - b[1]) * m.lat) / 1000;
}

// Everything the report needs for one point: zones containing it, drawn
// zones within CLOSED_AREA_NEARBY_M (for the map), and unmapped zones whose
// reference radius covers it.
async function closedAreasForPoint(lat, lng){
  const data = await loadClosedAreas();
  if(!data) return {ok: false, error: 'closed area data could not be loaded'};
  const pt = [lng, lat];
  const near = expandBboxByMeters([lng, lat, lng, lat], CLOSED_AREA_NEARBY_M);
  const feats = data.zones.features;
  const hits = feats.filter(f => bboxContainsPoint(f.bbox, pt) && pointInGeometry(f.geometry, pt));
  const nearby = feats.filter(f => bboxesOverlap(f.bbox, near));
  const unmappedNear = data.unmapped.filter(u => closedAreaDistKm(u.ref, pt) <= u.radiusKm);
  return {ok: true, hits, nearby, unmappedNear, meta: data.meta, zoneCount: feats.length, unmappedCount: data.unmapped.length};
}

// Zones (features) that ban shooting today within a bounds-like bbox, for
// the Shooting Spots exclusion.
async function closedAreaBansInBbox(bbox){
  const data = await loadClosedAreas();
  if(!data) return [];
  return data.zones.features.filter(f => closedAreaBans(f.properties) && bboxesOverlap(f.bbox, bbox));
}

function closedAreaStyle(props){
  const ban = closedAreaBans(props);
  const color = ban ? MAP_PAL.restricted : MAP_PAL.caution;
  return {color, weight: MAP_W.line, dashArray: MAP_DASH, fillColor: color, fillOpacity: ban ? MAP_FILL.emphasis : MAP_FILL.area};
}
function closedAreaPopup(p){
  const season = p.season ? `<br>In effect ${esc(fmtSeason(p.season))} each year${closedAreaInSeason(p) ? '' : ' (not in effect today)'}` : '';
  return `<div style="font-size:12.5px;line-height:1.6;min-width:210px;max-width:280px"><b>${esc(p.name)}</b><br>${esc(CLOSED_AREA_KIND_LABEL[p.kind] || p.kind)}${p.crownOnly ? ' (Crown land)' : ''}${season}<br><span style="color:var(--muted)">${esc(p.summary)}${esc(closedAreaHuntingNote(p))}</span>${p.approx ? `<br><span style="color:var(--muted);font-size:11px">Approximate: ${esc(p.approx)}</span>` : ''}<br><span style="color:var(--muted);font-size:11px">${esc(p.cite)}</span></div>`;
}
function fmtSeason(s){
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const f = x => `${mon[+x.slice(0, 2) - 1]} ${+x.slice(3)}`;
  return `${f(s.from)} to ${f(s.to)}`;
}
function drawClosedAreaFeatures(features, targetLayer){
  features.forEach(f => {
    L.geoJSON(f, {style: closedAreaStyle(f.properties), bubblingMouseEvents: false})
      .on('click', e => openNearbyFeaturesPopupAt(e.latlng))
      .addTo(targetLayer);
    pushClickable(f.geometry, '', `${esc(CLOSED_AREA_KIND_LABEL[f.properties.kind] || 'Closed area')}: ${esc(f.properties.name)}`, 'Wildlife Act closed area', closedAreaPopup(f.properties));
  });
}
