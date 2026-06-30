"use client";

import { motion, useInView } from "framer-motion";
import { useRef, useState } from "react";

const ACCENT = "#8A3FFC";
const RAINBOW =
  "linear-gradient(90deg, #FF2E93, #FF8A00, #FFC400, #25C77E, #2E7DFF, #8A3FFC)";
// המערכת החיה (Kerem Orders) — דף הנחיתה מוביל אליה.
const APP_URL = "https://kerem-orders-production-142c.up.railway.app";

export default function ClosingCTA() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const [hover, setHover] = useState(false);

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
      id="cta"
      ref={ref}
      style={{
        background: "#fff",
        padding: "clamp(5rem, 12vw, 10rem) clamp(1.5rem, 6vw, 6rem)",
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* radial glow behind the button */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          bottom: "8%",
          width: "min(900px, 90vw)",
          height: 500,
          transform: "translateX(-50%)",
          background:
            "radial-gradient(ellipse, rgba(138,63,252,0.12) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        style={{
          maxWidth: 760,
          margin: "0 auto",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <motion.span
          variants={item}
          style={{
            fontFamily: "var(--font-rubik)",
            fontSize: "0.72rem",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: ACCENT,
            fontWeight: 600,
            marginBottom: "1.25rem",
          }}
        >
          בואו נתחיל
        </motion.span>

        <motion.h2
          variants={item}
          style={{
            fontFamily: "var(--font-rubik)",
            fontWeight: 800,
            fontSize: "clamp(2.2rem, 5vw, 4.5rem)",
            lineHeight: 1.08,
            color: "#1A1730",
            marginBottom: "1.5rem",
          }}
        >
          חמש-עשרה שנה של צעצועים.
          <br />
          <span style={{ fontWeight: 500, color: "#4B4860" }}>
            מחכים שתמלאו את החנות.
          </span>
        </motion.h2>

        <motion.p
          variants={item}
          style={{
            fontFamily: "var(--font-assistant)",
            fontWeight: 400,
            fontSize: "clamp(1rem, 1.4vw, 1.2rem)",
            color: "#4B4860",
            maxWidth: 480,
            lineHeight: 1.6,
            marginBottom: "2.5rem",
          }}
        >
          פתחו חשבון סיטונאי והתחילו לקבל את הצעצועים שילדים מבקשים — במחירים
          שמשאירים לכם רווח.
        </motion.p>

        <motion.a
          variants={item}
          href={`${APP_URL}/signup`}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          whileHover={{ scale: 1.04 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          style={{
            position: "relative",
            display: "inline-block",
            fontFamily: "var(--font-rubik)",
            fontWeight: 600,
            fontSize: "0.85rem",
            letterSpacing: "0.1em",
            textDecoration: "none",
            padding: "1rem 2.8rem",
            borderRadius: 999,
            // rainbow gradient border via padding-box/border-box trick
            border: "2px solid transparent",
            color: hover ? "#fff" : ACCENT,
            backgroundImage: hover
              ? `${RAINBOW}, ${RAINBOW}`
              : `linear-gradient(#fff, #fff), ${RAINBOW}`,
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
            transition: "color 0.25s ease, background-image 0.25s ease",
          }}
        >
          פתחו חשבון סיטונאי
        </motion.a>

        <motion.span
          variants={item}
          style={{
            marginTop: "1.25rem",
            fontFamily: "var(--font-assistant)",
            fontSize: "0.95rem",
            color: "#4B4860",
          }}
        >
          כבר יש לכם חשבון?{" "}
          <a
            href={`${APP_URL}/login`}
            style={{ color: ACCENT, fontWeight: 600, textDecoration: "none" }}
          >
            כניסת לקוחות לקטלוג ←
          </a>
        </motion.span>
      </motion.div>
    </section>
  );
}
