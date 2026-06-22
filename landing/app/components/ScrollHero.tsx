"use client";

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

// Total number of JPEG frames in /public/frames (frame_0001.jpg .. frame_0120.jpg)
const FRAME_COUNT = 120;

const ACCENT = "#8A3FFC";
const RAINBOW =
  "linear-gradient(90deg, #FF2E93, #FF8A00, #FFC400, #25C77E, #2E7DFF, #8A3FFC)";

function framePath(i: number) {
  // 1-based, 4-digit zero-padded
  return `/frames/frame_${String(i + 1).padStart(4, "0")}.jpg`;
}

export default function ScrollHero() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const images: HTMLImageElement[] = new Array(FRAME_COUNT);
    let currentIdx = -1;
    let rafId = 0;

    // Cover-fit draw: scale to fill, center, paint white behind the image.
    const draw = (idx: number) => {
      const img = images[idx];
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.width / dpr;
      const ch = canvas.height / dpr;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cw, ch);

      if (!img || !img.complete || img.naturalWidth === 0) return;

      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      const scale = Math.max(cw / iw, ch / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      currentIdx = idx;
    };

    const sizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    sizeCanvas();

    // Preload all frames; draw the first one as soon as it arrives.
    let firstDrawn = false;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const img = new Image();
      img.src = framePath(i);
      if (i === 0) {
        img.onload = () => {
          if (!firstDrawn) {
            firstDrawn = true;
            draw(0);
          }
        };
      }
      images[i] = img;
    }

    // rAF loop driven purely by getBoundingClientRect — no scroll listener.
    const tick = () => {
      const top = container.getBoundingClientRect().top;
      const scrollable = container.offsetHeight - window.innerHeight;
      const progress =
        scrollable > 0 ? Math.max(0, Math.min(1, -top / scrollable)) : 0;
      const target = Math.round(progress * (FRAME_COUNT - 1));
      if (target !== currentIdx && images[target]?.complete) {
        draw(target);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    const onResize = () => {
      sizeCanvas();
      const idx = currentIdx >= 0 ? currentIdx : 0;
      draw(idx);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // staggered fade-in for overlay content
  const fade = {
    hidden: { opacity: 0, y: 24 },
    show: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: 0.8 + i * 0.12, duration: 0.7, ease: [0.25, 0, 0, 1] },
    }),
  } as const;

  return (
    <div ref={containerRef} style={{ height: "300vh", position: "relative" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
          background: "#fff",
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%" }}
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            alignItems: "flex-end",
            textAlign: "right",
            padding: "clamp(1.5rem, 6vw, 6rem)",
            pointerEvents: "none",
            background:
              "linear-gradient(to top, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.45) 50%, transparent 100%)",
          }}
        >
          <motion.span
            custom={0}
            variants={fade}
            initial="hidden"
            animate="show"
            style={{
              fontFamily: "var(--font-rubik)",
              fontSize: "0.72rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: ACCENT,
              fontWeight: 600,
              marginBottom: "1rem",
            }}
          >
            יבוא ושיווק צעצועים · כל הארץ
          </motion.span>

          <motion.h1
            custom={1}
            variants={fade}
            initial="hidden"
            animate="show"
            style={{
              fontFamily: "var(--font-rubik)",
              fontWeight: 900,
              fontSize: "clamp(2.6rem, 7vw, 6rem)",
              lineHeight: 1.02,
              backgroundImage: RAINBOW,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              color: "transparent",
              margin: "0 0 1.1rem",
            }}
          >
            כרם טויס
          </motion.h1>

          <motion.p
            custom={2}
            variants={fade}
            initial="hidden"
            animate="show"
            style={{
              fontFamily: "var(--font-assistant)",
              fontWeight: 400,
              fontSize: "clamp(1rem, 1.4vw, 1.25rem)",
              color: "#4B4860",
              maxWidth: 480,
              margin: "0 0 2rem",
              lineHeight: 1.6,
            }}
          >
            אלפי צעצועים צבעוניים, מותגים מובילים ומחירי סיטונאות — הכול במקום אחד.
          </motion.p>

          <motion.a
            custom={3}
            variants={fade}
            initial="hidden"
            animate="show"
            href="#cta"
            style={{
              fontFamily: "var(--font-rubik)",
              fontWeight: 600,
              fontSize: "0.8rem",
              letterSpacing: "0.1em",
              color: "#fff",
              background: RAINBOW,
              padding: "0.95rem 2.6rem",
              borderRadius: 999,
              textDecoration: "none",
              pointerEvents: "auto",
              display: "inline-block",
            }}
          >
            לקטלוג הסיטונאי
          </motion.a>
        </div>
      </div>
    </div>
  );
}
