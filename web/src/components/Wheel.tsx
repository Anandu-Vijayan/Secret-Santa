"use client";

const PALETTE = [
  { fill: "#1f5141", text: "#fffbf4" },
  { fill: "#fffbf4", text: "#8e1b2c" },
  { fill: "#c8283f", text: "#fffbf4" },
  { fill: "#f0be4b", text: "#2b0f14" },
];

const SIZE = 400;
const C = SIZE / 2;
const R = 186;

function polar(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 100) / 100;
  return [round(C + radius * Math.cos(a)), round(C + radius * Math.sin(a))] as const;
}

function label(name: string) {
  const [first, last] = name.split(/\s+/);
  const short = last ? `${first} ${last[0]}.` : first;
  return short.length > 13 ? `${short.slice(0, 12)}…` : short;
}

/** Rotation (deg) that leaves slice `index` under the top pointer. */
export function restingAngle(index: number, count: number) {
  return -(index + 0.5) * (360 / count);
}

/** Rotation for a full spin from `from` that lands on slice `index`. */
export function spinTo(from: number, index: number, count: number) {
  const seg = 360 / count;
  // land somewhere inside the slice, not dead centre, so it feels real
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  return from - (from % 360) + 360 * 7 + restingAngle(index, count) + jitter;
}

type Props = {
  names: string[];
  rotation?: number;
  /** Animate to `rotation` (true) or jump there (false). */
  animate?: boolean;
  onSettled?: () => void;
  /** Gentle idle rotation for the landing page. */
  idle?: boolean;
  hub?: React.ReactNode;
};

export function Wheel({ names, rotation = 0, animate, onSettled, idle, hub }: Props) {
  const seg = 360 / names.length;
  const lights = Array.from({ length: 20 }, (_, i) => polar(i * 18 - 90, R + 7));

  return (
    <div className="wheel-wrap">
      <svg className="pointer" viewBox="0 0 44 56" aria-hidden="true">
        <path d="M22 54 L4 14 A18 18 0 1 1 40 14 Z" fill="#f0be4b" stroke="#fffbf4" strokeWidth="3" />
        <circle cx="22" cy="18" r="6" fill="#8e1b2c" />
      </svg>

      <svg
        className="wheel"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Name wheel with ${names.length} names`}
        onTransitionEnd={(e) => e.target === e.currentTarget && onSettled?.()}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: animate ? undefined : "none",
          animation: idle ? "wheel-idle 40s linear infinite" : undefined,
        }}
      >
        <circle cx={C} cy={C} r={R + 12} fill="#6e1322" />
        <circle cx={C} cy={C} r={R + 12} fill="none" stroke="#f0be4b" strokeWidth="3" />
        {names.map((name, i) => {
          const start = -90 + i * seg;
          const end = start + seg;
          const [x1, y1] = polar(start, R);
          const [x2, y2] = polar(end, R);
          let color = PALETTE[i % PALETTE.length];
          if (i === names.length - 1 && i % PALETTE.length === 0 && names.length > 1) color = PALETTE[2];
          const mid = start + seg / 2;
          return (
            <g key={`${name}-${i}`}>
              <path
                d={`M${C} ${C} L${x1} ${y1} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x2} ${y2} Z`}
                fill={color.fill}
                stroke="#6e1322"
                strokeWidth="1.5"
              />
              <g transform={`rotate(${mid} ${C} ${C})`}>
                <text x={C + R - 16} y={C} textAnchor="end" dominantBaseline="central" fill={color.text} fontSize={names.length > 10 ? 15 : 17}>
                  {label(name)}
                </text>
              </g>
            </g>
          );
        })}
        <g className="wheel-lights">
          {lights.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="3.6" fill={i % 2 ? "#fffbf4" : "#f0be4b"} />
          ))}
        </g>
      </svg>
      {hub}
      <style>{`@keyframes wheel-idle { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
