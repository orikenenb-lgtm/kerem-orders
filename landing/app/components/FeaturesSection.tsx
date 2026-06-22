"use client";

import { motion, useInView } from "framer-motion";
import { useRef, type ReactNode } from "react";

const ACCENT = "#8A3FFC";

// rainbow accents cycle in this exact order
const RAINBOW = ["#FF2E93", "#FF8A00", "#FFC400", "#25C77E", "#2E7DFF", "#8A3FFC"];

type Feature = {
  title: string;
  body: string;
  icon: ReactNode;
};

const iconProps = (stroke: string) => ({
  width: 28,
  height: 28,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke,
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

const FEATURES: Feature[] = [
  {
    title: "מבחר ענק",
    body: "אלפי פריטים בקטלוג, מתחדש כל שבוע.",
    icon: (
      <svg {...iconProps(RAINBOW[0])}>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    title: "יבוא ישיר",
    body: "מביאים מהיצרן ישירות אליכם, בלי מתווכים באמצע.",
    icon: (
      <svg {...iconProps(RAINBOW[1])}>
        <path d="M2 13h13V6H2zM15 8h4l3 3v2h-7z" />
        <circle cx="6" cy="18" r="2" />
        <circle cx="18" cy="18" r="2" />
      </svg>
    ),
  },
  {
    title: "מחירי סיטונאות",
    body: "מחירים שמשאירים לכם רווח אמיתי על כל מכירה.",
    icon: (
      <svg {...iconProps(RAINBOW[2])}>
        <path d="M20.6 13.4 11 23l-8-8 9.6-9.6A2 2 0 0 1 14 4.8L20 5l.3 6a2 2 0 0 1 .3 2.4Z" />
        <circle cx="16.5" cy="8.5" r="1" />
      </svg>
    ),
  },
  {
    title: "איכות ובטיחות",
    body: "כל צעצוע עומד בתקן הישראלי והאירופי.",
    icon: (
      <svg {...iconProps(RAINBOW[3])}>
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    title: "אספקה מהירה",
    body: "הזמנתם היום? המשלוח כבר בדרך לחנות.",
    icon: (
      <svg {...iconProps(RAINBOW[4])}>
        <path d="M13 2 3 14h7l-1 8 10-12h-7z" />
      </svg>
    ),
  },
  {
    title: "שירות אישי",
    body: "איש קשר אחד שמכיר את החנות שלכם ואת מה שמוכר.",
    icon: (
      <svg {...iconProps(RAINBOW[5])}>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.5-6 8-6s8 2 8 6" />
      </svg>
    ),
  },
];

export default function FeaturesSection() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: 0.1 } },
  };
  const item = {
    hidden: { opacity: 0, y: 24 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, ease: [0.25, 0, 0, 1] },
    },
  } as const;

  return (
    <section
      ref={ref}
      style={{
        background: "#fff",
        padding: "clamp(4rem, 10vw, 8rem) clamp(1.5rem, 6vw, 6rem)",
        maxWidth: 1280,
        margin: "0 auto",
      }}
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
      >
        <motion.span
          variants={item}
          style={{
            display: "block",
            fontFamily: "var(--font-rubik)",
            fontSize: "0.72rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: ACCENT,
            fontWeight: 600,
            marginBottom: "1rem",
          }}
        >
          למה כרם טויס
        </motion.span>

        <motion.h2
          variants={item}
          style={{
            fontFamily: "var(--font-rubik)",
            fontWeight: 800,
            fontSize: "clamp(2rem, 4vw, 3.5rem)",
            color: "#1A1730",
            lineHeight: 1.1,
            marginBottom: "clamp(2.5rem, 5vw, 4rem)",
            maxWidth: 720,
          }}
        >
          הכול בשביל שהמדפים שלכם יימכרו.
        </motion.h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "1.5rem",
          }}
        >
          {FEATURES.map((f, i) => {
            const accent = RAINBOW[i % RAINBOW.length];
            return (
              <motion.div
                key={f.title}
                variants={item}
                style={{
                  background: "#fff",
                  borderRadius: 20,
                  borderTop: `3px solid ${accent}`,
                  border: "1px solid rgba(26,23,48,0.08)",
                  borderTopWidth: 3,
                  borderTopColor: accent,
                  padding: "2rem",
                  boxShadow: "0 12px 40px rgba(26,23,48,0.06)",
                }}
              >
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${accent}14`,
                    marginBottom: "1.25rem",
                  }}
                >
                  {f.icon}
                </div>
                <h3
                  style={{
                    fontFamily: "var(--font-rubik)",
                    fontWeight: 700,
                    fontSize: "1.3rem",
                    color: "#1A1730",
                    marginBottom: "0.6rem",
                  }}
                >
                  {f.title}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--font-assistant)",
                    fontWeight: 400,
                    fontSize: "1rem",
                    color: "#4B4860",
                    lineHeight: 1.6,
                  }}
                >
                  {f.body}
                </p>
              </motion.div>
            );
          })}
        </div>
      </motion.div>
    </section>
  );
}
