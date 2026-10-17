
import { nearestPointIndex } from "./Geo";

// Road routing lives in this one file, so changing provider later means
// changing only getRoute().
//
// NOTE: router.project-osrm.org is a free public demo server. Its rules limit it
// to reasonable, non-commercial use (max 1 request per second, no uptime
// guarantee), and it does NOT include live traffic. Fine for building and
// testing. For a real business, use a paid routing API or host your own OSRM.
const OSRM_URL = "https://router.project-osrm.org/route/v1/driving";

// Turns one OSRM maneuver into a short sentence a driver can read at a glance.
function describeStep(step) {
    const { type, modifier, exit } = step.maneuver;
    const road = step.name ? ` onto ${step.name}` : "";
    const side = modifier ? modifier.replace("uturn", "U-turn") : "";

    switch (type) {
        case "depart":
            return step.name ? `Start on ${step.name}` : "Start driving";
        case "arrive":
            return modifier === "left" || modifier === "right"
                ? `Arrive. The address is on your ${modifier}`
                : "You have arrived";
        case "turn":
            if (modifier === "straight") return `Continue straight${road}`;
            if (modifier === "uturn") return "Make a U-turn";
            return `Turn ${side}${road}`;
        case "end of road":
            return `At the end of the road, turn ${side}${road}`;
        case "fork":
            return `Keep ${side} at the fork${road}`;
        case "merge":
            return `Merge ${side}${road}`;
        case "on ramp":
        case "off ramp":
            return `Take the ramp ${side}${road}`;
        case "roundabout":
        case "rotary":
            return exit ? `At the roundabout, take exit ${exit}${road}` : `Enter the roundabout${road}`;
        case "roundabout turn":
            return `At the roundabout, turn ${side}${road}`;
        default:
            return `Continue${road}`;
    }
}

// Returns { points, distanceM, durationS, steps } for the road route from -> to.
//   points: [[lat, lng], ...] along the road
//   steps:  one entry per maneuver: { text, type, modifier, distanceM, location: [lat, lng], pointIndex }
export async function getRoute(from, to, signal) {
    const url = `${OSRM_URL}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Route lookup failed with status ${res.status}`);

    const data = await res.json();
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) throw new Error("No route found");

    // GeoJSON is [lng, lat]; Leaflet wants [lat, lng].
    const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    const steps = route.legs[0].steps.map((s) => {
        const [lng, lat] = s.maneuver.location;
        return {
            text: describeStep(s),
            type: s.maneuver.type,
            modifier: s.maneuver.modifier ?? null,
            distanceM: s.distance,
            location: [lat, lng],
            pointIndex: nearestPointIndex(points, lat, lng).index,
        };
    });

    return { points, distanceM: route.distance, durationS: route.duration, steps };
}

// The next maneuver still ahead of the driver. `aheadIndex` is the driver's
// position along route.points. Falls back to the final "arrive" step.
export function nextManeuver(route, aheadIndex) {
    const steps = route.steps;
    return steps.find((s, i) => i > 0 && s.pointIndex > aheadIndex) ?? steps[steps.length - 1] ?? null;
}

export function formatDuration(seconds) {
    const mins = Math.max(1, Math.round(seconds / 60));
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    const rest = mins % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function formatDistance(meters) {
    return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}