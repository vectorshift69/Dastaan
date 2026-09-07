"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Quote = {
  id: string;
  quote: string;
  author: string | null;
  active: boolean;
  created_at: string;
};

type Suggestion = { quote: string; author: string };

/* ------------------------------------------------------------------ */
/* Add Quote Form                                                      */
/* ------------------------------------------------------------------ */

function AddQuoteForm({ onAdded }: { onAdded: () => void }) {
  const [quoteText, setQuoteText] = useState("");
  const [author, setAuthor] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadSuggestions() {
    if (suggestions.length > 0) { setShowSuggestions(true); return; }
    fetch("/api/admin/quotes/suggestions")
      .then((r) => r.json())
      .then((data: Suggestion[]) => { setSuggestions(data); setShowSuggestions(true); })
      .catch(() => {});
  }

  function pickSuggestion(s: Suggestion) {
    setQuoteText(s.quote);
    setAuthor(s.author);
    setShowSuggestions(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/quotes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quote: quoteText, author: author || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Failed to add quote"); return; }
      setQuoteText(""); setAuthor("");
      onAdded();
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ivory/10 bg-coal p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg text-ivory">Add a quote</h2>
        <button
          type="button"
          onClick={loadSuggestions}
          className="rounded-lg border border-gold/30 px-3 py-1.5 text-xs text-gold/80 transition hover:bg-gold/10"
        >
          ✦ Suggest quotes
        </button>
      </div>

      {/* Suggestions panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="mb-4 space-y-2 rounded-xl border border-ivory/10 bg-ink p-3">
          <p className="mb-2 text-xs text-ivory/40">Click any quote to use it:</p>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="w-full rounded-lg p-3 text-left text-xs transition hover:bg-ivory/5"
            >
              <span className="text-ivory/80">&ldquo;{s.quote}&rdquo;</span>
              <span className="ml-2 text-ivory/40">— {s.author}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowSuggestions(false)}
            className="mt-1 text-xs text-ivory/30 hover:text-ivory/60"
          >
            Close
          </button>
        </div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs text-ivory/50">Quote</label>
          <textarea
            value={quoteText}
            onChange={(e) => setQuoteText(e.target.value)}
            required
            rows={3}
            placeholder="Enter a motivational quote…"
            className="w-full resize-none rounded-xl border border-ivory/15 bg-ink px-4 py-2.5 text-sm text-ivory placeholder-ivory/25 focus:border-gold/50 focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-ivory/50">Author (optional)</label>
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="e.g. Mark Twain"
            className="w-full rounded-xl border border-ivory/15 bg-ink px-4 py-2.5 text-sm text-ivory placeholder-ivory/25 focus:border-gold/50 focus:outline-none"
          />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="rounded-xl bg-gold px-6 py-2.5 text-sm font-medium text-ink transition hover:bg-gold-2 disabled:opacity-50"
        >
          {submitting ? "Adding…" : "Add quote"}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Quote card                                                          */
/* ------------------------------------------------------------------ */

function QuoteCard({ quote, onToggle }: { quote: Quote; onToggle: () => void }) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    setToggling(true);
    await fetch(`/api/admin/quotes/${quote.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !quote.active }),
    }).catch(() => {});
    setToggling(false);
    onToggle();
  }

  return (
    <div className={`rounded-2xl border p-5 transition ${quote.active ? "border-ivory/10 bg-coal" : "border-ivory/6 bg-coal/40 opacity-50"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm leading-relaxed text-ivory/90">&ldquo;{quote.quote}&rdquo;</p>
          {quote.author && (
            <p className="mt-1 text-xs text-ivory/40">— {quote.author}</p>
          )}
        </div>
        <button
          onClick={toggle}
          disabled={toggling}
          className={`flex-shrink-0 rounded-lg px-3 py-1.5 text-xs transition ${
            quote.active
              ? "border border-ivory/15 text-ivory/50 hover:border-red-800/50 hover:text-red-400"
              : "border border-green-800/40 text-green-500/70 hover:bg-green-900/20"
          }`}
        >
          {quote.active ? "Disable" : "Enable"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function AdminQuotesPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((me) => {
        if (!me || !["admin", "super_admin"].includes(me.role)) {
          router.replace("/login?returnTo=/admin/quotes");
        }
      })
      .catch(() => router.replace("/login?returnTo=/admin/quotes"));
  }, [router]);

  function loadQuotes() {
    setLoading(true);
    fetch("/api/admin/quotes")
      .then((r) => r.json())
      .then(setQuotes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadQuotes(); }, []);

  const active = quotes.filter((q) => q.active);
  const inactive = quotes.filter((q) => !q.active);

  return (
    <div className="min-h-svh bg-ink px-6 py-10 text-ivory">
      <div className="mx-auto max-w-3xl space-y-8">
        <div>
          <button
            onClick={() => router.push("/admin")}
            className="mb-4 text-xs text-ivory/40 transition hover:text-ivory/70"
          >
            ← Admin
          </button>
          <h1 className="font-display text-3xl font-medium">Motivational quotes</h1>
          <p className="mt-1 text-sm text-ivory/50">
            Staff see one random quote as a 15-second popup each time they log in.
            Active quotes are picked randomly; disabled ones are never shown.
          </p>
        </div>

        <AddQuoteForm onAdded={loadQuotes} />

        {loading ? (
          <p className="text-sm text-ivory/40">Loading…</p>
        ) : (
          <>
            {active.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-ivory/40 uppercase tracking-widest">
                  Active ({active.length})
                </p>
                {active.map((q) => (
                  <QuoteCard key={q.id} quote={q} onToggle={loadQuotes} />
                ))}
              </div>
            )}
            {inactive.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs text-ivory/40 uppercase tracking-widest">
                  Disabled ({inactive.length})
                </p>
                {inactive.map((q) => (
                  <QuoteCard key={q.id} quote={q} onToggle={loadQuotes} />
                ))}
              </div>
            )}
            {quotes.length === 0 && (
              <p className="text-sm text-ivory/40">No quotes added yet.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
