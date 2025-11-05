/* Revised index.ts — fixes MaplibreInspect timing, route-manager sync, robust predefined route loading,
   keeps UI and styling intact (route panel, context menus, GPX export, measure, cursor).
*/

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

/* --- PMTiles / style / map setup --- */
const tileset = import.meta.env.VITE_TILESET;
const tilesUrl =
  import.meta.env.VITE_TILES_URL && import.meta.env.VITE_TILES_URL.trim() !== ""
    ? import.meta.env.VITE_TILES_URL
    : window.location.origin + "/charts/";

const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);
const url = new URL(tileset, tilesUrl).toString();
const pmtiles = new PMTiles(url);
protocol.add(pmtiles);

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
  hash: true,
  zoom: header.maxZoom,
  center: [header.centerLon, header.centerLat],
  style,
});

/* Place navigation & fullscreen top-left */
map.addControl(
  new NavigationControl({ showZoom: true, showCompass: true }),
  "top-left",
);
map.addControl(new FullscreenControl(), "top-left");

/* --- Bounds --- */
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
map.setCenter([-6.0, 46.0575]);
map.setMaxBounds(BOUNDS);

/* --- Helpers --- */
function haversineNm(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3440.065; // nautical miles
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

function formatLatLonForDisplay(lat: number, lon: number) {
  const fmt = (deg: number, isLat = true) => {
    const hemi = isLat ? (deg >= 0 ? "N" : "S") : deg >= 0 ? "E" : "W";
    const absDeg = Math.abs(deg);
    const d = Math.floor(absDeg);
    const m = (absDeg - d) * 60;
    return `${d.toString().padStart(isLat ? 2 : 3, "0")}°${m
      .toFixed(2)
      .padStart(5, "0")}'${hemi}`;
  };
  return `${fmt(lat, true)} ${fmt(lon, false)}`;
}

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

/* --- Cursor control --- */
class CursorCoordControl implements maplibregl.IControl {
  private container!: HTMLElement;
  onAdd(map: maplibregl.Map) {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl cursor-coord-control";
    this.container.style.cssText =
      "background: rgba(255,255,255,0.9); padding:6px; font-family:monospace; font-size:12px; border-radius:4px;";
    map.on("mousemove", (e) => {
      this.container.textContent = formatLatLonForDisplay(
        e.lngLat.lat,
        e.lngLat.lng,
      );
    });
    return this.container;
  }
  onRemove() {
    this.container.remove();
  }
}

/* --- Measure control --- */
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

  onRemove() {}

  toggle() {
    this.active = !this.active;
    (this.container.querySelector("button") as HTMLElement).style.fontWeight =
      this.active ? "700" : "400";
  }

  clear() {
    this.pts = [];
    this._updateLayer();
    this._updatePopup(true);
  }

  private _updateLayer() {
    if (!this.map) return;
    const features: any[] = [];
    for (const p of this.pts)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: {},
      });
    if (this.pts.length >= 2)
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: this.pts },
        properties: {},
      });
    const src = this.map.getSource("measure") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) src.setData({ type: "FeatureCollection", features });
  }

  private _updatePopup(clear = false) {
    let existing = document.getElementById("measure-popup");
    if (clear && existing) existing.remove();
    if (clear) return;
    const total = this.pts.reduce(
      (acc, _p, i, arr) =>
        i === 0 ? 0 : acc + haversineNm(arr[i - 1], arr[i]),
      0,
    );
    if (!existing) {
      existing = document.createElement("div");
      existing.id = "measure-popup";
      existing.style.cssText =
        "position:absolute; left:202px; bottom:10px; background:rgba(255,255,255,0.95); padding:6px; border-radius:4px; font:12px/20px monospace;";
      document.body.appendChild(existing);
    }
    existing.textContent = `Measure: ${total.toFixed(2)} NM (${this.pts.length} points)`;
  }
}

/* --- Route draw & manager control --- */
class RouteDrawControl implements maplibregl.IControl {
  private container!: HTMLElement;
  private map?: maplibregl.Map;
  private drawing = false;

  // editor
  private waypoints: [number, number][] = [];
  private waypointNames: string[] = [];
  private markers: maplibregl.Marker[] = [];
  private routePanel!: HTMLElement;
  private routeName: string = "Route 1";
  private collapsed = false;

