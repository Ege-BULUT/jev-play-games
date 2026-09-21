'use client';
import { useEffect, useMemo, useRef } from 'react';
import type { AnyGame } from '@/games/types';
import type { Decision } from '@/lib/db';

// Draws the state a decision leads to, animating over the game's stepMs from when it arrived.
export function GameCanvas({ game, decision, shownAt, seed = 1, className }: {
  game: AnyGame; decision: Decision | null; shownAt: number; seed?: number; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const state = useMemo(
    () => (decision ? game.step(decision.state, decision.action) : game.init(seed)),
    [game, decision, seed],
  );

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = Math.min(1, (performance.now() - shownAt) / game.stepMs);
      game.render(ctx, state, width, height, t);
      if (t < 1) raf = requestAnimationFrame(draw);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [game, state, shownAt]);

  return <canvas ref={ref} className={className} />;
}
