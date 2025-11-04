# bluECS

> Lightweight planning plotter for measuring distances, creating exportable gpx routes, and interrogating chart features. Displays unencrypted S57 ENCs after conversion, using a stripped down version of the S52 library (4.0).

- [bluECS](./src/) - Configured index.ts to include WPT drawing, moving, route storing and measure tools.

> Includes bkeepers tools to produce vector tiles (mbtiles, pmtiles) from Electronic Navigational Charts (ENCs)

- [styles](./packages/styles/) - MapLibre styles for S-57 Nautical Charts using IHO's S-52 Presentation Library
- [s52](./packages/s52/) - The S-52 Presentation Library in JSON format
- [dai](./packages/dai/) - Parser for S-52 .dai file

# Contributing

```sh
$ git clone https://github.com/jdsails/rya_bluECS.git
$ cd rya_bluECS
$ bin/setup
$ npm start
```

Open [http://localhost:5173](http://localhost:5173) in your browser to view the training chart with ENC tiles. The chart is centered and constrained.

## Chart Conversion

Run commands in makefile on your chart zip. This will create pmtiles. You may need to change tybe MBT to MBTiles.

## Deployment

Ensure .env configured with correct bucket for your .pmtiles.

```sh
$ vite build
```

Project will be in dist file. You may need to edit vite.config.js

## Prior Art

- https://github.com/LarsSchy/SMAC-M
- https://github.com/manimaul/njord
- https://github.com/bkeepers/enc-tiles

## Demo

- https://www.james-davies.co.uk/bluECS.html

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
