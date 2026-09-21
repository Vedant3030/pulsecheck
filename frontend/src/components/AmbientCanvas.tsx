"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Subtle ambient canvas — slow-drifting faint green dots + dim grid.
 * Very low opacity (<10%) so it reads as texture, not a feature.
 * Respects prefers-reduced-motion (static when reduced).
 */
export function AmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rawCtx = canvas.getContext("2d", { alpha: true });
    if (!rawCtx) return;
    const ctx = rawCtx as CanvasRenderingContext2D;

    let animationId = 0;
    let dpr = window.devicePixelRatio || 1;

    // Low-density dots — green phosphor, faint
    const DOT_COUNT = 60;
    const dots: { x: number; y: number; vx: number; vy: number; r: number; a: number }[] = [];

    function initDots(width: number, height: number) {
      dots.length = 0;
      for (let i = 0; i < DOT_COUNT; i++) {
        dots.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          r: Math.random() * 1.2 + 0.4,
          a: Math.random() * 0.04 + 0.02, // 2-6% alpha per dot
        });
      }
    }

    function resize() {
      if (!canvas) return;
      void canvas.getBoundingClientRect();
      // Use parent dimensions for full viewport coverage
      const w = window.innerWidth;
      const h = window.innerHeight;
      dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Re-seed dots to new dimensions only on significant resize
      if (dots.length === 0) initDots(w, h);
      // keep existing dots in bounds
      for (const d of dots) {
        d.x = Math.min(Math.max(d.x, 0), w);
        d.y = Math.min(Math.max(d.y, 0), h);
      }
      drawStatic();
    }

    function drawStatic() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      // Dim scanline grid — 32px matching body, very faint
      ctx.strokeStyle = "rgba(34, 197, 94, 0.015)";
      ctx.lineWidth = 1;
      // vertical
      for (let x = 0; x < w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      // horizontal
      for (let y = 0; y < h; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }
      // dots
      for (const d of dots) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(34, 197, 94, ${d.a})`;
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick() {
      if (reducedMotion) {
        drawStatic();
        return;
      }
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      // faint grid
      ctx.strokeStyle = "rgba(34, 197, 94, 0.012)";
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 64) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
        ctx.stroke();
      }

      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        // wrap softly
        if (d.x < -5) d.x = w + 5;
        if (d.x > w + 5) d.x = -5;
        if (d.y < -5) d.y = h + 5;
        if (d.y > h + 5) d.y = -5;

        ctx.beginPath();
        ctx.fillStyle = `rgba(34, 197, 94, ${d.a})`;
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      animationId = requestAnimationFrame(tick);
    }

    // init
    initDots(window.innerWidth, window.innerHeight);
    resize();
    if (!reducedMotion) {
      tick();
    } else {
      drawStatic();
    }

    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationId);
    };
  }, [reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 opacity-[0.08]"
      style={{ opacity: 0.06 }}
    />
  );
}
