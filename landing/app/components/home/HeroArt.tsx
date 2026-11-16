import styles from "../LandingV2.module.css";

// The hero's toy scene: stacked letter blocks, a ball, a star and a cloud,
// drawn as inline SVG (≈3KB, no network request). Purely decorative —
// aria-hidden, not focusable. Only three groups float (CSS keyframes on an
// outer <g>, transform only); prefers-reduced-motion stops them.

type CubeProps = { x: number; y: number; s: number; front: string; top: string; side: string; letter: string };

// A toy block with a hint of depth: front face + lighter top + darker side.
function Cube({ x, y, s, front, top, side, letter }: CubeProps) {
  const d = Math.round(s * 0.26);
  return (
    <g>
      <polygon points={`${x + 6},${y + 2} ${x + d + 6},${y - d} ${x + s + d - 4},${y - d} ${x + s - 4},${y + 2}`} fill={top} />
      <polygon points={`${x + s - 2},${y + 6} ${x + s + d},${y - d + 4} ${x + s + d},${y + s - d - 6} ${x + s - 2},${y + s - 4}`} fill={side} />
      <rect x={x} y={y} width={s} height={s} rx={12} fill={front} />
      <rect x={x + 9} y={y + 9} width={s - 18} height={s - 18} rx={8} fill="none" stroke="#27163F" strokeOpacity={0.14} strokeWidth={3} />
      <text
        x={x + s / 2}
        y={y + s / 2 + s * 0.17}
        textAnchor="middle"
        fontSize={s * 0.48}
        fontWeight={800}
        fill="#27163F"
        style={{ fontFamily: "var(--font-rubik), sans-serif" }}
      >
        {letter}
      </text>
    </g>
  );
}

export default function HeroArt() {
  return (
    <svg className={styles.heroSvg} viewBox="0 0 400 340" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="kh-ball" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#9AD3FF" />
          <stop offset="100%" stopColor="#2E6BE6" />
        </radialGradient>
        <clipPath id="kh-ball-clip">
          <circle r="40" />
        </clipPath>
      </defs>

      {/* soft halo behind the scene */}
      <circle cx="205" cy="180" r="150" fill="#FFFFFF" opacity="0.07" />
      <circle cx="205" cy="180" r="104" fill="#FFFFFF" opacity="0.07" />

      {/* ground shadow */}
      <ellipse cx="205" cy="300" rx="150" ry="15" fill="#1A0840" opacity="0.32" />

      {/* sparkles (static) */}
      <g fill="#FFFFFF" opacity="0.75">
        <path d="M58 200 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" />
        <path d="M350 160 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
        <path d="M250 40 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
      </g>

      {/* stacked letter blocks */}
      <Cube x={96} y={206} s={84} front="#FFD84D" top="#FFE989" side="#E0B21F" letter="א" />
      <Cube x={190} y={206} s={84} front="#5FD9AE" top="#9BEACB" side="#2FB287" letter="ב" />
      <Cube x={143} y={116} s={84} front="#FF8CC0" top="#FFB8D8" side="#E2589A" letter="ג" />

      {/* ball — floats */}
      <g className={styles.floatB}>
        <g transform="translate(322 252)">
          <circle r="40" fill="url(#kh-ball)" />
          <g clipPath="url(#kh-ball-clip)">
            <path d="M-48 -8 Q0 22 48 -8" stroke="#FFD84D" strokeWidth="11" fill="none" />
            <path d="M-48 20 Q0 50 48 20" stroke="#FFFFFF" strokeWidth="7" fill="none" opacity="0.9" />
          </g>
          <ellipse cx="-13" cy="-17" rx="11" ry="7" fill="#FFFFFF" opacity="0.55" transform="rotate(-30 -13 -17)" />
        </g>
      </g>

      {/* star — floats */}
      <g className={styles.floatA}>
        <g transform="translate(78 104)">
          <polygon
            points="0,-30 7.64,-10.52 28.53,-9.27 12.36,4.02 17.63,24.27 0,13 -17.63,24.27 -12.36,4.02 -28.53,-9.27 -7.64,-10.52"
            fill="#FFD84D"
            stroke="#FFD84D"
            strokeWidth="5"
            strokeLinejoin="round"
          />
          <circle cx="-6" cy="-4" r="2.6" fill="#27163F" />
          <circle cx="6" cy="-4" r="2.6" fill="#27163F" />
          <path d="M-5 5 Q0 9 5 5" stroke="#27163F" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        </g>
      </g>

      {/* cloud — floats */}
      <g className={styles.floatC}>
        <g transform="translate(310 78)" fill="#FFFFFF" opacity="0.95">
          <circle cx="-22" cy="4" r="16" />
          <circle cx="0" cy="-8" r="22" />
          <circle cx="24" cy="2" r="17" />
          <rect x="-38" y="2" width="62" height="18" rx="9" />
        </g>
      </g>
    </svg>
  );
}