  // saved routes
  private savedRoutes: {
    name: string;
    waypoints: [number, number][];
    waypointNames: string[];
    visible: boolean;
    active: boolean;
    sourceId?: string;
    lineLayerId?: string;
    pointLayerId?: string;
  }[] = [];
  private activeRouteIndex = -1;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this._injectPanelCSS();
    this.routePanel = document.getElementById("route-panel") as HTMLElement;
    if (!this.routePanel) {
      this.routePanel = document.createElement("div");
      this.routePanel.id = "route-panel";
      this.routePanel.innerHTML = `
        <div id="route-panel-header">
          <span id="route-panel-title">Route Manager</span>
          <button id="route-panel-toggle" title="Collapse">&raquo;</button>
        </div>
        <div id="route-toolbar" style="padding:10px 15px 0 15px;">
          <button id="route-toolbar-start">New Route</button>
          <button id="route-toolbar-stop" disabled style="margin-left:6px;">End Route</button>
          <button id="route-toolbar-export" style="margin-left:6px;">Export GPX</button>
        </div>
        <div id="route-panel-body">
          <div style="margin-bottom:10px;">
            <label for="route-name-input" style="font-weight:600;">Route Name:</label>
            <input id="route-name-input" type="text" value="${this.routeName}" style="width:90%;margin-top:3px;">
          </div>
          <div id="route-waypoint-list"></div>
          <div id="route-total-length" style="margin-top:12px;font-weight:600;"></div>
          <div id="route-management" style="margin-top:10px;">
            <h3>Saved Routes</h3>
            <div id="saved-routes-list"></div>
          </div>
        </div>
      `;
      document.body.appendChild(this.routePanel);
    }

    // toggle
    const toggleBtn = this.routePanel.querySelector(
      "#route-panel-toggle",
    ) as HTMLButtonElement;
    toggleBtn.onclick = () => {
      this.collapsed = !this.collapsed;
      if (this.collapsed) {
        this.routePanel.classList.add("collapsed");
        toggleBtn.innerHTML = "&laquo;";
        toggleBtn.title = "Expand";
      } else {
        this.routePanel.classList.remove("collapsed");
        toggleBtn.innerHTML = "&raquo;";
        toggleBtn.title = "Collapse";
      }
    };

    // name input
    const nameInput = this.routePanel.querySelector(
      "#route-name-input",
    ) as HTMLInputElement;
    nameInput.addEventListener("input", () => {
      this.routeName = nameInput.value;
      this._updateRoutePanel();
    });

    // toolbar
    const startBtn = this.routePanel.querySelector(
      "#route-toolbar-start",
    ) as HTMLButtonElement;
    const stopBtn = this.routePanel.querySelector(
      "#route-toolbar-stop",
    ) as HTMLButtonElement;
    const exportBtn = this.routePanel.querySelector(
      "#route-toolbar-export",
    ) as HTMLButtonElement;

    startBtn.onclick = () => {
      this.drawing = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;

      // clear editor state
      for (const m of this.markers) m.remove();
      this.markers = [];
      this.waypoints = [];
      this.waypointNames = [];

      // create new empty saved route and set active
      this.routeName = `Route ${this.savedRoutes.length + 1}`;
      this.savedRoutes.push({
        name: this.routeName,
        waypoints: [],
        waypointNames: [],
        visible: true,
        active: true,
      });
      this.activeRouteIndex = this.savedRoutes.length - 1;
      this.savedRoutes.forEach(
        (r, i) => (r.active = i === this.activeRouteIndex),
      );
      // no route layers created yet — _updateRouteSource updates editor only
      this._syncActiveRouteToEditor();
      this._renderSavedRoutes();
      this._updateRoutePanel();
      this._updateRouteSource();
      this.updateActiveRouteData(this.waypoints);
    };

    stopBtn.onclick = () => {
      this.drawing = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      this._finalizeCurrentRoute();
      this._renderSavedRoutes();
      this._updateRoutePanel();
    };

    exportBtn.onclick = () => {
      if (
        this.activeRouteIndex >= 0 &&
        this.activeRouteIndex < this.savedRoutes.length
      ) {
        this._exportSavedRoute(this.activeRouteIndex);
      } else {
        // fallback to editor export
        this.exportGpx();
      }
    };

    map.on("click", (e) => {
      if (!this.drawing) return;
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      this.addWaypoint(p);
    });

