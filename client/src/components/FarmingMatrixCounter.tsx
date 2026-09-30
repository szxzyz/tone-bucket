import { useEffect, useRef } from "react";

type Props = { amount: number; decimals?: number };

export default function FarmingMatrixCounter({ amount, decimals = 4 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let drops: number[] = [];
    let lastMatrixFrame = 0;
    let raf = 0;
    const fontSize = 11;
    const chars = "01アイウエオカキクケコサシスセソタチツテトレワヲン$%#@&*!<>";

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drops = Array.from({ length: Math.max(1, Math.floor(width / fontSize)) }, () => Math.random() * -30);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      if (time - lastMatrixFrame >= 45) {
        lastMatrixFrame = time;
        ctx.fillStyle = "rgba(5, 5, 5, 0.18)";
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < drops.length; i += 1) {
          const y = drops[i] * fontSize;
          const random = Math.random();
          ctx.fillStyle = random > 0.92 ? "#ffffff" : random > 0.6 ? "#39ff14" : "#00b309";
          ctx.font = `${fontSize}px monospace`;
          ctx.fillText(chars[Math.floor(Math.random() * chars.length)], i * fontSize, y);
          if (y > height && Math.random() > 0.975) drops[i] = 0;
          drops[i] += 0.5;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return (
    <div style={{ position: "relative", width: "100%", height: 100, borderRadius: 12, overflow: "hidden", background: "#050505" }}>
      <canvas ref={canvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.42)" }}>
        <span aria-live="off" className="font-black tabular-nums tracking-tight select-none" style={{ color: "#39ff14", fontSize: "clamp(22px, 7vw, 27px)", textShadow: "0 0 10px #39ff14cc, 0 0 24px #39ff1466, 0 0 40px #39ff1422", lineHeight: 1, letterSpacing: "-0.02em" }}>
          {safeAmount.toFixed(Math.max(0, Math.min(8, decimals)))}
        </span>
      </div>
    </div>
  );
}
