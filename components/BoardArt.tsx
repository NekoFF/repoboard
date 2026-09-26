"use client";

import { useId, type CSSProperties, type ReactNode } from "react";

/**
 * The picture on a board's tile: a plain colour or an abstract, slowly moving
 * motif in the board's colour. The person picks one when creating or editing
 * a board; a board without a choice gets one from its id, so it keeps its
 * look. Colours are computed in CSS from --h / --s (set on `.rb-tile`), so the
 * theme decides the lightness. Pictures draw in a 200 × 140 box.
 */
export const BOARD_ART: { key: string; name: string }[] = [
  { key: "plain", name: "Plain" },
  { key: "orbs", name: "Glow" },
  { key: "waves", name: "Waves" },
  { key: "rings", name: "Rings" },
  { key: "aurora", name: "Aurora" },
  { key: "mesh", name: "Mesh" },
  { key: "dots", name: "Dots" },
  { key: "contours", name: "Contours" },
  { key: "sunset", name: "Sunset" },
  { key: "bubbles", name: "Bubbles" },
  { key: "spiral", name: "Spiral" },
  { key: "radar", name: "Radar" },
  { key: "prism", name: "Prism" },
  { key: "ripple", name: "Ripple" },
  { key: "stars", name: "Stars" },
  { key: "dunes", name: "Dunes" },
  { key: "weave", name: "Weave" },
  { key: "equalizer", name: "Equalizer" },
  { key: "bloom", name: "Bloom" },
  { key: "plasma", name: "Plasma" },
  { key: "orbit", name: "Orbit" },
  { key: "ribbons", name: "Ribbons" },
  { key: "halftone", name: "Halftone" },
  { key: "confetti", name: "Confetti" },
  { key: "stripes", name: "Stripes" },
];

/** The picture a board shows: its own choice, else one picked from its id. */
export function resolveArt(art: string | null | undefined, seed: number): string {
  if (art && BOARD_ART.some((a) => a.key === art)) return art;
  return BOARD_ART[1 + (seed % (BOARD_ART.length - 1))].key;
}

/** A small seeded random generator, so a board's picture never changes. */
function random(seed: number) {
  let t = seed || 1;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const stroke = (opacity: number, width = 1): CSSProperties => ({
  stroke: "var(--tl-stroke)",
  strokeOpacity: opacity,
  strokeWidth: width,
  fill: "none",
});
const fill = (tone: 1 | 2 | 3 | "soft", opacity = 1): CSSProperties => ({
  fill: tone === "soft" ? "var(--tl-fill-soft)" : `var(--tl-fill-${tone})`,
  fillOpacity: opacity,
});
/** An animated SVG element: its class names the motion, the rest is timing. */
const motion = (duration: number, delay = 0, extra: CSSProperties = {}): CSSProperties => ({
  animationDuration: `${duration}s`,
  animationDelay: `${-delay}s`,
  ...extra,
});

function Blob({
  left,
  top,
  size = 95,
  shift = 0,
  drift = 1,
  duration = 20,
  delay = 0,
  aspect,
}: {
  left: number;
  top: number;
  size?: number;
  shift?: number;
  drift?: 1 | 2 | 3;
  duration?: number;
  delay?: number;
  aspect?: number;
}) {
  return (
    <span
      className="rb-tile-blob"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        width: `${size}%`,
        aspectRatio: aspect,
        ["--shift" as string]: shift,
        animationName: `rb-drift-${drift}`,
        animationDuration: `${duration}s`,
        animationDelay: `${-delay}s`,
      }}
    />
  );
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {children}
    </svg>
  );
}

/** A sine line over 0–400 with a period of 100, so sliding by 200 loops. */
function wave(y: number, amplitude: number, phase: number, closed = false): string {
  let d = `M 0 ${(y + Math.sin(phase) * amplitude).toFixed(1)}`;
  for (let x = 5; x <= 400; x += 5) {
    d += ` L ${x} ${(y + Math.sin((x / 100) * Math.PI * 2 + phase) * amplitude).toFixed(1)}`;
  }
  return closed ? `${d} L 400 160 L 0 160 Z` : d;
}

type Motif = (props: { seed: number; uid: string }) => ReactNode;

