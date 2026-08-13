/* ============================================================
   jarvis_data.js — THE ONLY FILE YOU TOUCH DAY TO DAY.
   Claude wrote dashboard.html; this is your data.

   ⚠️  EVERY NUMBER BELOW IS SAMPLE DATA. It is here so the
   dashboard renders before any connector is wired up. Replace
   it with your real figures, or let the daily routine
   (claude/routines/daily-brief.md) regenerate this whole file
   each morning from your live connectors.
   ============================================================ */

window.JARVIS_DATA = {

  /* Spoken/displayed greeting at top-left. */
  greeting: "Good morning. Three things need you today; the rest is handled.",

  /* When this brief was built. Free text — shown under the greeting. */
  generated: "3 August 2026, 07:10",

  /* Currency symbol used for the money figures + the payment chip. */
  currency: "₪",

  /* Language for the mic (Web Speech API). "he-IL" for Hebrew,
     "en-GB" for English. */
  lang: "en-GB",

  /* Top-right connector board.
     status: "online" → steady green dot
             anything else → blinking amber dot
     Keep this list honest — it's your at-a-glance health check. */
  connectors: [
    { name: "Gmail",       status: "online"  },
    { name: "Calendar",    status: "online"  },
    { name: "GitHub",      status: "online"  },
    { name: "Metricool",   status: "online"  },
    { name: "RevenueCat",  status: "offline" },
    { name: "Meta Ads",    status: "offline" }
  ],

  /* Right-hand stats panel. Ordered top → bottom; bar widths are
     scaled against the largest value, so any units work. */
  content: {
    funnel: [
      { label: "Impressions",   value: 128400 },
      { label: "Profile views", value: 9120  },
      { label: "Link clicks",   value: 2340  },
      { label: "Sign-ups",      value: 412   },
      { label: "Orders",        value: 96    }
    ]
  },

  /* Sponsor / invoice ledger.
     amount is a plain number (no symbol — `currency` supplies that).
     status "paid" counts toward Collected; anything else counts
     toward Outstanding and raises the amber PAYMENT DUE chip. */
  sponsors: [
    { name: "Autumn campaign", amount: 12500, status: "paid" },
    { name: "Retainer — Q3",   amount: 8000,  status: "paid" },
    { name: "Launch bundle",   amount: 4200,  status: "due", due: "overdue 6 days" },
    { name: "Newsletter slot", amount: 1800,  status: "due", due: "due 12 Aug" }
  ],

  /* The queue. Drives the ticker, the Priorities figure, and the
     activity log. Keep them short — they scroll. */
  priorities: [
    "Chase the Launch bundle invoice — 6 days overdue",
    "Reply to the 4 support emails flagged needs-a-reply",
    "Approve the back-end PR Tom reviewed overnight"
  ],

  /* Lead line of the ticker. */
  headline: "Orders up 18% week over week; support backlog down to four.",

  /* Signs off the ticker. */
  closer: "Nothing else needs you before this afternoon.",

  /* Sent to /ask when you press WHAT SHOULD I HANDLE FIRST.
     Optional — there's a sensible default in dashboard.html. */
  firstQuestion:
    "Looking at my priorities for today, what should I handle first and why? Two sentences.",

  /* OPTIONAL OVERRIDES — delete to use the auto-generated versions.

     figures: the big numbers across the bottom. Omit and the
       dashboard derives them from funnel + sponsors.
     activity: the streaming log down the left. Omit and it is
       synthesised from your connectors and ledger.

  figures: [
    { key: "Orders",      value: "96"     },
    { key: "Collected",   value: "₪20.5K" },
    { key: "Outstanding", value: "₪6K"    }
  ],

  activity: [
    "Gmail connector handshake OK",
    "17 unread triaged — 4 need a reply",
    "Awaiting instruction"
  ]
  */
};
