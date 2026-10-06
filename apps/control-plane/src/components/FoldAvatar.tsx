import { useEffect, useRef } from "react";

/**
 * Canvas-drawn "fold" avatars in the BoardUI spirit: a soft geometric blob
 * with a folded corner and two eyes that wander around and blink. Original
 * implementation — only the visual concept is borrowed, not any source.
 *
 * Mood maps harness state onto the face: busy agents glance around, passed
 * agents smile (arc eyes), failed ones frown. Respects reduced motion.
 */

export type FoldMood = "idle" | "busy" | "happy" | "sad";
export type FoldShape = "blob" | "diamond" | "shield" | "flower" | "circle";

export function agentVisual(
  agent: "coordinator" | "worker" | "verifier" | "user",
  index: number,
): { color: string; shape: FoldShape } {
  if (agent === "coordinator")
    return { color: "var(--color-status-yellow-background)", shape: "shield" };
  if (agent === "user")
    return {
      color: "var(--color-background-tertiary-default)",
      shape: "circle",
    };
  if (agent === "verifier")
    return { color: "var(--color-status-purple-background)", shape: "flower" };
  const workers = [
    { color: "var(--color-status-blue-background)", shape: "blob" as const },
    { color: "var(--color-status-cyan-background)", shape: "diamond" as const },
    { color: "var(--color-status-rose-background)", shape: "circle" as const },
  ];
  return workers[Math.max(0, index) % workers.length];
}

export function moodFromTone(
  tone: "idle" | "busy" | "passed" | "failed",
): FoldMood {
  if (tone === "passed") return "happy";
  if (tone === "failed") return "sad";
  return tone;
}

function roundedPolygon(
  path: Path2D,
  points: [number, number][],
  radius: number,
): void {
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const [px, py] = points[(i + count - 1) % count];
    const [cx, cy] = points[i];
    const [nx, ny] = points[(i + 1) % count];
    const inLen = Math.hypot(cx - px, cy - py) || 1;
    const outLen = Math.hypot(nx - cx, ny - cy) || 1;
    const startX = cx - ((cx - px) / inLen) * radius;
    const startY = cy - ((cy - py) / inLen) * radius;
    const endX = cx + ((nx - cx) / outLen) * radius;
    const endY = cy + ((ny - cy) / outLen) * radius;
    if (i === 0) path.moveTo(startX, startY);
    else path.lineTo(startX, startY);
    path.arcTo(cx, cy, endX, endY, radius);
  }
  path.closePath();
}

function buildShape(shape: FoldShape): { body: Path2D; fold?: Path2D } {
  const body = new Path2D();
  switch (shape) {
    case "blob": {
      roundedPolygon(
        body,
        [
          [12, 12],
          [60, 12],
          [88, 40],
          [88, 88],
          [12, 88],
        ],
        17,
      );
      const fold = new Path2D();
      roundedPolygon(
        fold,
        [
          [60, 12],
          [88, 40],
          [60, 40],
        ],
        5,
      );
      return { body, fold };
    }
    case "diamond":
      roundedPolygon(
        body,
        [
          [50, 6],
          [94, 50],
          [50, 94],
          [6, 50],
        ],
        15,
      );
      return { body };
    case "shield":
      roundedPolygon(
        body,
        [
          [20, 10],
          [80, 10],
          [80, 50],
          [50, 90],
          [20, 50],
        ],
        13,
      );
      return { body };
    case "flower": {
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const cx = 50 + Math.cos(angle) * 20;
        const cy = 50 + Math.sin(angle) * 20;
        body.moveTo(cx + 16, cy);
        body.arc(cx, cy, 16, 0, Math.PI * 2);
      }
      body.moveTo(74, 50);
      body.arc(50, 50, 24, 0, Math.PI * 2);
      return { body };
    }
    case "circle":
    default:
      body.moveTo(90, 50);
      body.arc(50, 50, 40, 0, Math.PI * 2);
      return { body };
  }
}

export interface FoldAvatarProps {
  color: string;
  shape?: FoldShape;
  size?: number;
  mood?: FoldMood;
  label?: string;
}

