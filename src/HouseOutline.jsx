import { GeoJSON } from "react-leaflet";

// Highlights the real outline of the house or building, when OpenStreetMap has one.
export default function HouseOutline({ geojson }) {
    if (!geojson) return null;
    return (
        <GeoJSON
            // GeoJSON layers don't update when `data` changes, so a new key forces a redraw.
            key={JSON.stringify(geojson).slice(0, 200)}
            data={geojson}
            interactive={false}
            style={{ color: "#0F766E", weight: 3, fillColor: "#0F766E", fillOpacity: 0.25 }}
        />
    );
}