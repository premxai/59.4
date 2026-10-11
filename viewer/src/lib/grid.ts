// Parts of Texas that are NOT on the ERCOT grid. Their lights must not rotate with rolling
// outages and must not go dark when ERCOT collapses.
//
// APPROXIMATION (rough lon/lat boxes, not utility service-territory polygons):
//   - El Paso, west of -104.5° lon: El Paso Electric, Western Interconnection (WECC)
//   - Panhandle, north of 34.3° lat: Southwestern Public Service (SPS), Southwest Power Pool (SPP)
//   - South Plains / Lubbock, 33.0–34.3° lat, west of -101.0° lon: SPS and Lubbock Power & Light,
//     in SPP until Lubbock's partial move into ERCOT in June 2021, so off-grid for the 2011 and
//     Feb 2021 storms
//   - Beaumont / Port Arthur, east of -94.95° lon, south of 31.3° lat: Entergy Texas (MISO)
//   - Northeast corner, east of -95.0° lon, 32.25–33.9° lat (Longview, Marshall, Texarkana):
//     SWEPCO (SPP)
// Edges are blurred on screen. A HIFLD/ERCOT service-area outline would be the exact version.

export interface Box {
  name: string;
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

export const NON_ERCOT_BOXES: Box[] = [
  { name: "El Paso (El Paso Electric, WECC)", lonMin: -107.5, lonMax: -104.5, latMin: 28.5, latMax: 32.2 },
  { name: "Panhandle (SPS, SPP)", lonMin: -103.2, lonMax: -99.95, latMin: 34.3, latMax: 36.8 },
  { name: "South Plains / Lubbock (SPS + LP&L, SPP)", lonMin: -103.2, lonMax: -101.0, latMin: 33.0, latMax: 34.3 },
  { name: "Beaumont / Port Arthur (Entergy Texas, MISO)", lonMin: -94.95, lonMax: -93.3, latMin: 29.3, latMax: 31.3 },
  { name: "Northeast corner (SWEPCO, SPP)", lonMin: -95.0, lonMax: -93.3, latMin: 32.25, latMax: 33.9 },
];

export function isNonErcot(lon: number, lat: number): boolean {
  return NON_ERCOT_BOXES.some((b) => lon >= b.lonMin && lon <= b.lonMax && lat >= b.latMin && lat <= b.latMax);
}
