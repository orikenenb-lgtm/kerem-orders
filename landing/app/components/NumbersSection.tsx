"use client";

import { motion, useInView } from "framer-motion";
import { useRef } from "react";

const ACCENT = "#8A3FFC";

// PLACEHOLDER NUMBERS — labels stay, the user will swap real values.
const ROWS: [string, string][] = [
  ["שנות פעילות", "15+"],
  ["מותגים בקטלוג", "40+"],
  ["פריטים במלאי", "5,000+"],
  ["חנויות לקוחות", "600+"],
  ["זמן אספקה ממוצע", "24–48 שעות"],
  ["כיסוי הפצה", "כל הארץ"],
  ["מינימום הזמנה", "גמיש"],
  ["תנאי תשלום", "שוטף +30"],
];

export default function NumbersSection() {
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
        background: "#F7F7FB",
        padding: "clamp(4rem, 10vw, 8rem) clamp(1.5rem, 6vw, 6rem)",
      }}
    >
      <motion.div
        variants={container}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        style={{ maxWidth: 1100, margin: "0 auto" }}
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
          המספרים שלנו
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
          }}
        >
          מה שעומד מאחורי כרם טויס.
        </motion.h2>

        <div>
          {ROWS.map(([label, value]) => (
            <motion.div
              key={label}
              variants={item}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1.5rem",
                padding: "1.25rem 0",
                borderBottom: "1px solid rgba(26,23,48,0.08)",
              }}
            >
              {/* RTL: label on the right, value on the left */}
              <span
                style={{
                  fontFamily: "var(--font-rubik)",
                  fontWeight: 600,
                  fontSize: "clamp(1rem, 1.6vw, 1.25rem)",
                  color: ACCENT,
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-rubik)",
                  fontWeight: 800,
                  fontSize: "clamp(1.25rem, 2.4vw, 2rem)",
                  color: "#1A1730",
                  textAlign: "left",
                }}
              >
                {value}
              </span>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