    // create editor source/layers if needed
    if (!map.getSource("route")) {
      map.addSource("route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        paint: { "line-color": "#003366", "line-width": 3 },
      });
      map.addLayer({
        id: "route-waypoints",
        type: "circle",
        source: "route",
        paint: {
          "circle-radius": 7,
          "circle-color": "#0077b6",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
    }

    // context menu on editor line (marker elements also get contextmenu)
    map.on("contextmenu", "route-line", (e) => {
      e.preventDefault();
      this._showContextMenu("line", e);
    });

    map.on("contextmenu", "route-waypoints", (e) => {
      e.preventDefault();
      this._showContextMenu("waypoint", e);
    });

    // load saved routes (predefined)
    this._updateRoutePanel();
    this._loadPredefinedRoutes();

    return this.container;
  }

  // central marker creation used by both sync and editor insertion
  private _createMarkerAt(
    idx: number,
    coord: [number, number],
    name = "",
    insert = false,
  ) {
    if (!this.map) return;
    const el = document.createElement("div");
    el.style.cssText =
      "width:15px;height:15px;background:#0077b6;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.18);cursor:pointer;transition:box-shadow .12s;";
    if (name) el.setAttribute("title", name);
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat(coord)
      .addTo(this.map);

    el.addEventListener("mouseenter", () => {
      el.style.boxShadow = "0 0 8px rgba(0,68,119,0.6)";
      this.map!.getCanvas().style.cursor = "move";
    });
    el.addEventListener("mouseleave", () => {
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.18)";
      this.map!.getCanvas().style.cursor = "";
    });

    marker.on("drag", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        if (
          this.activeRouteIndex >= 0 &&
          this.activeRouteIndex < this.savedRoutes.length
        ) {
          this.savedRoutes[this.activeRouteIndex].waypoints[index] = [
            newPos.lng,
            newPos.lat,
          ];
        }
        // update editor source and panel live
        this._updateRouteSource();
        this.updateActiveRouteData(this.waypoints);
        this._updateRoutePanel();
      }
    });

    // right click / long press handled via DOM contextmenu
    el.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      const synthetic = {
        lngLat: marker.getLngLat(),
        originalEvent: evt,
      } as unknown as maplibregl.MapMouseEvent;
      this._showContextMenu("waypoint", synthetic);
    });

    if (insert) this.markers.splice(idx, 0, marker);
    else this.markers[idx] = marker;
  }

  addWaypoint(coord: [number, number]) {
    if (!this.map) return;
    // ensure an active route exists
    if (
      this.activeRouteIndex < 0 ||
      this.activeRouteIndex >= this.savedRoutes.length
    ) {
      // create new saved route and become active
      this.routeName = `Route ${this.savedRoutes.length + 1}`;
      this.savedRoutes.push({
        name: this.routeName,
        waypoints: [],
        waypointNames: [],
        visible: true,
        active: true,
      });
      this.activeRouteIndex = this.savedRoutes.length - 1;
      this.savedRoutes.forEach(
        (r, i) => (r.active = i === this.activeRouteIndex),
      );
    }

    // push and make marker
    this.waypoints.push(coord);
    this.waypointNames.push("");
    const idx = this.waypoints.length - 1;
    this._createMarkerAt(idx, coord, "", false);

    // reflect into saved route being edited
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      const r = this.savedRoutes[this.activeRouteIndex];
      r.waypoints = this.waypoints.map((p) => [...p]);
      r.waypointNames = [...this.waypointNames];
    }

    this._updateRouteSource();
    this.updateActiveRouteData(this.waypoints);
    this._updateRoutePanel();
  }

  private _addWaypointAtNearestSegment(coord: [number, number]) {
    if (!this.map) return;
    if (this.waypoints.length < 2) {
      this.addWaypoint(coord);
      return;
    }
    let minDist = Infinity;
    let insertIndex = 0;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const dist = this._pointToSegmentDistance(
        coord,
        this.waypoints[i],
        this.waypoints[i + 1],
      );
      if (dist < minDist) {
        minDist = dist;
        insertIndex = i + 1;
      }
    }
    this.waypoints.splice(insertIndex, 0, coord);
    this.waypointNames.splice(insertIndex, 0, "");
    this._createMarkerAt(insertIndex, coord, "", true);

    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      this.savedRoutes[this.activeRouteIndex].waypoints = this.waypoints.map(
        (p) => [...p],
      );
      this.savedRoutes[this.activeRouteIndex].waypointNames = [
        ...this.waypointNames,
      ];
    }

    this._updateRouteSource();
    this.updateActiveRouteData(this.waypoints);
    this._updateRoutePanel();
  }

  private _updateRouteSource() {
    if (!this.map) return;
    const features: any[] = [];
    if (this.waypoints.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: this.waypoints },
        properties: {},
      });
    }
    for (let i = 0; i < this.waypoints.length; ++i) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: this.waypoints[i] },
        properties: { name: this.waypointNames[i] || "" },
      });
    }
    const src = this.map.getSource("route") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (src) src.setData({ type: "FeatureCollection", features });
    // update titles on markers
    for (let i = 0; i < this.markers.length; ++i) {
      const el = this.markers[i]?.getElement();
      if (el) el.setAttribute("title", this.waypointNames[i] || "");
    }
  }
  updateActiveRouteData(updatedCoords: [number, number][]) {
    if (!this.activeRouteId) return;
    const route = this.routes.find((r) => r.id === this.activeRouteId);
    if (route) {
      route.waypoints = updatedCoords;
    }
    // Refresh both active and inactive routes
    if (typeof this._updateRouteSources === "function") {
      this._updateRouteSources();
    } else if (typeof this._updateRouteSource === "function") {
      this._updateRouteSource();
      this.updateActiveRouteData(this.waypoints);
    }
  }
  private _updateRoutePanel() {
    if (!this.routePanel) return;
    const nameInput = this.routePanel.querySelector(
      "#route-name-input",
    ) as HTMLInputElement;
    if (document.activeElement !== nameInput) nameInput.value = this.routeName;

    const listDiv = this.routePanel.querySelector(
      "#route-waypoint-list",
    ) as HTMLElement;
    if (!listDiv) return;
    if (this.waypoints.length === 0) {
      listDiv.innerHTML = `<div style="color:#888;font-style:italic;">No waypoints</div>`;
    } else {
      let html = `<table class="route-wp-table"><thead><tr><th>#</th><th>Name</th><th>Lat/Lon</th><th>Bearing</th><th>Dist</th><th></th></tr></thead><tbody>`;
      let total = 0;
      for (let i = 0; i < this.waypoints.length; ++i) {
        const [lon, lat] = this.waypoints[i];
        const name = this.waypointNames[i] || "";
        let bearing = "";
        let dist = "";
        if (i > 0) {
          bearing = this._calculateBearing(
            this.waypoints[i - 1],
            this.waypoints[i],
          );
          const d = haversineNm(this.waypoints[i - 1], this.waypoints[i]);
          dist = d.toFixed(2);
          total += d;
        }
        html += `<tr>
          <td>${i + 1}</td>
          <td><input class="wp-name-input" type="text" value="${name}" data-idx="${i}" style="width:80px;"></td>
          <td style="font-family:monospace;font-size:12px;">${formatLatLonForDisplay(lat, lon)}</td>
          <td style="text-align:center;">${bearing}</td>
          <td style="text-align:right;">${dist ? dist + " NM" : ""}</td>
          <td><button class="wp-delete-btn" title="Delete" data-idx="${i}" style="padding:2px 6px;">✖</button></td>
        </tr>`;
      }
      html += "</tbody></table>";
      listDiv.innerHTML = html;

      listDiv.querySelectorAll(".wp-name-input").forEach((input) => {
        input.addEventListener("input", (e) => {
          const idx = parseInt((e.target as HTMLInputElement).dataset.idx!);
          this.waypointNames[idx] = (e.target as HTMLInputElement).value;
          if (
            this.activeRouteIndex >= 0 &&
            this.activeRouteIndex < this.savedRoutes.length
          ) {
            this.savedRoutes[this.activeRouteIndex].waypointNames[idx] =
              this.waypointNames[idx];
          }
          this._updateRouteSource();
          this.updateActiveRouteData(this.waypoints);
        });
      });
      listDiv.querySelectorAll(".wp-delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = parseInt((e.target as HTMLElement).dataset.idx!);
          this._deleteWaypoint(idx);
        });
      });
    }

    const totDiv = this.routePanel.querySelector(
      "#route-total-length",
    ) as HTMLElement;
    let tot = 0;
    for (let i = 1; i < this.waypoints.length; ++i)
      tot += haversineNm(this.waypoints[i - 1], this.waypoints[i]);
    totDiv.textContent = `Total: ${tot.toFixed(2)} NM`;

    this._renderSavedRoutes();
  }

  private _calculateBearing(a: [number, number], b: [number, number]): string {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const lat1 = toRad(a[1]);
    const lat2 = toRad(b[1]);
    const dLon = toRad(b[0] - a[0]);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    let brng = Math.atan2(y, x);
    brng = toDeg(brng);
    brng = (brng + 360) % 360;
    return `${brng.toFixed(0)}°`;
  }

  private _deleteWaypoint(idx: number) {
    if (idx < 0 || idx >= this.waypoints.length) return;
    this.markers[idx]?.remove();
    this.markers.splice(idx, 1);
    this.waypoints.splice(idx, 1);
    this.waypointNames.splice(idx, 1);
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      const r = this.savedRoutes[this.activeRouteIndex];
      r.waypoints = this.waypoints.map((p) => [...p]);
      r.waypointNames = [...this.waypointNames];
    }
    this._updateRouteSource();
    this.updateActiveRouteData(this.waypoints);
    this._updateRoutePanel();
  }

  exportGpx() {
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      this._exportSavedRoute(this.activeRouteIndex);
      return;
    }
    if (this.waypoints.length === 0) {
      alert("No waypoints to export.");
      return;
    }
    const now = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="bluECS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${now}</time></metadata>
  <trk>
    <name>${this._escapeXml(this.routeName)}</name>
    <trkseg>
