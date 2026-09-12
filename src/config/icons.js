// v93: curated icon set for the "My Markup" pin system (docs/PLAN.md's
// module split, config slice). Plain classic script (see
// src/config/constants.js's own top comment for why this isn't an ES
// module) -- loaded via <script src="src/config/icons.js"> alongside the
// other two config files, before the main inline script, since
// markupPinIcon() references MARKUP_ICONS by bare name.
//
// Why an icon set at all, and why Lucide specifically: Karim asked for pins
// to carry more than the existing 8-colour dot -- "more than just the emoji
// library, what do you have access to?" Emoji were ruled out as the actual
// glyph source because their rendering isn't controllable (font, colour,
// size all vary by OS/browser, and several relevant glyphs -- a proper
// crosshair, a plain gate -- don't exist as emoji at all). Asked to choose
// between Lucide, Tabler Icons and Font Awesome Free, Karim picked Lucide.
// Lucide is ISC-licensed (confirmed via lucide-icons/lucide's own LICENSE
// file -- permissive, no attribution requirement, safe to vendor inline)
// and every icon shares one visual language: 24x24 viewBox, stroke-only
// (no fill), 2px stroke, round caps/joins -- which is exactly what lets a
// single small stroke-color override at render time (white, over whatever
// pin colour the user picked) make every icon in this file look like part
// of the same family instead of a mismatched icon-font grab-bag.
//
// Why vendored as inline path data, not loaded from a CDN: this app is
// explicitly a standalone file -- "works fully offline-of-Claude once
// downloaded, open directly in any browser" (docs/CHANGELOG.md) -- and, per
// v92's own finding, an ES-module-style dynamic import would break under
// file:// anyway. A classic <script src> pointed at a CDN would also just
// silently lose the icons the moment the page is opened offline or the CDN
// is unreachable, degrading a cosmetic feature into a broken one. Each
// icon's raw path/circle/line markup below was fetched verbatim from
// lucide-icons/lucide's own source (raw.githubusercontent.com, not a
// paraphrase) and is reproduced here exactly, just re-wrapped at render
// time in markupPinIcon()'s own <svg> element instead of each icon
// duplicating the full Lucide wrapper (xmlns/width/height/stroke
// attributes) 17 times over.
//
// `body` is the icon's inner markup only (no <svg> wrapper) -- the caller
// wraps it in an <svg viewBox="0 0 24 24" ...> with whatever stroke colour
// fits the context (white, for legibility over a coloured pin dot; the
// pin's own colour, for the icon-picker buttons in the editor modal).
// Categories match the four Karim selected when asked which mattered most
// for his markup pins (all four offered were picked): infrastructure he's
// evaluating (backstops, sightlines), access/terrain features, camp/shelter
// spots, and alerts/navigation waypoints.
const MARKUP_ICONS = [
  {
    id: "infra",
    label: "Hunting/shooting infrastructure",
    icons: [
      { id: "crosshair", label: "Crosshair", body: '<circle cx="12" cy="12" r="10" /><line x1="22" x2="18" y1="12" y2="12" /><line x1="6" x2="2" y1="12" y2="12" /><line x1="12" x2="12" y1="6" y2="2" /><line x1="12" x2="12" y1="22" y2="18" />' },
      { id: "target", label: "Target", body: '<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />' },
      { id: "camera", label: "Trail camera", body: '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" />' },
      { id: "eye", label: "Sightline / vantage", body: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />' },
      { id: "binoculars", label: "Observation point", body: '<path d="M10 10h4" /><path d="M19 7V4a1 1 0 0 0-1-1h-2a1 1 0 0 0-1 1v3" /><path d="M20 21a2 2 0 0 0 2-2v-3.851c0-1.39-2-2.962-2-4.829V8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2z" /><path d="M 22 16 L 2 16" /><path d="M4 21a2 2 0 0 1-2-2v-3.851c0-1.39 2-2.962 2-4.829V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2z" /><path d="M9 7V4a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v3" />' }
    ]
  },
  {
    id: "access",
    label: "Access & terrain",
    icons: [
      { id: "door-open", label: "Gate / access point", body: '<path d="M10 21H2" /><path d="M10 3H7a2 2 0 00-2 2v16" /><path d="M14 12h.01" /><path d="M19 21V5a2 2 0 00-1.675-1.974l-6.163-1.013A1 1 0 0010 3v18a1 1 0 001.124.992z" /><path d="M22 21h-3" />' },
      { id: "fence", label: "Fence / property line", body: '<path d="M4 3 2 5v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" /><path d="M6 8h4" /><path d="M6 18h4" /><path d="m12 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" /><path d="M14 8h4" /><path d="M14 18h4" /><path d="m20 3-2 2v15c0 .6.4 1 1 1h2c.6 0 1-.4 1-1V5Z" />' },
      { id: "car", label: "Parking / vehicle access", body: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" /><circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" />' },
      { id: "footprints", label: "Trail / footpath", body: '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" /><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" /><path d="M16 17h4" /><path d="M4 13h4" />' },
      { id: "droplet", label: "Water source", body: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />' }
    ]
  },
  {
    id: "camp",
    label: "Camp & shelter",
    icons: [
      { id: "tent", label: "Tent / camp", body: '<path d="M3.5 21 14 3" /><path d="M20.5 21 10 3" /><path d="M15.5 21 12 15l-3.5 6" /><path d="M2 21h20" />' },
      { id: "flame", label: "Campfire", body: '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />' },
      { id: "house", label: "Cabin / building", body: '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />' }
    ]
  },
  {
    id: "alerts",
    label: "Alerts & navigation",
    icons: [
      { id: "triangle-alert", label: "Caution", body: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />' },
      { id: "compass", label: "Waypoint / bearing", body: '<circle cx="12" cy="12" r="10" /><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />' },
      { id: "flag", label: "Marker flag", body: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528" />' },
      { id: "star", label: "Favourite spot", body: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />' }
    ]
  }
];

// Flat lookup by icon id -- every consumer (map pin render, list row,
// editor picker) wants "find the icon named X" far more often than "walk
// the categories", so build this once instead of re-flattening on every
// call.
const MARKUP_ICONS_BY_ID = {};
MARKUP_ICONS.forEach(cat => cat.icons.forEach(icon => { MARKUP_ICONS_BY_ID[icon.id] = icon; }));