const MOTIFS: Record<string, Motif> = {
  orbs: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={r() * 40 - 20} top={r() * 40 - 30} drift={1} duration={19} delay={r() * 19} />
        <Blob left={r() * 50 + 30} top={r() * 40 + 10} shift={34} drift={2} duration={23} delay={r() * 23} />
        <Blob left={r() * 60 - 10} top={r() * 30 + 45} shift={-28} drift={3} duration={27} delay={r() * 27} />
      </>
    );
  },

  waves: ({ seed }) => {
    const r = random(seed);
    const base = 40 + r() * 30;
    return (
      <>
        <Blob left={35} top={-40} shift={20} drift={2} duration={24} />
        <Svg>
          <g className="rb-a-flow" style={motion(26 + r() * 14)}>
            {Array.from({ length: 7 }, (_, i) => (
              <path key={i} d={wave(base + i * 9, 6 + r() * 8, i * 0.5 + r() * 3)} style={stroke(0.25 + i * 0.08, 1.1)} />
            ))}
          </g>
        </Svg>
      </>
    );
  },

  rings: ({ seed }) => {
    const r = random(seed);
    const cx = 150 + r() * 50;
    const cy = 10 + r() * 50;
    return (
      <>
        <Blob left={45} top={-35} shift={-24} drift={1} duration={21} />
        <Svg>
          {[18, 34, 50, 66, 82, 98, 114].map((radius, i) => (
            <circle key={radius} cx={cx} cy={cy} r={radius} style={stroke(0.55 - i * 0.06)} />
          ))}
          <g className="rb-a-spin" style={motion(60 + r() * 30)}>
            <circle cx={cx} cy={cy} r={58} style={{ ...stroke(0.8, 2), strokeDasharray: "2 10" }} />
            <circle cx={cx + 58} cy={cy} r={3} style={fill(1)} />
          </g>
        </Svg>
      </>
    );
  },

  aurora: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        {[0, 1, 2].map((i) => (
          <Blob
            key={i}
            left={-5 + i * 32 + r() * 10}
            top={-30 + r() * 20}
            size={48}
            aspect={0.42}
            shift={[0, 45, -40][i]}
            drift={([1, 2, 3] as const)[i]}
            duration={14 + i * 5}
            delay={r() * 14}
          />
        ))}
      </>
    );
  },

  mesh: ({ seed }) => {
    const r = random(seed);
    const corners: [number, number, number][] = [
      [-45, -50, 0],
      [40, -55, 60],
      [-40, 30, -50],
      [45, 30, 120],
    ];
    return (
      <>
        {corners.map(([left, top, shift], i) => (
          <Blob
            key={i}
            left={left}
            top={top}
            size={110}
            shift={shift}
            drift={([1, 2, 3, 1] as const)[i]}
            duration={18 + i * 4}
            delay={r() * 18}
          />
        ))}
      </>
    );
  },

  dots: ({ seed, uid }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={r() * 40} top={-30 + r() * 30} size={85} drift={2} duration={16} delay={r() * 16} />
        <Blob left={-30} top={30} size={70} shift={40} drift={3} duration={22} delay={r() * 22} />
        <Svg>
          <defs>
            <pattern id={`${uid}-dots`} width="8" height="8" patternUnits="userSpaceOnUse">
              <circle cx="4" cy="4" r="0.9" style={{ fill: "var(--tl-stroke)", fillOpacity: 0.55 }} />
            </pattern>
          </defs>
          <rect width="200" height="140" fill={`url(#${uid}-dots)`} />
        </Svg>
      </>
    );
  },

  contours: ({ seed }) => {
    const r = random(seed);
    const cx = 60 + r() * 80;
    const cy = 40 + r() * 60;
    const a = r() * 6;
    const b = r() * 6;
    const lines = Array.from({ length: 10 }, (_, k) => {
      const base = 10 + k * 11;
      let d = "";
      for (let i = 0; i <= 72; i += 1) {
        const t = (i / 72) * Math.PI * 2;
        const radius = base + Math.sin(t * 3 + a) * (3 + k * 0.8) + Math.sin(t * 5 + b) * (2 + k * 0.4);
        d += `${i ? "L" : "M"} ${(cx + Math.cos(t) * radius).toFixed(1)} ${(cy + Math.sin(t) * radius * 0.8).toFixed(1)} `;
      }
      return `${d}Z`;
    });
    return (
      <>
        <Blob left={cx / 2 - 30} top={cy / 1.4 - 45} size={70} drift={1} duration={20} />
        <Svg>
          <g className="rb-a-spin" style={motion(160)}>
            {lines.map((d, k) => (
              <path key={k} d={d} style={stroke(0.6 - k * 0.04)} />
            ))}
          </g>
        </Svg>
      </>
    );
  },

  sunset: ({ seed }) => {
    const r = random(seed);
    const x = 70 + r() * 60;
    return (
      <>
        <Blob left={x / 2 - 45} top={-10} size={95} shift={-20} drift={2} duration={22} />
        <Svg>
          <g className="rb-a-bob" style={motion(9)}>
            <circle cx={x} cy={92} r={40} style={fill(2, 0.9)} />
          </g>
          {Array.from({ length: 9 }, (_, k) => (
            <line key={k} x1="0" x2="200" y1={92 + k * 6} y2={92 + k * 6} style={{ stroke: "var(--tl-bgc)", strokeWidth: 0.6 + k * 0.55 }} />
          ))}
        </Svg>
      </>
    );
  },

  bubbles: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={-20} top={30} size={90} drift={3} duration={24} />
        <Svg>
          {Array.from({ length: 12 }, (_, i) => {
            const size = 3 + r() * 9;
            const duration = 10 + r() * 10;
            return (
              <g key={i} className="rb-a-rise" style={motion(duration, r() * duration)}>
                <circle cx={r() * 200} cy={150} r={size} style={{ ...stroke(0.7), ...fill("soft", 0.5) }} />
              </g>
            );
          })}
        </Svg>
      </>
    );
  },

  spiral: ({ seed }) => {
    const r = random(seed);
    const cx = 60 + r() * 80;
    const cy = 50 + r() * 40;
    let d = "";
    for (let i = 0; i <= 480; i += 1) {
      const t = (i / 480) * Math.PI * 9;
      const radius = 2 + t * 3.4;
      d += `${i ? "L" : "M"} ${(cx + Math.cos(t) * radius).toFixed(1)} ${(cy + Math.sin(t) * radius).toFixed(1)} `;
    }
    return (
      <>
        <Blob left={cx / 2 - 35} top={cy / 1.4 - 40} size={75} drift={1} duration={18} />
        <Svg>
          <g className="rb-a-spin" style={motion(50)}>
            <path d={d} style={stroke(0.55, 1.2)} />
          </g>
        </Svg>
      </>
    );
  },

  radar: ({ seed }) => {
    const r = random(seed);
    const cx = 110 + r() * 50;
    const cy = 60 + r() * 30;
    return (
      <>
        <span
          className="rb-tile-sweep"
          style={{ left: `${(cx / 200) * 100}%`, top: `${(cy / 140) * 100}%`, animationDuration: "7s" }}
        />
        <Svg>
          {[20, 42, 64, 86, 108].map((radius) => (
            <circle key={radius} cx={cx} cy={cy} r={radius} style={stroke(0.4)} />
          ))}
          <line x1={cx - 120} x2={cx + 120} y1={cy} y2={cy} style={stroke(0.25)} />
          <line x1={cx} x2={cx} y1={cy - 120} y2={cy + 120} style={stroke(0.25)} />
          {Array.from({ length: 4 }, (_, i) => (
            <circle
              key={i}
              className="rb-a-twinkle"
              cx={cx + Math.cos(r() * 6.28) * (20 + r() * 80)}
              cy={cy + Math.sin(r() * 6.28) * (15 + r() * 50)}
              r={2}
              style={{ ...fill(1), ...motion(3 + r() * 3, r() * 3) }}
            />
          ))}
        </Svg>
      </>
    );
  },

  prism: ({ seed }) => {
    const r = random(seed);
    const tri = (cx: number, cy: number, size: number, turn: number) =>
      [0, 1, 2]
        .map((k) => {
          const t = turn + (k * Math.PI * 2) / 3;
          return `${(cx + Math.cos(t) * size).toFixed(1)},${(cy + Math.sin(t) * size).toFixed(1)}`;
        })
        .join(" ");
    return (
      <Svg>
        {([1, 2, 3] as const).map((tone, i) => (
          <g
            key={tone}
            className="rb-a-spin"
            style={motion(50 + i * 20, r() * 50, { animationDirection: i % 2 ? "reverse" : "normal", mixBlendMode: "var(--tl-blend)" as CSSProperties["mixBlendMode"] })}
          >
            <polygon points={tri(70 + i * 35 + r() * 10, 60 + r() * 30, 55 + r() * 20, r() * 6)} style={fill(tone, 0.55)} />
          </g>
        ))}
      </Svg>
    );
  },

  ripple: ({ seed }) => {
    const r = random(seed);
    const cx = 40 + r() * 120;
    const cy = 30 + r() * 80;
    return (
      <>
        <Blob left={cx / 2 - 40} top={cy / 1.4 - 45} size={80} drift={2} duration={20} />
        <Svg>
          {Array.from({ length: 5 }, (_, i) => (
            <g key={i} className="rb-a-ripple" style={motion(8, i * 1.6)}>
              <circle cx={cx} cy={cy} r={90} style={stroke(0.8, 1.4)} />
            </g>
          ))}
        </Svg>
      </>
    );
  },

  stars: ({ seed }) => {
    const r = random(seed);
    const points = Array.from({ length: 16 }, () => ({ x: 10 + r() * 180, y: 10 + r() * 120 }));
    const lines: [number, number][] = [];
    points.forEach((p, i) => {
      points
        .map((q, j) => ({ j, d: (p.x - q.x) ** 2 + (p.y - q.y) ** 2 }))
        .filter((e) => e.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .forEach(({ j }) => {
          if (!lines.some(([a, b]) => (a === j && b === i) || (a === i && b === j))) lines.push([i, j]);
        });
    });
    return (
      <>
        <Blob left={-10 + r() * 40} top={-20} size={90} drift={1} duration={24} />
        <Svg>
          {lines.map(([a, b], k) => (
            <line key={k} x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} style={stroke(0.3)} />
          ))}
          {points.map((p, k) => (
            <circle key={k} className="rb-a-twinkle" cx={p.x} cy={p.y} r={1.2 + r() * 1.4} style={{ ...fill(1), ...motion(2.5 + r() * 3, r() * 3) }} />
          ))}
        </Svg>
      </>
    );
  },

  dunes: ({ seed }) => {
    const r = random(seed);
    const layers = [
      { y: 58, tone: "soft" as const, opacity: 0.7, duration: 70 },
      { y: 76, tone: 3 as const, opacity: 0.45, duration: 52 },
      { y: 94, tone: 2 as const, opacity: 0.55, duration: 38 },
      { y: 112, tone: 1 as const, opacity: 0.75, duration: 28 },
    ];
    return (
      <>
        <Blob left={30 + r() * 30} top={-45} size={80} shift={30} drift={2} duration={22} />
        <Svg>
          {layers.map((l, i) => (
            <g key={i} className="rb-a-flow" style={motion(l.duration, r() * l.duration)}>
              <path d={wave(l.y, 5 + r() * 6, r() * 6, true)} style={fill(l.tone, l.opacity)} />
            </g>
          ))}
        </Svg>
      </>
    );
  },

  weave: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={20} top={-30} size={85} shift={-30} drift={3} duration={20} />
        <Svg>
          <g className="rb-a-flow" style={motion(34)}>
            {Array.from({ length: 6 }, (_, i) => (
              <path key={i} d={wave(18 + i * 22, 14, r() * 0.6)} style={stroke(0.5, 1)} />
            ))}
          </g>
          <g className="rb-a-flow" style={motion(34, 0, { animationDirection: "reverse" })}>
            {Array.from({ length: 6 }, (_, i) => (
              <path key={i} d={wave(18 + i * 22, 14, Math.PI + r() * 0.6)} style={stroke(0.35, 1)} />
            ))}
          </g>
        </Svg>
      </>
    );
  },

  equalizer: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={10} top={-40} size={90} drift={1} duration={20} />
        <Svg>
          {Array.from({ length: 17 }, (_, i) => {
            const height = 30 + r() * 80;
            const duration = 2.4 + r() * 2.6;
            return (
              <g key={i} className="rb-a-bar" style={motion(duration, r() * duration)}>
                <rect x={6 + i * 11.2} y={140 - height} width={6} height={height + 10} rx={3} style={fill(1, 0.35 + (i % 3) * 0.15)} />
              </g>
            );
          })}
        </Svg>
      </>
    );
  },

  bloom: ({ seed }) => {
    const r = random(seed);
    const cx = 60 + r() * 80;
    const cy = 45 + r() * 50;
    return (
      <>
        <Blob left={cx / 2 - 30} top={cy / 1.4 - 40} size={70} shift={40} drift={3} duration={18} />
        <Svg>
          <g className="rb-a-spin" style={motion(90)}>
            {Array.from({ length: 12 }, (_, i) => (
              <ellipse key={i} cx={cx} cy={cy} rx={52} ry={13} transform={`rotate(${i * 15} ${cx} ${cy})`} style={stroke(0.45)} />
            ))}
          </g>
          <g className="rb-a-breathe" style={motion(8)}>
            <circle cx={cx} cy={cy} r={8} style={fill(2, 0.8)} />
          </g>
        </Svg>
      </>
    );
  },

  plasma: () => <span className="rb-tile-plasma" style={{ animationDuration: "28s" }} />,

  orbit: ({ seed }) => {
    const r = random(seed);
    const cx = 30 + r() * 30;
    const cy = 110 + r() * 20;
    return (
      <>
        <Blob left={-25} top={40} size={70} drift={2} duration={20} />
        <Svg>
          <circle cx={cx} cy={cy} r={9} style={fill(2, 0.9)} />
          {[46, 78, 112, 146].map((radius, i) => (
            <g key={radius} className="rb-a-spin" style={motion(24 + i * 14, r() * 40, { animationDirection: i % 2 ? "reverse" : "normal" })}>
              <circle cx={cx} cy={cy} r={radius} style={stroke(0.35)} />
              <circle cx={cx + radius} cy={cy} r={2.5 + i * 0.6} style={fill(1)} />
            </g>
          ))}
        </Svg>
      </>
    );
  },

  ribbons: ({ seed }) => {
    const r = random(seed);
    return (
      <Svg>
        {([1, 2, 3] as const).map((tone, i) => {
          const y1 = 20 + r() * 100;
          const y2 = 20 + r() * 100;
          return (
            <g key={tone} className="rb-a-sway" style={motion(9 + i * 3, r() * 9)}>
              <path
                d={`M -20 ${y1} C 50 ${y1 - 60 + r() * 40}, 130 ${y2 + 60 - r() * 40}, 220 ${y2}`}
                style={{ stroke: `var(--tl-fill-${tone})`, strokeOpacity: 0.5, strokeWidth: 22 - i * 5, strokeLinecap: "round", fill: "none" }}
              />
            </g>
          );
        })}
      </Svg>
    );
  },

  halftone: ({ seed }) => {
    const r = random(seed);
    const fx = 30 + r() * 140;
    const fy = 20 + r() * 100;
    const dots: ReactNode[] = [];
    for (let y = 4; y < 140; y += 9) {
      for (let x = 4; x < 200; x += 9) {
        const distance = Math.hypot(x - fx, (y - fy) * 1.3);
        const radius = Math.max(0, 3.8 * (1 - distance / 150));
        if (radius > 0.35) dots.push(<circle key={`${x}-${y}`} cx={x} cy={y} r={radius.toFixed(2)} />);
      }
    }
    return (
      <>
        <Blob left={fx / 2 - 40} top={fy / 1.4 - 45} size={85} drift={1} duration={18} />
        <Svg>
          <g className="rb-a-breathe" style={{ ...motion(10), fill: "var(--tl-stroke)", fillOpacity: 0.6 }}>
            {dots}
          </g>
        </Svg>
      </>
    );
  },

  confetti: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={20} top={-20} size={90} shift={50} drift={2} duration={22} />
        <Svg>
          {Array.from({ length: 22 }, (_, i) => {
            const x = r() * 196;
            const y = r() * 136;
            return (
              <g key={i} transform={`rotate(${Math.round(r() * 180)} ${x} ${y})`}>
                <rect
                  className="rb-a-spin"
                  x={x - 4}
                  y={y - 1.5}
                  width={8}
                  height={3}
                  rx={1}
                  style={{ ...fill(([1, 2, 3] as const)[i % 3], 0.85), ...motion(8 + r() * 14, r() * 10, { animationDirection: i % 2 ? "reverse" : "normal" }) }}
                />
              </g>
            );
          })}
        </Svg>
      </>
    );
  },

  stripes: ({ seed }) => {
    const r = random(seed);
    return (
      <>
        <Blob left={-10 + r() * 40} top={-30} size={95} drift={3} duration={20} />
        <Svg>
          <g transform={`rotate(${-30 - Math.round(r() * 20)} 100 70)`}>
            <g className="rb-a-flow" style={motion(40)}>
              {Array.from({ length: 50 }, (_, i) => (
                <line key={i} x1={-300 + i * 20} x2={-300 + i * 20} y1={-200} y2={340} style={stroke(0.22, 7)} />
              ))}
            </g>
          </g>
        </Svg>
      </>
    );
  },
};

/**
 * `still` pauses the motion, for the small previews in the picker: many moving
 * pictures side by side would compete with the one being chosen.
 */
export function BoardArt({ art, seed, still }: { art: string; seed: number; still?: boolean }) {
  const uid = useId().replace(/:/g, "");
  if (art === "plain") return <span className="rb-tile-art rb-tile-art--solid" aria-hidden />;
  const Picture = MOTIFS[art] ?? MOTIFS.orbs;
  return (
    <span className={`rb-tile-art${still ? " rb-tile-still" : ""}`} aria-hidden>
      <Picture seed={seed} uid={uid} />
      <span className="rb-tile-grain" />
    </span>
  );
}
