import { lazy, Suspense } from "react";
import DeliveryAddressMap from "./DeliveryAddressMap";

// Loaded only when needed, so the address page still works before Supabase is set up.
const AuthGate = lazy(() => import("./AuthGate"));
const ConfirmDelivery = lazy(() => import("./ConfirmDelivery"));
const DriverTracker = lazy(() => import("./DriverTracker"));
const TrackDelivery = lazy(() => import("./TrackDelivery"));

const loading = <p className="p-6 text-sm">Loading…</p>;

// Pages:
//   /                                  customer enters an address
//   /?mode=confirm                     signs the customer in and creates the delivery
//   /?mode=track&delivery=<id>         customer watches the driver
//   /?mode=driver&delivery=<id>        driver shares location
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode");
  const deliveryId = params.get("delivery");

  if (mode === "confirm") {
    return (
      <Suspense fallback={loading}>
        <AuthGate>{(session) => <ConfirmDelivery session={session} />}</AuthGate>
      </Suspense>
    );
  }

  if ((mode === "driver" || mode === "track") && deliveryId) {
    const Page = mode === "driver" ? DriverTracker : TrackDelivery;
    return (
      <Suspense fallback={loading}>
        <AuthGate>{() => <Page deliveryId={deliveryId} />}</AuthGate>
      </Suspense>
    );
  }

  return <DeliveryAddressMap />;
}