export function FoldAvatar({
  color,
  shape = "blob",
  size = 34,
  mood = "busy",
  label,
}: FoldAvatarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const scale = (size - 8) / 100;
    const inset = 4 * dpr;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, inset, inset);

    const { body, fold } = buildShape(shape);
    let bodyFill = "";
    let eyeColor = "";
    const resolveColors = () => {
      const styles = getComputedStyle(canvas);
      bodyFill = styles.color;
      eyeColor = styles
        .getPropertyValue("--color-foreground-icon-primary")
        .trim();
    };
    resolveColors();
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Eye state: a shared gaze target per face, plus a blink phase machine.
    const gaze = { x: 0, y: 0, targetX: 0, targetY: 0 };
    const wanderRange = mood === "busy" ? { x: 8, y: 6 } : { x: 4, y: 3 };
    const wanderInterval = () =>
      mood === "busy"
        ? 900 + Math.random() * 1100
        : 1800 + Math.random() * 2200;
    let nextWander = 0;
    let blink = 0;
    let blinking = false;
    let blinkStart = 0;
    let nextBlink = 1400 + Math.random() * 2800;

    const drawEyes = () => {
      ctx.save();
      ctx.clip(body); // eyes never spill onto the fold or past the silhouette
      ctx.fillStyle = eyeColor;
      ctx.strokeStyle = eyeColor;
      if (mood === "happy" || mood === "sad") {
        ctx.lineWidth = 3.4;
        ctx.lineCap = "round";
        for (const ex of [39, 61]) {
          ctx.beginPath();
          if (mood === "happy")
            ctx.arc(ex + gaze.x, 47 + gaze.y, 5.6, Math.PI, Math.PI * 2);
          else ctx.arc(ex + gaze.x, 41 + gaze.y, 5.6, 0, Math.PI);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }
      const eyeHeight = 11 * (1 - blink * 0.9);
      for (const ex of [39, 61]) {
        const width = 6.4;
        const x = ex + gaze.x - width / 2;
        const y = 45 + gaze.y - eyeHeight / 2;
        ctx.beginPath();
        ctx.moveTo(x + width / 2, y);
        ctx.arcTo(
          x + width,
          y,
          x + width,
          y + eyeHeight,
          Math.min(width, eyeHeight) / 2,
        );
        ctx.arcTo(
          x + width,
          y + eyeHeight,
          x,
          y + eyeHeight,
          Math.min(width, eyeHeight) / 2,
        );
        ctx.arcTo(x, y + eyeHeight, x, y, Math.min(width, eyeHeight) / 2);
        ctx.arcTo(x, y, x + width, y, Math.min(width, eyeHeight) / 2);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    };

    const draw = () => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      ctx.fillStyle = bodyFill;
      ctx.fill(body);
      if (fold) {
        ctx.save();
        ctx.fillStyle = eyeColor;
        ctx.globalAlpha = 0.16;
        ctx.fill(fold);
        ctx.restore();
      }
      drawEyes();
    };

    const themeObserver = new MutationObserver(() => {
      resolveColors();
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    if (reducedMotion) {
      draw();
      return () => themeObserver.disconnect();
    }

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (now >= nextWander) {
        gaze.targetX = (Math.random() * 2 - 1) * wanderRange.x;
        gaze.targetY = (Math.random() * 2 - 1) * wanderRange.y;
        nextWander = now + wanderInterval();
      }
      const ease = 1 - Math.exp(-dt * 7);
      gaze.x += (gaze.targetX - gaze.x) * ease;
      gaze.y += (gaze.targetY - gaze.y) * ease;

      if (!blinking && now >= nextBlink) {
        blinking = true;
        blinkStart = now;
      }
      if (blinking) {
        const t = (now - blinkStart) / 190;
        if (t >= 1) {
          blinking = false;
          blink = 0;
          nextBlink = now + 2400 + Math.random() * 3200;
        } else {
          blink = Math.sin(t * Math.PI);
        }
      }

      draw();
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
    };
  }, [color, shape, size, mood]);

  return (
    <canvas
      className="fold-avatar"
      ref={canvasRef}
      style={{ color, width: `${size}px`, height: `${size}px` }}
      role="img"
      aria-label={label ?? "agent avatar"}
    />
  );
}
