declare module "maplibre-gl-measures" {
  import { Map as MapLibreMap, IControl } from "maplibre-gl";

  export default class MeasuresControl implements IControl {
    constructor(options?: Record<string, any>);
    onAdd(map: MapLibreMap): HTMLElement;
    onRemove(): void;
  }
}
