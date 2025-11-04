import * as maplibregl from "maplibre-gl";
import "@maplibre/maplibre-gl-inspect/dist/maplibre-gl-inspect.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  addProtocol,
  Map,
  NavigationControl,
  FullscreenControl,
  Popup,
} from "maplibre-gl";
import MaplibreInspect from "@maplibre/maplibre-gl-inspect";
import { Protocol, PMTiles } from "pmtiles";
import createStyle from "@enc-tiles/styles";

const tileset = import.meta.env.VITE_TILESET;
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);
const url = new URL(tileset, tilesUrl).toString();
const pmtiles = new PMTiles(url);
protocol.add(pmtiles);

// Fetch the header so we can get the center lon, lat of the map.
const header = await pmtiles.getHeader();

const style = createStyle({
  sprite: `${window.location.origin}/sprites`,
  source: {
    type: "vector",
    url: `pmtiles://${url}`,
  },
});

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  zoom: header.maxZoom,
  center: [header.centerLon, header.centerLat],
  style,
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: true }));
map.addControl(new FullscreenControl());
map.addControl(new MaplibreInspect({ popup: new Popup({}) }));
// ---------- BOUNDS & CENTER (use these numbers above map creation or in it) ----------
const BBOX_W = -6.416667;
const BBOX_S = 45.615;
const BBOX_E = -5.583333;
const BBOX_N = 46.5;
const BOUNDS = [BBOX_W, BBOX_S, BBOX_E, BBOX_N] as [
  number,
  number,
  number,
  number,
];

// If you haven't already set center and maxBounds in map creation, change the Map constructor to include:
// center: [-6.0, 46.0575], maxBounds: BOUNDS
// (Your current code sets center to header center; replace with the following map init if you want the forced center)

map.setCenter([-6.0, 46.0575]);
map.setMaxBounds(BOUNDS);

// --------------------- Helper functions ---------------------

/** Haversine distance between two [lon,lat] points in nautical miles */
function haversineNm(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3440.065; // radius of Earth in nautical miles
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const aa =
    sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

/** Format decimal degrees to "DD°MM'.MMN/S" and "DDD°MM'.MME/W" */
function formatLatLonForDisplay(lat: number, lon: number) {
  const fmt = (deg: number, isLat = true) => {
    const hemi = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
    const absDeg = Math.abs(deg);
    const d = Math.floor(absDeg);
    const m = (absDeg - d) * 60;
    return `${d.toString().padStart(isLat ? 2 : 3, "0")}°${m.toFixed(2).padStart(5, "0")}'${hemi}`;
  };
  return `${fmt(lat, true)} ${fmt(lon, false)}`;
}

/** create & download a file (used for GPX export) */
function downloadFile(
  filename: string,
  content: string,
  mime = "application/gpx+xml",
) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// --------------------- Cursor Coord Control ---------------------
class CursorCoordControl implements maplibregl.IControl {
  private container: HTMLElement;
  onAdd(map: maplibregl.Map) {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl cursor-coord-control";
    this.container.style.cssText =
      "background: rgba(255,255,255,0.9); padding:6px; font-family:monospace; font-size:12px; border-radius:4px;";
    this.container.textContent = ""; // will be replaced on mousemove
    map.on("mousemove", (e) => {
      this.container.textContent = formatLatLonForDisplay(
        e.lngLat.lat,
        e.lngLat.lng,
      );
    });
    return this.container;
  }
  onRemove() {
    this.container.parentNode?.removeChild(this.container);
  }
}

// --------------------- Measure Control ---------------------
class MeasureControl implements maplibregl.IControl {
  private container!: HTMLElement;
  private active = false;
  private pts: [number, number][] = [];
  private map?: maplibregl.Map;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl measure-control";
    this.container.style.cssText =
      "background: rgba(255,255,255,0.9); padding:6px; border-radius:4px;";
    const btn = document.createElement("button");
    btn.textContent = "Measure (NM)";
    btn.title = "Click to toggle measure mode. Click map to add points.";
    btn.style.cursor = "pointer";
    btn.onclick = () => this.toggle();
    const clear = document.createElement("button");
    clear.textContent = "Clear";
    clear.style.marginLeft = "6px";
    clear.onclick = () => this.clear();
    this.container.appendChild(btn);
    this.container.appendChild(clear);

    map.on("click", (e) => {
      if (!this.active) return;
      const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      this.pts.push(coord);
      this._updateLayer();
      this._updatePopup();
    });

    map.on("mousemove", (e) => {
      if (!this.active || this.pts.length === 0) return;
      // optional: show temporary line to cursor (not implemented here)
    });

    // create source + layer for measure line/points
    if (!map.getSource("measure")) {
      map.addSource("measure", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "measure-line",
        type: "line",
        source: "measure",
        paint: { "line-color": "#FF0000", "line-width": 2 },
      });
      map.addLayer({
        id: "measure-points",
        type: "circle",
        source: "measure",
        paint: { "circle-radius": 5, "circle-color": "#FF0000" },
      });
    }

    return this.container;
  }

  onRemove() {
    if (!this.map) return;
    this.map.off("click");
  }

  toggle() {
    this.active = !this.active;
    (this.container.querySelector("button") as HTMLElement).style.fontWeight =
      this.active ? "700" : "400";
    if (!this.active) {
      // optionally finalize
    }
  }

  clear() {
    this.pts = [];
    this._updateLayer();
    this._updatePopup(true);
  }

  _updateLayer() {
    if (!this.map) return;
    const features: any[] = [];
    for (const p of this.pts) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: {},
      });
    }
    if (this.pts.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: this.pts },
        properties: {},
      });
    }
    const src = this.map.getSource("measure") as maplibregl.GeoJSONSourceRaw;
    src.setData({ type: "FeatureCollection", features });
  }

  _updatePopup(clear = false) {
    // small ephemeral popup in corner of map showing current length in NM
    let existing = document.getElementById("measure-popup");
    if (clear && existing) existing.remove();
    if (clear) return;
    const total = this.pts.reduce((acc, _p, i, arr) => {
      if (i === 0) return 0;
      return acc + haversineNm(arr[i - 1], arr[i]);
    }, 0);
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "measure-popup";
      existing.style.cssText =
        "position:absolute; right:10px; bottom:10px; background:rgba(255,255,255,0.95); padding:6px; border-radius:4px; font-family:monospace;";
      document.body.appendChild(existing);
    }
    existing.textContent = `Measure: ${total.toFixed(2)} NM (${this.pts.length} points)`;
  }
}

