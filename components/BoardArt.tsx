/**
 * The picture on a board's tile: an abstract motif in the board's colour —
 * drifting light, flowing lines or slow rings. Tiles take the motifs in turn;
 * the details come from the board's id, so a board keeps its look. Colours are computed in CSS
 * from --h / --s (set on `.rb-tile`), so the theme decides the lightness.
 */
const MOTIFS = ["orbs", "waves", "rings"] as const;

function pick(seed: number, shift: number, range: number): number {
  return ((seed >>> shift) % 1000) / 1000 * range;
}

function Orbs({ seed }: { seed: number }) {
  const blobs = [
    { left: pick(seed, 0, 40) - 20, top: pick(seed, 3, 40) - 30, shift: 0, drift: "rb-drift-1", dur: 19 },
    { left: pick(seed, 6, 50) + 30, top: pick(seed, 9, 40) + 10, shift: 34, drift: "rb-drift-2", dur: 23 },
    { left: pick(seed, 12, 60) - 10, top: pick(seed, 15, 30) + 45, shift: -28, drift: "rb-drift-3", dur: 27 },
  ];
  return (
    <>
      {blobs.map((b, i) => (
        <span
          key={i}
          className="rb-tile-blob"
          style={{
            left: `${b.left}%`,
            top: `${b.top}%`,
            ["--shift" as string]: b.shift,
            animationName: b.drift,
            animationDuration: `${b.dur}s`,
            animationDelay: `-${pick(seed, 18 + i, b.dur)}s`,
          }}
        />
      ))}
    </>
  );
}

function wave(y: number, amplitude: number, phase: number): string {
  // Four periods across 400 units, so sliding by 200 loops without a seam.
  let d = `M 0 ${y + Math.sin(phase) * amplitude}`;
  for (let x = 5; x <= 400; x += 5) {
    d += ` L ${x} ${(y + Math.sin((x / 100) * Math.PI * 2 + phase) * amplitude).toFixed(1)}`;
  }
  return d;
}

function Waves({ seed }: { seed: number }) {
  const base = 40 + pick(seed, 2, 30);
  const lines = Array.from({ length: 7 }, (_, i) => ({
    y: base + i * 9,
    amplitude: 6 + pick(seed, i, 8),
    phase: i * 0.5 + pick(seed, 4, 3),
  }));
  return (
    <>
      <span className="rb-tile-blob" style={{ left: "35%", top: "-40%", ["--shift" as string]: 20, animationName: "rb-drift-2", animationDuration: "24s" }} />
      <svg className="absolute inset-0 size-full" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <g className="rb-tile-flow" style={{ animationDuration: `${26 + pick(seed, 7, 14)}s` }}>
          {lines.map((l, i) => (
            <path
              key={i}
              d={wave(l.y, l.amplitude, l.phase)}
              fill="none"
              style={{ stroke: "var(--tl-stroke)", strokeOpacity: 0.25 + i * 0.08, strokeWidth: 1.1 }}
            />
          ))}
        </g>
      </svg>
    </>
  );
}

function Rings({ seed }: { seed: number }) {
  const cx = 150 + pick(seed, 1, 50);
  const cy = 10 + pick(seed, 5, 50);
  return (
    <>
      <span className="rb-tile-blob" style={{ left: "45%", top: "-35%", ["--shift" as string]: -24, animationName: "rb-drift-1", animationDuration: "21s" }} />
      <svg className="absolute inset-0 size-full" viewBox="0 0 200 140" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {[18, 34, 50, 66, 82, 98, 114].map((r, i) => (
          <circle key={r} cx={cx} cy={cy} r={r} fill="none" style={{ stroke: "var(--tl-stroke)", strokeOpacity: 0.55 - i * 0.06, strokeWidth: 1 }} />
        ))}
        <g className="rb-tile-spin" style={{ animationDuration: `${60 + pick(seed, 9, 30)}s` }}>
          <circle cx={cx} cy={cy} r={58} fill="none" style={{ stroke: "var(--tl-stroke)", strokeOpacity: 0.8, strokeWidth: 2, strokeDasharray: "2 10" }} />
          <circle cx={cx + 58} cy={cy} r={3} style={{ fill: "var(--tl-stroke)" }} />
        </g>
      </svg>
    </>
  );
}

/** `index` is the tile's place in the grid, so neighbours never share a motif. */
export function BoardArt({ seed, index }: { seed: number; index: number }) {
  const motif = MOTIFS[index % MOTIFS.length];
  return (
    <span className="rb-tile-art" aria-hidden>
      {motif === "orbs" ? <Orbs seed={seed} /> : motif === "waves" ? <Waves seed={seed} /> : <Rings seed={seed} />}
      <span className="rb-tile-grain" />
    </span>
  );
}
