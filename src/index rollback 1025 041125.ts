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

map.addControl(
  new NavigationControl({ showZoom: true, showCompass: true }),
  "top-left",
);
map.addControl(new FullscreenControl(), "top-left");
map.addControl(new MaplibreInspect({ popup: new Popup({}) }), "top-left");
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
  // For legacy single route editing (active route)
  private waypoints: [number, number][] = [];
  private waypointNames: string[] = [];
  private markers: maplibregl.Marker[] = [];
  private routePanel!: HTMLElement;
  private routeName: string = "Route 1";
  private collapsed: boolean = false;
  // Route management system
  private savedRoutes: {
    name: string;
    waypoints: [number, number][];
    waypointNames: string[];
    visible: boolean;
    active: boolean;
    lineLayerId?: string;
    pointLayerId?: string;
    sourceId?: string;
  }[] = [];
  private activeRouteIndex: number = -1;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl route-draw-control";
    this.container.style.cssText =
      "background: rgba(255,255,255,0.9); padding:6px; border-radius:4px;";

    // --- Route info sidebar panel ---
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
    // Panel collapse/expand
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
    // Route name editing
    const nameInput = this.routePanel.querySelector(
      "#route-name-input",
    ) as HTMLInputElement;
    nameInput.addEventListener("input", () => {
      this.routeName = nameInput.value;
      this._updateRoutePanel();
    });
    // --- Toolbar button bindings ---
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
      // Start new route: reset current editing state, create new empty route, and set as active
      this.drawing = true;
      startBtn.disabled = true;
      stopBtn.disabled = false;
      // Finalize current editing route if it has waypoints
      if (this.waypoints.length > 0) {
        this._finalizeCurrentRoute();
      }
      // Clear editing state
      this.waypoints = [];
      this.waypointNames = [];
      for (const m of this.markers) m.remove();
      this.markers = [];
      this.routeName = `Route ${this.savedRoutes.length + 1}`;
      // Add new empty route to savedRoutes and set as active
      this.savedRoutes.push({
        name: this.routeName,
        waypoints: [],
        waypointNames: [],
        visible: true,
        active: true,
      });
      this.activeRouteIndex = this.savedRoutes.length - 1;
      // Set all other routes inactive
      this.savedRoutes.forEach(
        (r, i) => (r.active = i === this.activeRouteIndex),
      );
      this._syncActiveRouteToEditor();
      this._renderSavedRoutes();
      this._updateRoutePanel();
      this._updateRouteSource();
    };
    stopBtn.onclick = () => {
      this.drawing = false;
      startBtn.disabled = false;
      stopBtn.disabled = true;
      // Finalize current editing route (save to savedRoutes)
      this._finalizeCurrentRoute();
      this._renderSavedRoutes();
      this._updateRoutePanel();
    };
    exportBtn.onclick = () => {
      // Export only the active route
      if (
        this.activeRouteIndex >= 0 &&
        this.activeRouteIndex < this.savedRoutes.length
      ) {
        this._exportSavedRoute(this.activeRouteIndex);
      } else {
        alert("No active route to export.");
      }
    };

    // --- Map click for drawing ---
    map.on("click", (e) => {
      if (!this.drawing) return;
      const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      this.addWaypoint(p);
    });

    // --- Source & layers ---
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

    // --- Context menu events ---
    map.on("contextmenu", "route-line", (e) => {
      e.preventDefault();
      this._showContextMenu("line", e);
    });
    map.on("contextmenu", "route-waypoints", (e) => {
      e.preventDefault();
      this._showContextMenu("waypoint", e);
    });

    this._updateRoutePanel();
    // Load predefined routes from /routes/
    this._loadPredefinedRoutes();
    return this.container;
  }

  addWaypoint(coord: [number, number]) {
    if (!this.map) return;
    // Always operate on the active route
    if (
      this.activeRouteIndex < 0 ||
      this.activeRouteIndex >= this.savedRoutes.length
    ) {
      // If no active route, create one
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
      this._syncActiveRouteToEditor();
      this._renderSavedRoutes();
    }
    // Add to editor state
    const map = this.map;
    const el = document.createElement("div");
    el.style.cssText =
      "width:15px;height:15px;background:#0077b6;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.18);cursor:pointer;transition:box-shadow .15s;";

    const marker = new maplibregl.Marker({
      element: el,
      draggable: true,
    })
      .setLngLat(coord)
      .addTo(map);

    this.waypoints.push(coord);
    this.waypointNames.push("");
    this.markers.push(marker);

    if (this.waypointNames[this.waypoints.length - 1]) {
      marker
        .getElement()
        .setAttribute("title", this.waypointNames[this.waypoints.length - 1]);
    }
    el.addEventListener("mouseenter", () => {
      el.style.boxShadow = "0 0 8px #003366";
      map.getCanvas().style.cursor = "move";
    });
    el.addEventListener("mouseleave", () => {
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.18)";
      map.getCanvas().style.cursor = "";
    });
    marker.on("drag", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource();
        this._updateRoutePanel();
      }
    });
    marker.on("dragend", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource();
        this._updateRoutePanel();
      }
    });
    el.addEventListener("contextmenu", (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
      this._showContextMenu("waypoint", {
        lngLat: marker.getLngLat(),
        originalEvent: evt,
      } as any);
    });
    this._updateRouteSource();
    this._updateRoutePanel();
  }

  private _updateRouteSource() {
    if (!this.map) return;
    // Only update the editor "route" source for the active route
    const features: any[] = [];
    for (const [i, p] of this.waypoints.entries()) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: p },
        properties: { name: this.waypointNames[i] || "" },
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
    // Update marker titles to match names
    for (let i = 0; i < this.markers.length; ++i) {
      this.markers[i]
        ?.getElement()
        .setAttribute("title", this.waypointNames[i] || "");
    }
  }

  private _updateRoutePanel() {
    if (!this.routePanel) return;
    // Set name input value if not focused
    const nameInput = this.routePanel.querySelector(
      "#route-name-input",
    ) as HTMLInputElement;
    if (document.activeElement !== nameInput) {
      nameInput.value = this.routeName;
    }
    // Waypoint table
    const listDiv = this.routePanel.querySelector(
      "#route-waypoint-list",
    ) as HTMLElement;
    if (!listDiv) return;
    if (this.waypoints.length === 0) {
      listDiv.innerHTML = `<div style="color:#888;font-style:italic;">No waypoints</div>`;
    } else {
      let html = `<table class="route-wp-table"><thead>
        <tr><th>#</th><th>Name</th><th>Lat/Lon</th><th>Bearing</th><th>Dist</th><th></th></tr>
      </thead><tbody>`;
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
          <td>
            <input class="wp-name-input" type="text" value="${name}" data-idx="${i}" style="width:80px;">
          </td>
          <td style="font-family:monospace;font-size:12px;">${formatLatLonForDisplay(lat, lon)}</td>
          <td style="text-align:center;">${bearing}</td>
          <td style="text-align:right;">${dist ? dist + " NM" : ""}</td>
          <td><button class="wp-delete-btn" title="Delete" data-idx="${i}" style="padding:2px 6px;">✖</button></td>
        </tr>`;
      }
      html += "</tbody></table>";
      listDiv.innerHTML = html;
      // Add input event for names
      listDiv.querySelectorAll(".wp-name-input").forEach((input) => {
        input.addEventListener("input", (e) => {
          const idx = parseInt((e.target as HTMLInputElement).dataset.idx!);
          this.waypointNames[idx] = (e.target as HTMLInputElement).value;
          this._updateRouteSource();
        });
      });
      // Add delete buttons
      listDiv.querySelectorAll(".wp-delete-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          const idx = parseInt((e.target as HTMLElement).dataset.idx!);
          this._deleteWaypoint(idx);
        });
      });
    }
    // Total distance
    const totDiv = this.routePanel.querySelector(
      "#route-total-length",
    ) as HTMLElement;
    let tot = 0;
    for (let i = 1; i < this.waypoints.length; ++i) {
      tot += haversineNm(this.waypoints[i - 1], this.waypoints[i]);
    }
    totDiv.textContent = `Total: ${tot.toFixed(2)} NM`;
    // Render saved routes list
    this._renderSavedRoutes();
  }

  private _calculateBearing(a: [number, number], b: [number, number]): string {
    // Returns bearing in degrees (true) as a string "123°"
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
    // Remove marker
    this.markers[idx]?.remove();
    this.waypoints.splice(idx, 1);
    this.waypointNames.splice(idx, 1);
    this.markers.splice(idx, 1);
    this._updateRouteSource();
    this._updateRoutePanel();
  }

  exportGpx() {
    // Deprecated: now handled by _exportSavedRoute
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      this._exportSavedRoute(this.activeRouteIndex);
    } else {
      alert("No active route to export.");
    }
  }

  private _escapeXml(s: string): string {
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

  // clearRoute() removed: no longer in toolbar

  onRemove() {
    // cleanup listeners if needed
    if (this.routePanel) {
      this.routePanel.remove();
    }
    // Remove all saved route layers
    if (this.map) {
      for (let i = 0; i < this.savedRoutes.length; ++i) {
        this._removeRouteLayers(i);
      }
    }
  }

  private _showContextMenu(
    type: "line" | "waypoint",
    e: maplibregl.MapMouseEvent,
  ) {
    if (!this.map) return;
    // Remove any existing context menu
    const existingMenu = document.getElementById("route-context-menu");
    if (existingMenu) {
      existingMenu.remove();
    }

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

    // Position menu at cursor
    const rect = this.map.getContainer().getBoundingClientRect();
    const left = e.originalEvent.clientX - rect.left;
    const top = e.originalEvent.clientY - rect.top;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    // Helper to create menu item
    const createMenuItem = (text: string, onClick: () => void) => {
      const item = document.createElement("div");
      item.textContent = text;
      item.style.padding = "7px 18px";
      item.style.cursor = "pointer";
      item.style.userSelect = "none";
      item.addEventListener("mouseenter", () => {
        item.style.background = "#e0efff";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = "transparent";
      });
      item.addEventListener("click", () => {
        onClick();
        menu.remove();
      });
      return item;
    };

    if (type === "line") {
      // Add "Add Waypoint" option
      const addWaypointItem = createMenuItem("Add Waypoint", () => {
        const coord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        this._addWaypointAtNearestSegment(coord);
      });
      menu.appendChild(addWaypointItem);
    } else if (type === "waypoint") {
      // Find nearest waypoint index to click location
      const clickCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      let nearestIndex = -1;
      let minDist = Infinity;
      for (let i = 0; i < this.waypoints.length; i++) {
        const wp = this.waypoints[i];
        const dist = Math.sqrt(
          (wp[0] - clickCoord[0]) ** 2 + (wp[1] - clickCoord[1]) ** 2,
        );
        if (dist < minDist) {
          minDist = dist;
          nearestIndex = i;
        }
      }
      if (nearestIndex === -1) return;

      // "Name Waypoint"
      const nameItem = createMenuItem("Name Waypoint", () => {
        const currentName = this.waypointNames[nearestIndex] || "";
        const newName = prompt("Enter waypoint name:", currentName);
        if (newName !== null) {
          this.waypointNames[nearestIndex] = newName;
          const marker = this.markers[nearestIndex];
          if (marker) {
            marker.getElement().setAttribute("title", newName);
          }
          this._updateRouteSource();
          this._updateRoutePanel();
        }
      });
      menu.appendChild(nameItem);

      // "Delete Waypoint"
      const deleteItem = createMenuItem("Delete Waypoint", () => {
        this._deleteWaypoint(nearestIndex);
      });
      menu.appendChild(deleteItem);
    }

    // Append menu to map container
    this.map.getContainer().appendChild(menu);

    // Remove menu on any click outside
    const onClickOutside = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        menu.remove();
        document.removeEventListener("click", onClickOutside);
      }
    };
    document.addEventListener("click", onClickOutside);
  }

  private _addWaypointAtNearestSegment(coord: [number, number]) {
    if (this.waypoints.length < 2) {
      // If less than 2 waypoints, just add at end
      this.addWaypoint(coord);
      return;
    }
    let minDist = Infinity;
    let insertIndex = 0;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const v = this.waypoints[i];
      const w = this.waypoints[i + 1];
      const dist = this._pointToSegmentDistance(coord, v, w);
      if (dist < minDist) {
        minDist = dist;
        insertIndex = i + 1;
      }
    }
    // Insert waypoint and empty name at insertIndex
    this.waypoints.splice(insertIndex, 0, coord);
    this.waypointNames.splice(insertIndex, 0, "");
    if (!this.map) return;
    // Create marker for new waypoint
    const map = this.map;
    const el = document.createElement("div");
    el.style.cssText =
      "width:15px;height:15px;background:#0077b6;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.18);cursor:pointer;";
    const marker = new maplibregl.Marker({
      element: el,
      draggable: true,
    })
      .setLngLat(coord)
      .addTo(map);
    // Add to markers array at insertIndex
    this.markers.splice(insertIndex, 0, marker);
    // Hover feedback
    el.addEventListener("mouseenter", () => {
      el.style.boxShadow = "0 0 8px #003366";
      map.getCanvas().style.cursor = "move";
    });
    el.addEventListener("mouseleave", () => {
      el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.18)";
      map.getCanvas().style.cursor = "";
    });
    // Drag behaviour (live update)
    marker.on("drag", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource();
        this._updateRoutePanel();
      }
    });
    marker.on("dragend", () => {
      const newPos = marker.getLngLat();
      const index = this.markers.indexOf(marker);
      if (index !== -1) {
        this.waypoints[index] = [newPos.lng, newPos.lat];
        this._updateRouteSource();
        this._updateRoutePanel();
      }
    });
    this._updateRouteSource();
    this._updateRoutePanel();
  }

  private _pointToSegmentDistance(
    p: [number, number],
    v: [number, number],
    w: [number, number],
  ): number {
    // Calculate perpendicular distance from point p to segment vw
    const [px, py] = p;
    const [vx, vy] = v;
    const [wx, wy] = w;
    const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
    if (l2 === 0)
      return Math.sqrt((px - vx) * (px - vx) + (py - vy) * (py - vy));
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projx = vx + t * (wx - vx);
    const projy = vy + t * (wy - vy);
    return Math.sqrt((px - projx) * (px - projx) + (py - projy) * (py - projy));
  }

  // Add new CSS for route management UI
  private _injectPanelCSS() {
    if (document.getElementById("route-panel-style")) return;
    const s = document.createElement("style");
    s.id = "route-panel-style";
    s.textContent = `
#route-panel {
  position: fixed;
  right: 0;
  top: 0;
  width: 350px;
  max-width: 95vw;
  height: 100%;
  background: #f7faff;
  border-left: 2px solid #b2cbe3;
  box-shadow: -3px 0 10px rgba(0,44,85,0.07);
  z-index: 11000;
  font-family: 'Segoe UI', 'Arial', sans-serif;
  color: #06365f;
  display: flex;
  flex-direction: column;
  transition: right 0.2s, width 0.2s;
}

#route-panel.collapsed {
  width: 48px !important;
  height: 48px !important;
  overflow: hidden;
}

