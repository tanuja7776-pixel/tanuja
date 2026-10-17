
const rad = (d) => (d * Math.PI) / 180;

// Straight-line distance between two { lat, lng } points, in metres.
export function distanceMeters(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Direction of travel from a to b, in degrees clockwise from north.
export function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x =
        Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
        Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function compassName(degrees) {
    return COMPASS[Math.round(degrees / 45) % 8];
}

// Finds the point of a route ([[lat, lng], ...]) closest to the given position.
// Returns its index and how far away it is in metres.
export function nearestPointIndex(points, lat, lng) {
    let best = 0;
    let bestScore = Infinity;
    const lngScale = Math.cos(rad(lat));
    for (let i = 0; i < points.length; i++) {
        const dLat = points[i][0] - lat;
        const dLng = (points[i][1] - lng) * lngScale;
        const score = dLat * dLat + dLng * dLng;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }
    const distM = points.length
        ? distanceMeters({ lat, lng }, { lat: points[best][0], lng: points[best][1] })
        : Infinity;
    return { index: best, distM };
}