`;
    for (const p of this.waypoints) {
      const [lon, lat] = p;
      gpx += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>\n`;
    }
    gpx += `    </trkseg>
  </trk>
</gpx>`;
    downloadFile(
      `${(this.routeName || "route").replace(/[^a-zA-Z0-9]/g, "_")}.gpx`,
      gpx,
    );
  }

  private _escapeXml(s: string) {
    return s.replace(
      /[<>&'"]/g,
      (c) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          "'": "&apos;",
          '"': "&quot;",
        })[c] || c,
    );
  }

  onRemove() {
    if (this.routePanel) this.routePanel.remove();
    if (!this.map) return;
    for (let i = 0; i < this.savedRoutes.length; ++i)
      this._removeRouteLayers(i);
  }

  private _showContextMenu(
    type: "line" | "waypoint",
    e: maplibregl.MapMouseEvent,
  ) {
    if (!this.map) return;
    const existing = document.getElementById("route-context-menu");
    if (existing) existing.remove();
    const menu = document.createElement("div");
    menu.id = "route-context-menu";
    menu.style.position = "absolute";
    menu.style.background = "#fff";
    menu.style.border = "1px solid #a4b5c2";
    menu.style.borderRadius = "6px";
    menu.style.padding = "4px 0";
    menu.style.fontFamily = "inherit";
    menu.style.fontSize = "15px";
    menu.style.boxShadow = "0 2px 8px rgba(0,0,0,0.14)";
    menu.style.zIndex = "10000";

    const rect = this.map.getContainer().getBoundingClientRect();
    const left = (e.originalEvent as MouseEvent).clientX - rect.left;
    const top = (e.originalEvent as MouseEvent).clientY - rect.top;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const createMenuItem = (text: string, onClick: () => void) => {
      const item = document.createElement("div");
      item.textContent = text;
      item.style.padding = "7px 18px";
      item.style.cursor = "pointer";
      item.style.userSelect = "none";
      item.addEventListener(
        "mouseenter",
        () => (item.style.background = "#e0efff"),
      );
      item.addEventListener(
        "mouseleave",
        () => (item.style.background = "transparent"),
      );
      item.addEventListener("click", () => {
        onClick();
        menu.remove();
      });
      return item;
    };

    if (type === "line") {
      menu.appendChild(
        createMenuItem("Add Waypoint", () => {
          const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          this._addWaypointAtNearestSegment(coord);
        }),
      );
    } else {
      const clickCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      let nearestIndex = -1;
      let minDist = Infinity;
      for (let i = 0; i < this.waypoints.length; i++) {
        const wp = this.waypoints[i];
        const dist = Math.hypot(wp[0] - clickCoord[0], wp[1] - clickCoord[1]);
        if (dist < minDist) {
          minDist = dist;
          nearestIndex = i;
        }
      }
      if (nearestIndex === -1) return;
      menu.appendChild(
        createMenuItem("Name Waypoint", () => {
          const currentName = this.waypointNames[nearestIndex] || "";
          const newName = prompt("Enter waypoint name:", currentName);
          if (newName !== null) {
            this.waypointNames[nearestIndex] = newName;
            const marker = this.markers[nearestIndex];
            if (marker) marker.getElement().setAttribute("title", newName);
            if (
              this.activeRouteIndex >= 0 &&
              this.activeRouteIndex < this.savedRoutes.length
            ) {
              this.savedRoutes[this.activeRouteIndex].waypointNames[
                nearestIndex
              ] = newName;
            }
            this._updateRouteSource();
            this.updateActiveRouteData(this.waypoints);
            this._updateRoutePanel();
          }
        }),
      );
      menu.appendChild(
        createMenuItem("Delete Waypoint", () => {
          this._deleteWaypoint(nearestIndex);
        }),
      );
    }

    this.map.getContainer().appendChild(menu);
    const onClickOutside = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener("click", onClickOutside);
      }
    };
    document.addEventListener("click", onClickOutside);
  }

  private _pointToSegmentDistance(
    p: [number, number],
    v: [number, number],
    w: [number, number],
  ) {
    const [px, py] = p;
    const [vx, vy] = v;
    const [wx, wy] = w;
    const l2 = (wx - vx) ** 2 + (wy - vy) ** 2;
    if (l2 === 0) return Math.hypot(px - vx, py - vy);
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projx = vx + t * (wx - vx);
    const projy = vy + t * (wy - vy);
    return Math.hypot(px - projx, py - projy);
  }

  private _injectPanelCSS() {
    if (document.getElementById("route-panel-style")) return;
    const s = document.createElement("style");
    s.id = "route-panel-style";
    s.textContent = `
#route-panel { position: fixed; right: 0; top: 0; width: 350px; max-width: 95vw; height: 100%; background: #f7faff; border-left: 2px solid #b2cbe3; box-shadow: -3px 0 10px rgba(0,44,85,0.07); z-index: 11000; font-family: 'Segoe UI', Arial, sans-serif; color: #06365f; display:flex; flex-direction:column; transition: width .18s; }
#route-panel.collapsed { width: 48px !important; overflow: hidden; height:48px !important; }
#route-panel-header { display:flex; align-items:center; justify-content:space-between; padding:10px 10px 8px 15px; border-bottom:1px solid #d7e6f3; background:#e3f1ff; position:relative; }
#route-panel.collapsed #route-panel-title, #route-panel.collapsed #route-panel-body, #route-panel.collapsed #route-name-header, #route-panel.collapsed #route-toolbar { display:none; }
#route-panel-toggle { background:#d7e6f3; border:none; border-radius:5px; font-size:16px; width:28px; height:28px; cursor:pointer; color:#06365f; font-weight:700; position:absolute; right:10px; top:10px; }
#route-panel-body { padding:12px 15px; overflow-y:auto; flex:1 1 auto; }
.route-wp-table { border-collapse:collapse; width:100%; font-size:13px; margin-bottom:12px; }
.route-wp-table th, .route-wp-table td { border-bottom:1px solid #e6ecf5; padding:2px 5px; text-align:left; }
.route-wp-table th { background:#f2f7fb; font-weight:600; color:#074369; font-size:12px; }
.route-wp-table input[type="text"] { background:#f4faff; border:1px solid #c6d6e7; border-radius:3px; font-size:13px; padding:2px 4px; color:#044; }
.route-wp-table .wp-delete-btn { background:#f8d7da; color:#a33; border:none; border-radius:3px; font-size:13px; cursor:pointer; }
#route-total-length { font-size:15px; color:#074369; margin-top:10px; }
.route-item { background:#eaf3fc; margin-bottom:7px; border-radius:6px; padding:7px 9px; cursor:pointer; border:1px solid #d7e6f3; display:flex; align-items:center; justify-content:space-between; position:relative; }
.route-item.active { background:#cfe2fa; border-color:#88b1e7; font-weight:600; }
.route-actions { display:flex; gap:6px; align-items:center; }
.route-item-details { font-size:12px; margin-top:3px; color:#044; background:#f7fbff; border-radius:4px; padding:5px 7px 4px 25px; border-left:2px solid #b2cbe3; }
`;
    document.head.appendChild(s);
  }

  // more robust predefined route loader with logs — expects /routes/index.json or route1.gpx etc.
  private async _loadPredefinedRoutes() {
    if (!this.map) return;
    console.debug("[routes] loading predefined routes...");
    let gpxFiles: string[] = [];
    try {
      const indexResp = await fetch("/routes/index.json");
      if (indexResp.ok) {
        gpxFiles = await indexResp.json();
        console.debug("[routes] index.json found:", gpxFiles);
      }
    } catch (err) {
      console.debug(
        "[routes] no index.json or fetch failed, falling back to enumeration",
      );
    }

    if (gpxFiles.length === 0) {
      // try common names route1..route10
      for (let i = 1; i <= 10; i++) {
        try {
          const u = `/routes/route${i}.gpx`;
          const r = await fetch(u, { method: "HEAD" });
          if (r.ok) {
            gpxFiles.push(`route${i}.gpx`);
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (gpxFiles.length === 0)
      console.debug("[routes] no predefined GPX files discovered in /routes/");

    for (const fname of gpxFiles) {
      try {
        const resp = await fetch(`/routes/${fname}`);
        if (!resp.ok) {
          console.warn(`[routes] failed to fetch ${fname}: ${resp.status}`);
          continue;
        }
        const xml = await resp.text();
        const parsed = this._parseGpxToWaypoints(xml);
        if (parsed.waypoints.length > 0) {
          this.savedRoutes.push({
            name: parsed.name || fname.replace(/\.gpx$/i, ""),
            waypoints: parsed.waypoints,
            waypointNames: parsed.waypointNames,
            visible: false,
            active: false,
          });
          console.debug(
            `[routes] loaded ${fname} (${parsed.waypoints.length} wpts)`,
          );
        }
      } catch (err) {
        console.warn(`[routes] error reading ${fname}`, err);
      }
    }
    this._renderSavedRoutes();
  }

  private _parseGpxToWaypoints(xml: string): {
    name: string;
    waypoints: [number, number][];
    waypointNames: string[];
  } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    let name = "";
    let waypoints: [number, number][] = [];
    let waypointNames: string[] = [];
    const rtepts = Array.from(doc.getElementsByTagName("rtept"));
    if (rtepts.length > 0) {
      waypoints = rtepts.map((el) => [
        parseFloat(el.getAttribute("lon") || "0"),
        parseFloat(el.getAttribute("lat") || "0"),
      ]);
      waypointNames = rtepts.map((el) => {
        const n = el.getElementsByTagName("name");
        return n.length > 0 ? n[0].textContent || "" : "";
      });
    } else {
      const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
      waypoints = trkpts.map((el) => [
        parseFloat(el.getAttribute("lon") || "0"),
        parseFloat(el.getAttribute("lat") || "0"),
      ]);
      waypointNames = trkpts.map(() => "");
    }
    const nameElem = doc.querySelector("rte > name, trk > name, gpx > name");
    if (nameElem && nameElem.textContent) name = nameElem.textContent;
    return { name, waypoints, waypointNames };
  }

  private _renderSavedRoutes() {
    const listDiv = this.routePanel?.querySelector(
      "#saved-routes-list",
    ) as HTMLElement;
    if (!listDiv) return;
    listDiv.innerHTML = "";
    if (this.savedRoutes.length === 0) {
      listDiv.innerHTML = `<div style="color:#888;font-style:italic;">No saved routes</div>`;
      return;
    }
    this.savedRoutes.forEach((route, idx) => {
      const div = document.createElement("div");
      div.className = "route-item" + (route.active ? " active" : "");
      const visibleBox = document.createElement("input");
      visibleBox.type = "checkbox";
      visibleBox.checked = !!route.visible;
      visibleBox.title = "Show on Chart";
      visibleBox.onclick = (ev) => {
        ev.stopPropagation();
        this._toggleRouteVisibility(idx);
      };

      const nameSpan = document.createElement("span");
      nameSpan.textContent = route.name;
      nameSpan.style.flex = "1";
      nameSpan.style.userSelect = "none";
      nameSpan.style.marginLeft = "5px";
      nameSpan.style.fontWeight = route.active ? "700" : "500";

      let expanded = !!route.active;
      const detailsDiv = document.createElement("div");
      detailsDiv.className = "route-item-details";
      detailsDiv.style.display = expanded ? "block" : "none";
      detailsDiv.innerHTML = `Waypoints: ${route.waypoints.length}<br>Total: ${this._routeTotalDistance(route).toFixed(2)} NM`;

      nameSpan.onclick = (ev) => {
        ev.stopPropagation();
        expanded = !expanded;
        detailsDiv.style.display = expanded ? "block" : "none";
        this._setActiveRoute(idx);
      };

      const actions = document.createElement("span");
      actions.className = "route-actions";
      const exportBtn = document.createElement("button");
      exportBtn.textContent = "Export";
      exportBtn.title = "Export GPX";
      exportBtn.onclick = (ev) => {
        ev.stopPropagation();
        this._exportSavedRoute(idx);
      };
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.title = "Delete Route";
      delBtn.style.color = "#a33";
      delBtn.onclick = (ev) => {
        ev.stopPropagation();
        this._deleteSavedRoute(idx);
      };
      actions.appendChild(exportBtn);
      actions.appendChild(delBtn);

      div.appendChild(visibleBox);
      div.appendChild(nameSpan);
      div.appendChild(actions);
      div.appendChild(detailsDiv);

      div.onclick = () => {
        expanded = !expanded;
        detailsDiv.style.display = expanded ? "block" : "none";
        this._setActiveRoute(idx);
      };

      listDiv.appendChild(div);
    });
  }

  private _setActiveRoute(index: number) {
    if (index < 0 || index >= this.savedRoutes.length) return;
    this.savedRoutes.forEach((r, i) => (r.active = i === index));
    this.activeRouteIndex = index;
    this._syncActiveRouteToEditor();
    this._renderSavedRoutes();
    this._updateRoutePanel();
    this._updateRouteSource();
    this.updateActiveRouteData(this.waypoints);
  }

  private _syncActiveRouteToEditor() {
    // remove old markers
    for (const m of this.markers) m.remove();
    this.markers = [];

    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      const route = this.savedRoutes[this.activeRouteIndex];
      this.routeName = route.name;
      this.waypoints = route.waypoints.map((p) => [...p]);
      this.waypointNames = route.waypointNames.map((n) => n);
      // create markers at indexes (no double-push)
      for (let i = 0; i < this.waypoints.length; ++i)
        this._createMarkerAt(
          i,
          this.waypoints[i],
          this.waypointNames[i] || "",
          false,
        );
      this._updateRouteSource();
      this.updateActiveRouteData(this.waypoints);
    } else {
      this.routeName = "";
      this.waypoints = [];
      this.waypointNames = [];
      this.markers.forEach((m) => m.remove());
      this.markers = [];
    }
  }

  private _toggleRouteVisibility(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    route.visible = !route.visible;
    if (route.visible) this._addRouteLayers(index);
    else this._removeRouteLayers(index);
    this._renderSavedRoutes();
  }

  private _addRouteLayers(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    this._removeRouteLayers(index);
    const sourceId = `route-src-${index}`;
    const lineLayerId = `route-line-${index}`;
    const pointLayerId = `route-points-${index}`;

    const features: any[] = [];
    if (route.waypoints.length >= 2)
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.waypoints },
        properties: {},
      });
    for (let i = 0; i < route.waypoints.length; ++i)
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: route.waypoints[i] },
        properties: { name: route.waypointNames[i] || "" },
      });

    try {
      this.map.addSource(sourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features },
      });
      this.map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#0077b6",
          "line-width": 3,
          "line-dasharray": [2, 2],
        },
      });
      this.map.addLayer({
        id: pointLayerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 6,
          "circle-color": "#2a7ecf",
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 2,
        },
      });
      route.sourceId = sourceId;
      route.lineLayerId = lineLayerId;
      route.pointLayerId = pointLayerId;
    } catch (err) {
      console.warn("[routes] failed to add route layers for index", index, err);
    }
  }

  private _removeRouteLayers(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    if (!route) return;
    try {
      if (route.lineLayerId && this.map.getLayer(route.lineLayerId))
        this.map.removeLayer(route.lineLayerId);
      if (route.pointLayerId && this.map.getLayer(route.pointLayerId))
        this.map.removeLayer(route.pointLayerId);
      if (route.sourceId && this.map.getSource(route.sourceId))
        this.map.removeSource(route.sourceId);
    } catch (err) {
      console.warn("[routes] error removing layers for index", index, err);
    }
    route.lineLayerId = undefined;
    route.pointLayerId = undefined;
    route.sourceId = undefined;
  }

  private _deleteSavedRoute(index: number) {
    if (!this.map) return;
    this._removeRouteLayers(index);
    this.savedRoutes.splice(index, 1);
    if (this.activeRouteIndex === index) {
      if (this.savedRoutes.length > 0) {
        this.activeRouteIndex = 0;
        this.savedRoutes.forEach((r, i) => (r.active = i === 0));
        this._syncActiveRouteToEditor();
      } else {
        this.activeRouteIndex = -1;
        this.waypoints = [];
        this.waypointNames = [];
        this.markers.forEach((m) => m.remove());
        this.markers = [];
        this.routeName = "";
      }
    } else if (this.activeRouteIndex > index) {
      this.activeRouteIndex--;
    }
    // rebuild visible route layers to keep source/layer ids consistent with index
    for (let i = 0; i <= this.savedRoutes.length; ++i)
      this._removeRouteLayers(i);
    for (let i = 0; i < this.savedRoutes.length; ++i)
      if (this.savedRoutes[i].visible) this._addRouteLayers(i);
    this._renderSavedRoutes();
    this._updateRoutePanel();
    this._updateRouteSource();
    this.updateActiveRouteData(this.waypoints);
  }

  private _exportSavedRoute(index: number) {
    const route = this.savedRoutes[index];
    if (!route || route.waypoints.length === 0) {
      alert("No waypoints to export.");
      return;
    }
    const now = new Date().toISOString();
    let gpx = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<gpx version="1.1" creator="bluECS" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><time>${now}</time></metadata>
  <rte>
    <name>${this._escapeXml(route.name)}</name>
`;
    for (let i = 0; i < route.waypoints.length; ++i) {
      const [lon, lat] = route.waypoints[i];
      const name = route.waypointNames[i] || `WP${i + 1}`;
      gpx += `    <rtept lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${this._escapeXml(name)}</name></rtept>\n`;
    }
    gpx += `  </rte>
  <trk>
    <name>${this._escapeXml(route.name)}</name>
    <trkseg>
`;
    for (const p of route.waypoints) {
      const [lon, lat] = p;
      gpx += `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"></trkpt>\n`;
    }
    gpx += `    </trkseg>
  </trk>
</gpx>`;
    downloadFile(
      `${route.name.replace(/[^a-zA-Z0-9]/g, "_") || "route"}.gpx`,
      gpx,
      "application/gpx+xml",
    );
  }

  private _finalizeCurrentRoute() {
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      this.savedRoutes[this.activeRouteIndex].name = this.routeName;
      this.savedRoutes[this.activeRouteIndex].waypoints = this.waypoints.map(
        (p) => [...p],
      );
      this.savedRoutes[this.activeRouteIndex].waypointNames = [
        ...this.waypointNames,
      ];
      this.savedRoutes[this.activeRouteIndex].visible = true;
      this.savedRoutes[this.activeRouteIndex].active = true;
      // add route layers for the saved route
      this._addRouteLayers(this.activeRouteIndex);
    }
  }

  private _routeTotalDistance(route: { waypoints: [number, number][] }) {
    let tot = 0;
    for (let i = 1; i < route.waypoints.length; ++i)
      tot += haversineNm(route.waypoints[i - 1], route.waypoints[i]);
    return tot;
  }
}

