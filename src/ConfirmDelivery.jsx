import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";

// Runs after the customer presses "Deliver to this address" and has signed in.
// Reads the address saved by the address page, creates the delivery, then
// sends the customer to their tracking page.
export default function ConfirmDelivery({ session }) {
  const [message, setMessage] = useState("Placing your delivery…");
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React StrictMode runs effects twice in development
    ran.current = true;

    (async () => {
      let pending = null;
      try {
        pending = JSON.parse(localStorage.getItem("pendingDelivery"));
      } catch {
        // fall through to the "no address" message
      }

      if (!pending) {
        setMessage("We don’t have an address to deliver to. Go back and search for one.");
        setFailed(true);
        return;
      }

      // The database also enforces customer_id = the signed-in user, so this can't be faked.
      const { data, error } = await supabase
        .from("deliveries")
        .insert({
          customer_id: session.user.id,
          address: pending.address,
          dest_lat: pending.lat,
          dest_lng: pending.lon,
          dest_geojson: pending.geojson ?? null,
        })
        .select("id")
        .single();

      if (error) {
        setMessage("We couldn’t place the delivery. Refresh this page to try again.");
        setFailed(true);
        return;
      }

      localStorage.removeItem("pendingDelivery");
      window.location.replace(`/?mode=track&delivery=${data.id}`);
    })();
  }, [session]);

  return (
    <section className="grid min-h-screen place-items-center bg-paper px-4 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-6 text-center shadow-sm">
        <p className="text-sm" role={failed ? "alert" : "status"}>
          {message}
        </p>
        {failed && (
          <a href="/" className="mt-4 inline-block text-sm font-medium text-pine underline-offset-2 hover:underline">
            Back to the address page
          </a>
        )}
      </div>
    </section>
  );
}
