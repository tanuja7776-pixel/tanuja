import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

// Shows a sign-in form until the person is logged in, then renders
// children(session). Uses an emailed magic link, so there are no passwords to store.
export default function AuthGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  async function sendLink(e) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    if (error) setError(error.message);
    else setSent(true);
  }

  if (session === undefined) {
    return <p className="p-6 text-sm">Checking sign-in…</p>;
  }

  if (session) return children(session);

  return (
    <section className="grid min-h-screen place-items-center bg-paper px-4 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Sign in to continue</h1>
        {sent ? (
          <p className="mt-3 text-sm text-ink/70" role="status">
            Check your email and open the link we sent to {email}. It will bring you back to this page.
          </p>
        ) : (
          <form onSubmit={sendLink} className="mt-4">
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-ink/15 px-4 py-3 text-sm focus:border-pine focus:outline-2 focus:outline-pine/30"
            />
            <button
              type="submit"
              className="mt-3 w-full rounded-xl bg-pine px-4 py-3 text-sm font-medium text-white hover:bg-pine/90"
            >
              Email me a sign-in link
            </button>
            {error && (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