// --------------------- Route draw & GPX export control ---------------------
class RouteDrawControl implements maplibregl.IControl {
  private container!: HTMLElement;
  private map?: maplibregl.Map;
  private drawing = false;
  private waypoints: [number, number][] = [];
  private markers: maplibregl.Marker[] = [];

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl route-draw-control";
    this.container.style.cssText =
      "background: rgba(255,255,255,0.9); padding:6px; border-radius:4px;";

    const startBtn = document.createElement("button");
    startBtn.textContent = "Start Route";
    startBtn.onclick = () => {
      this.drawing = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
    };

    const stopBtn = document.createElement("button");
    stopBtn.textContent = "Stop";
    stopBtn.disabled = true;
    stopBtn.style.marginLeft = "6px";
    stopBtn.onclick = () => {
      this.drawing = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
    };

    const exportBtn = document.createElement("button");
    exportBtn.textContent = "Export GPX";
    exportBtn.style.marginLeft = "6px";
    exportBtn.onclick = () => this.exportGpx();

    const clearBtn = document.createElement("button");
    clearBtn.textContent = "Clear";
    clearBtn.style.marginLeft = "6px";
    clearBtn.onclick = () => this.clearRoute();

    this.container.appendChild(startBtn);
    this.container.appendChild(stopBtn);
    this.container.appendChild(exportBtn);
    this.container.appendChild(clearBtn);

    map.on("click", (e) => {
      if (!this.drawing) return;
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      this.addWaypoint(p);
    });

    // add source + layers
    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#0000FF", "line-width": 3 },
      });
      map.addLayer({
        id: "route-waypoints",
        type: "circle",
        source: "route",
        paint: { "circle-radius": 6, "circle-color": "#0000FF" },
      });
    }

    return this.container;
  }

  addWaypoint(coord: [number, number]) {
    if (!this.map) return;

    const map = this.map;
    const el = document.createElement("div");
    el.style.cssText =
      "width:12px;height:12px;background:#0000FF;border-radius:50%;border:2px solid white;box-shadow:0 0 2px rgba(0,0,0,0.5);cursor:pointer;";

    const marker = new maplibregl.Marker({
      element: el,
      draggable: true,
    })
      .setLngLat(coord)
      .addTo(map);

    // Store the waypoint and its marker
    this.waypoints.push(coord);
    this.markers.push(marker);

    // 🖱️ Hover feedback
    el.addEventListener("mouseenter", () => {
      map.getCanvas().style.cursor = "move";
    });
    el.addEventListener("mouseleave", () => {
      map.getCanvas().style.cursor = "";
    });

    // 🧭 Drag behaviour (live update)
    marker.on("drag", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource(); // live line redraw while dragging
      }
    });

    // When drag ends, just ensure final update (optional)
    marker.on("dragend", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource();
      }
    });

    this._updateRouteSource();
  }

  _updateRouteSource() {
    if (!this.map) return;
    const features: any[] = [];
    for (const p of this.waypoints) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: {},
      });
    }
    if (this.waypoints.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: this.waypoints },
        properties: {},
      });
    }
    const src = this.map.getSource("route") as maplibregl.GeoJSONSource;
    src.setData({ type: "FeatureCollection", features });
  }

  exportGpx() {
    if (this.waypoints.length === 0) {
      alert("No waypoints to export.");
      return;
    }
    // Build GPX track
    const now = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="bluECS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${now}</time></metadata>
  <trk>
    <name>Route export - bluECS</name>
    <trkseg>
`;
    for (const p of this.waypoints) {
      const [lon, lat] = p;
      gpx += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>\n`;
    }
    gpx += `    </trkseg>
  </trk>
</gpx>`;

    downloadFile("route.gpx", gpx, "application/gpx+xml");
  }

  clearRoute() {
    this.waypoints = [];
    for (const m of this.markers) m.remove();
    this.markers = [];
    this._updateRouteSource();
  }

  onRemove() {
    // cleanup listeners if needed
  }
}

// Wait until map has finished loading to add custom controls
map.on("load", () => {
  // Add working controls
  map.addControl(new CursorCoordControl(), "bottom-left");
  map.addControl(new MeasureControl(), "top-left");
  map.addControl(new RouteDrawControl(), "top-left");

  // Add style to ensure they’re visible
  const styleTag = document.createElement("style");
  styleTag.textContent = `
  .maplibregl-ctrl {
    margin: 6px;
    z-index: 10 !important;
    position: relative !important;
  }
  .maplibregl-ctrl button {
    background: white;
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .maplibregl-ctrl button:hover {
    background: #eee;
  }
  .cursor-coord-control { min-width: 170px; text-align: left; }
  #measure-popup { z-index: 9999; }
  `;
  document.head.appendChild(styleTag);
});