#route-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 8px 15px;
  border-bottom: 1px solid #d7e6f3;
  background: #e3f1ff;
}

#route-panel.collapsed #route-panel-title, #route-panel.collapsed #route-panel-body, #route-panel.collapsed #route-name-header {
  display: none;
}
#route-panel.collapsed route-panel-header {
  background: none !important;
  border: none !important;
  }
#route-panel-toggle {
  background: #d7e6f3;
  border: none;
  border-radius: 5px;
  font-size: 16px;
  width: 28px;
  height: 28px;
  cursor: pointer;
  color: #06365f;
  font-weight: 700;
  transition: background 0.12s;
  position: absolute;
  top: 10px;
  right: 10px;
}

#route-panel.collapsed #route-panel-toggle {

}
#route-panel-body {
  padding: 12px 15px 12px 15px;
  overflow-y: auto;
  flex: 1 1 auto;
}
.route-wp-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
  margin-bottom: 12px;
}
.route-wp-table th, .route-wp-table td {
  border-bottom: 1px solid #e6ecf5;
  padding: 2px 5px;
  text-align: left;
}
.route-wp-table th {
  background: #f2f7fb;
  font-weight: 600;
  color: #074369;
  font-size: 12px;
}
.route-wp-table tr:last-child td {
  border-bottom: none;
}
.route-wp-table input[type="text"] {
  background: #f4faff;
  border: 1px solid #c6d6e7;
  border-radius: 3px;
  font-size: 13px;
  padding: 2px 4px;
  color: #044;
}
.route-wp-table .wp-delete-btn {
  background: #f8d7da;
  color: #a33;
  border: none;
  border-radius: 3px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.13s;
}
.route-wp-table .wp-delete-btn:hover {
  background: #e57373;
  color: #fff;
}
#route-total-length {
  font-size: 15px;
  color: #074369;
  margin-top: 10px;
}
/* Route management sidebar styles */
.route-item {
  background: #eaf3fc;
  margin-bottom: 7px;
  border-radius: 6px;
  padding: 7px 9px 7px 9px;
  cursor: pointer;
  border: 1px solid #d7e6f3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: background 0.1s, border 0.1s;
  position: relative;
}
.route-item.active {
  background: #cfe2fa;
  border-color: #88b1e7;
  font-weight: 600;
}
.route-item .route-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}
.route-item input[type=checkbox] {
  margin-right: 4px;
  accent-color: #0077b6;
}
.route-item-details {
  font-size: 12px;
  margin-top: 3px;
  color: #044;
  background: #f7fbff;
  border-radius: 4px;
  padding: 5px 7px 4px 25px;
  border-left: 2px solid #b2cbe3;
}
`;
    document.head.appendChild(s);
  }

  // --------- Route Management Implementation ---------

  // Load all .gpx files in /routes/ and add to savedRoutes
  private async _loadPredefinedRoutes() {
    try {
      // Try to get a file list from /routes/
      // We'll attempt to fetch /routes/index.json (generated by server or build step),
      // otherwise fallback to a fixed set or fail gracefully.
      let gpxFiles: string[] = [];
      try {
        const indexResp = await fetch("/routes/index.json");
        if (indexResp.ok) {
          gpxFiles = await indexResp.json();
        }
      } catch (e) {
        // fallback: try GET /routes/0.gpx, 1.gpx, ... up to 10
        gpxFiles = [];
        for (let i = 0; i < 10; ++i) {
          try {
            const testUrl = `/routes/${i}.gpx`;
            const resp = await fetch(testUrl, { method: "HEAD" });
            if (resp.ok) gpxFiles.push(`${i}.gpx`);
          } catch {
            // ignore
          }
        }
      }
      // If still empty, fallback to static demo
      if (gpxFiles.length === 0) {
        // Try to fetch /routes/route1.gpx, /routes/route2.gpx
        for (let i = 1; i <= 2; ++i) {
          try {
            const resp = await fetch(`/routes/route${i}.gpx`, {
              method: "HEAD",
            });
            if (resp.ok) gpxFiles.push(`route${i}.gpx`);
          } catch {}
        }
      }
      // For each GPX file found, fetch and parse
      for (const fname of gpxFiles) {
        try {
          const resp = await fetch(`/routes/${fname}`);
          if (!resp.ok) continue;
          const xml = await resp.text();
          const parsed = this._parseGpxToWaypoints(xml);
          if (parsed && parsed.waypoints.length > 0) {
            this.savedRoutes.push({
              name: parsed.name || fname.replace(/\.gpx$/i, ""),
              waypoints: parsed.waypoints,
              waypointNames: parsed.waypointNames,
              visible: false,
              active: false,
            });
          }
        } catch (e) {
          // ignore
        }
      }
      this._renderSavedRoutes();
    } catch (err) {
      // ignore
    }
  }

  // Parse GPX XML to waypoints and names
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
    // Try <rtept> first
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
      // Try <trkpt>
      const trkpts = Array.from(doc.getElementsByTagName("trkpt"));
      waypoints = trkpts.map((el) => [
        parseFloat(el.getAttribute("lon") || "0"),
        parseFloat(el.getAttribute("lat") || "0"),
      ]);
      waypointNames = trkpts.map(() => "");
    }
    // Try to get route name
    const nameElem = doc.querySelector("rte > name, trk > name, gpx > name");
    if (nameElem && nameElem.textContent) {
      name = nameElem.textContent;
    }
    return { name, waypoints, waypointNames };
  }

  // Render the saved routes list in sidebar
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
      // Show on Chart checkbox
      const visibleBox = document.createElement("input");
      visibleBox.type = "checkbox";
      visibleBox.checked = !!route.visible;
      visibleBox.title = "Show on Chart";
      visibleBox.onclick = (ev) => {
        ev.stopPropagation();
        this._toggleRouteVisibility(idx);
      };
      // Route name clickable
      const nameSpan = document.createElement("span");
      nameSpan.textContent = route.name;
      nameSpan.style.flex = "1";
      nameSpan.style.userSelect = "none";
      nameSpan.style.marginLeft = "5px";
      nameSpan.style.fontWeight = route.active ? "700" : "500";
      // Expand/collapse details
      let expanded = !!route.active;
      const detailsDiv = document.createElement("div");
      detailsDiv.className = "route-item-details";
      detailsDiv.style.display = expanded ? "block" : "none";
      detailsDiv.innerHTML = `
        Waypoints: ${route.waypoints.length}
        <br>Total: ${this._routeTotalDistance(route).toFixed(2)} NM
      `;
      nameSpan.onclick = (ev) => {
        ev.stopPropagation();
        expanded = !expanded;
        detailsDiv.style.display = expanded ? "block" : "none";
        this._setActiveRoute(idx);
      };
      // Actions: Export, Delete
      const actions = document.createElement("span");
      actions.className = "route-actions";
      // Export button
      const exportBtn = document.createElement("button");
      exportBtn.textContent = "Export";
      exportBtn.title = "Export GPX";
      exportBtn.onclick = (ev) => {
        ev.stopPropagation();
        this._exportSavedRoute(idx);
      };
      // Delete button
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
      // Clicking anywhere else on route item sets as active and expands
      div.onclick = () => {
        expanded = !expanded;
        detailsDiv.style.display = expanded ? "block" : "none";
        this._setActiveRoute(idx);
      };
      listDiv.appendChild(div);
    });
  }

  // Set one route as active, update editing state
  private _setActiveRoute(index: number) {
    if (index < 0 || index >= this.savedRoutes.length) return;
    this.savedRoutes.forEach((r, i) => (r.active = i === index));
    this.activeRouteIndex = index;
    this._syncActiveRouteToEditor();
    this._renderSavedRoutes();
    this._updateRoutePanel();
    this._updateRouteSource();
  }

  // Sync editor state to currently active route
  private _syncActiveRouteToEditor() {
    // Remove all markers
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (
      this.activeRouteIndex >= 0 &&
      this.activeRouteIndex < this.savedRoutes.length
    ) {
      const route = this.savedRoutes[this.activeRouteIndex];
      this.routeName = route.name;
      // Deep copy
      this.waypoints = route.waypoints.map((p) => [...p]);
      this.waypointNames = [...route.waypointNames];
      // Add markers for waypoints
      for (const coord of this.waypoints) {
        this.addWaypoint(coord);
      }
      // Remove duplicate points (since addWaypoint pushes)
      if (this.markers.length > this.waypoints.length) {
        this.markers.splice(this.waypoints.length).forEach((m) => m.remove());
      }
    } else {
      this.routeName = "";
      this.waypoints = [];
      this.waypointNames = [];
    }
  }

  // Toggle route line visibility on map
  private _toggleRouteVisibility(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    route.visible = !route.visible;
    if (route.visible) {
      this._addRouteLayers(index);
    } else {
      this._removeRouteLayers(index);
    }
    this._renderSavedRoutes();
  }

  // Add route line/point layers to map for this route
  private _addRouteLayers(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    // Remove old layers if any
    this._removeRouteLayers(index);
    const sourceId = `route-src-${index}`;
    const lineLayerId = `route-line-${index}`;
    const pointLayerId = `route-points-${index}`;
    // Add GeoJSON source
    const features: any[] = [];
    if (route.waypoints.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: route.waypoints },
        properties: {},
      });
    }
    for (let i = 0; i < route.waypoints.length; ++i) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: route.waypoints[i] },
        properties: { name: route.waypointNames[i] || "" },
      });
    }
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
  }

  // Remove route line/point layers from map
  private _removeRouteLayers(index: number) {
    if (!this.map) return;
    const route = this.savedRoutes[index];
    if (route.lineLayerId && this.map.getLayer(route.lineLayerId)) {
      this.map.removeLayer(route.lineLayerId);
    }
    if (route.pointLayerId && this.map.getLayer(route.pointLayerId)) {
      this.map.removeLayer(route.pointLayerId);
    }
    if (route.sourceId && this.map.getSource(route.sourceId)) {
      this.map.removeSource(route.sourceId);
    }
    route.lineLayerId = undefined;
    route.pointLayerId = undefined;
    route.sourceId = undefined;
  }

  // Delete a saved route and its map layers
  private _deleteSavedRoute(index: number) {
    if (!this.map) return;
    this._removeRouteLayers(index);
    this.savedRoutes.splice(index, 1);
    // If deleted route was active, select another or clear
    if (this.activeRouteIndex === index) {
      if (this.savedRoutes.length > 0) {
        this.activeRouteIndex = 0;
        this.savedRoutes.forEach((r, i) => (r.active = i === 0));
        this._syncActiveRouteToEditor();
      } else {
        this.activeRouteIndex = -1;
        this.routeName = "";
        this.waypoints = [];
        this.waypointNames = [];
        for (const m of this.markers) m.remove();
        this.markers = [];
      }
    } else if (this.activeRouteIndex > index) {
      this.activeRouteIndex--;
    }
    this._renderSavedRoutes();
    this._updateRoutePanel();
    this._updateRouteSource();
  }

  // Export a saved route to GPX
  private _exportSavedRoute(index: number) {
    const route = this.savedRoutes[index];
    if (!route || route.waypoints.length === 0) {
      alert("No waypoints to export.");
      return;
    }
    // Build GPX with named waypoints and track
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

  // Finalize the current editing route and save to savedRoutes
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
      // Add layers if visible
      if (this.savedRoutes[this.activeRouteIndex].visible) {
        this._addRouteLayers(this.activeRouteIndex);
      }
    }
  }

  private _routeTotalDistance(route: { waypoints: [number, number][] }) {
    let tot = 0;
    for (let i = 1; i < route.waypoints.length; ++i) {
      tot += haversineNm(route.waypoints[i - 1], route.waypoints[i]);
    }
    return tot;
  }
}

// Wait until map has finished loading to add custom controls
map.on("load", () => {
  // Add working controls
  map.addControl(new CursorCoordControl(), "bottom-left");
  map.addControl(new MeasureControl(), "bottom-left");
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