/* --- add controls after map idle (safe for MaplibreInspect / tiles) --- */
map.on("load", () => {
  // add controls that are safe on load
  map.addControl(new CursorCoordControl(), "bottom-left");
  map.addControl(new MeasureControl(), "bottom-left");
  map.addControl(new RouteDrawControl(), "top-right");

  // wait for 'idle' event (style and initial tiles finished) before adding MaplibreInspect
  map.once("idle", () => {
    try {
      // create the inspect control first so we can defensively wrap its internal method
      const inspect = new MaplibreInspect({ popup: new Popup({}) });

      // Defensive wrapper for MaplibreInspect._setSourcesFromMap which assumes map.style.sourceCaches
      // This prevents intermittent errors where the style or sourceCaches are not yet available
      // during certain tile events. We wrap the instance method rather than patching the library
      // globally.
      try {
        const orig = (inspect as any)._setSourcesFromMap;
        (inspect as any)._setSourcesFromMap = function (...args: any[]) {
          try {
            if (!this._map || !this._map.style || !this._map.style.sourceCaches)
              return;
          } catch (e) {
            // if anything unexpected occurs, bail out gracefully
            return;
          }
          if (typeof orig === "function") return orig.apply(this, args);
        };
      } catch (e) {
        // if wrapping fails, continue — we'll still try to add the control
        console.warn("[map] failed to wrap MaplibreInspect internals:", e);
      }

      map.addControl(inspect, "top-left");
      console.debug("[map] MaplibreInspect added after idle (wrapped).");
    } catch (err) {
      console.warn("[map] failed to add MaplibreInspect:", err);
    }
  });

  // small style tag for control aesthetics
  const styleTag = document.createElement("style");
  styleTag.textContent = `
  .maplibregl-ctrl { margin: 6px; z-index: 10 !important; position: relative !important; }
  .maplibregl-ctrl button { background-color: white; border: 1px solid #ccc; border-radius: 4px; cursor:pointer; }
  .maplibregl-ctrl button:hover { background-color: #eee; }
  .cursor-coord-control { min-width: 170px; text-align: left; }
  #measure-popup { z-index: 9999; }
  `;
  document.head.appendChild(styleTag);
});
