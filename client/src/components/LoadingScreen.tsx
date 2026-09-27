import { useCallback, useEffect, useRef, useState } from 'react';
import './LoadingScreen.less';

interface LoadingScreenProps {
  /** Fade out when false (handled by parent unmount). */
  visible?: boolean;
  /** Called once the splash has finished (after the 1s hold). */
  onDone?: () => void;
}

/**
 * Startup splash for WiFi Chat.
 *
 * Online: runs the real ParticleSlider engine — the same script URL the
 * copied `client/src/loading/loading.js` injects — with the same responsive
 * config (`ptlGap`/`ptlSize`), monochrome white, no dat.GUI panel and no
 * click-to-reinit (non-interactive, per splash requirements).
 * NOTE: the slide embedded in the copied `loading.html` is CodePen demo art
 * ("CODEPEN"), so the engine is fed a runtime-generated "WiFi Chat" slide
 * instead. Drop in your own slide PNG as `data-src` to use it verbatim.
 *
 * Offline (or CDN unreachable): falls back to the dependency-free canvas
 * "WiFi Chat" formation below. Splash never blocks on the network.
 */

const PS_URL = 'https://s3-us-west-2.amazonaws.com/s.cdpn.io/23500/ps-0.9.js';
const PS_TIMEOUT_MS = 4000;

// Singleton so StrictMode double-mounts don't inject the script twice.
let psLoadPromise: Promise<boolean> | null = null;

function loadParticleSlider(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  const w = window as unknown as { ParticleSlider?: unknown };
  if (w.ParticleSlider) return Promise.resolve(true);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return Promise.resolve(false);
  }
  if (!psLoadPromise) {
    psLoadPromise = new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const script = document.createElement('script');
      script.src = PS_URL;
      script.async = true;
      script.onload = () =>
        done(
          typeof (window as unknown as { ParticleSlider?: unknown })
            .ParticleSlider !== 'undefined'
        );
      script.onerror = () => {
        script.remove();
        done(false);
      };
      const timer = setTimeout(() => {
        script.remove();
        done(
          typeof (window as unknown as { ParticleSlider?: unknown })
            .ParticleSlider !== 'undefined'
        );
      }, PS_TIMEOUT_MS);
      document.head.appendChild(script);
    });
  }
  return psLoadPromise;
}

/** Render a "WiFi Chat" slide image (data URL) for the engine to sample. */
function makeSlideDataUrl(): string {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 500;
  const g = c.getContext('2d');
  if (!g) return '';
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = 170;
  g.font = `700 ${px}px "Space Grotesk", system-ui, sans-serif`;
  const max = c.width * 0.92;
  const measured = g.measureText('WiFi Chat').width;
  if (measured > max) {
    px = Math.floor((px * max) / measured);
    g.font = `700 ${px}px "Space Grotesk", system-ui, sans-serif`;
  }
  g.fillText('WiFi Chat', c.width / 2, c.height / 2);
  return c.toDataURL('image/png');
}

interface ParticleSliderInstance {
  monochrome?: boolean;
  restless?: boolean;
  setColor?: (value: string) => void;
  init?: (redraw?: boolean) => void;
}

/** Dependency-free fallback: slow solid-white "WiFi Chat" formation. */
function FallbackCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const TITLE = 'WiFi Chat';
    let W = 0;
    let H = 0;
    let raf = 0;
    let particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      tx: number;
      ty: number;
      r: number;
      ph: number;
    }[] = [];

    // Sample the title text offscreen; every sampled pixel becomes a target.
    const buildTargets = () => {
      const off = document.createElement('canvas');
      const size = Math.max(48, Math.min(W * 0.16, H * 0.2));
      off.width = Math.ceil(W / 2);
      off.height = Math.ceil(H / 2);
      const octx = off.getContext('2d', { willReadFrequently: true });
      if (!octx) return;
      octx.fillStyle = '#fff';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      // Shrink to fit the longer "WiFi Chat" title within the viewport.
      let fontPx = Math.floor(size / 2);
      octx.font = `700 ${fontPx}px "Space Grotesk", sans-serif`;
      const maxWidth = W * 0.9;
      const measured = octx.measureText(TITLE).width * 2; // offscreen is half-scale
      if (measured > maxWidth) {
        fontPx = Math.floor((fontPx * maxWidth) / measured);
        octx.font = `700 ${fontPx}px "Space Grotesk", sans-serif`;
      }
      octx.fillText(TITLE, off.width / 2, off.height / 2);

      const gap = Math.max(3, Math.floor(size / 44));
      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const targets: { x: number; y: number }[] = [];
      const cy = H * 0.5; // centered — nothing underneath
      for (let y = 0; y < off.height; y += gap) {
        for (let x = 0; x < off.width; x += gap) {
          if (data[(y * off.width + x) * 4 + 3] > 128) {
            targets.push({ x: x * 2, y: y * 2 + (cy - off.height) });
          }
        }
      }

      // Reuse existing particles; spawn from random positions.
      const next: typeof particles = [];
      for (let i = 0; i < targets.length; i++) {
        const p = particles[i] ?? {
          x: Math.random() * W,
          y: Math.random() * H,
          vx: 0,
          vy: 0,
          tx: 0,
          ty: 0,
          r: 0.8 + Math.random() * 1.4,
          ph: Math.random() * Math.PI * 2,
        };
        p.tx = targets[i].x;
        p.ty = targets[i].y;
        next.push(p);
      }
      particles = next;
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      W = Math.max(1, Math.floor(rect.width));
      H = Math.max(1, Math.floor(rect.height));
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildTargets();
    };

    const tick = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      // Solid white — no per-particle alpha.
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      for (const p of particles) {
        if (!reduced) {
          // Slow formation: weak pull, soft damping, gentle drift.
          p.vx = (p.vx + (p.tx - p.x) * 0.012) * 0.9;
          p.vy = (p.vy + (p.ty - p.y) * 0.012) * 0.9;
          p.x += p.vx + Math.sin(t / 2600 + p.ph) * 0.12;
          p.y += p.vy + Math.cos(t / 3200 + p.ph) * 0.12;
        } else {
          p.x = p.tx;
          p.y = p.ty;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };

    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    // Rebuild once the webfont arrives so particles match final glyphs.
    const fontsReady = (
      document as Document & { fonts?: { ready: Promise<unknown> } }
    ).fonts?.ready.then(() => buildTargets()).catch(() => {});
    resize();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      void fontsReady;
    };
  }, []);

  return <canvas id="particles" ref={canvasRef} />;
}

/** Online path: real ParticleSlider engine on a "WiFi Chat" slide. */
function EngineCanvas({ onError }: { onError: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [slideUrl] = useState(() => {
    try {
      return makeSlideDataUrl();
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !slideUrl) {
      if (!slideUrl) errorRef.current();
      return;
    }
    let ps: ParticleSliderInstance | null = null;
    try {
      const w = window as unknown as {
        ParticleSlider: new (opts: Record<string, unknown>) => ParticleSliderInstance;
      };
      if (typeof w.ParticleSlider === 'undefined') {
        errorRef.current();
        return;
      }
      // Same responsive config as client/src/loading/loading.js init().
      const ua = navigator.userAgent?.toLowerCase() ?? '';
      const isMobile = ua.includes('mobile');
      const isSmall = window.innerWidth < 1000;
      ps = new w.ParticleSlider({
        ptlGap: isMobile || isSmall ? 3 : 0,
        ptlSize: isMobile || isSmall ? 3 : 1,
        width: 1e9,
        height: 1e9,
      });
      // Solid white, drifting — but no dat.GUI panel, no click handler.
      ps.monochrome = true;
      ps.setColor?.('#ffffff');
      ps.restless = true;
      ps.init?.(true);
    } catch {
      // Engine failed: report so the splash drops to the offline fallback.
      ps = null;
      errorRef.current();
    }
    return () => {
      // ps-0.9 has no stop API (the demo runs it forever); React removes the
      // DOM and the splash unmounts seconds later, ending the effect.
      ps = null;
    };
  }, [slideUrl]);

  if (!slideUrl) return null;
  return (
    <div id="particle-slider" ref={hostRef}>
      <div className="slides">
        <div id="first-slide" className="slide" data-src={slideUrl} />
      </div>
      <canvas className="draw" />
    </div>
  );
}

export function LoadingScreen({ visible = true, onDone }: LoadingScreenProps) {
  // boot: black screen while the engine loads (no fallback flash).
  // engine: real animation, centered. fallback: offline canvas animation.
  const [phase, setPhase] = useState<'boot' | 'engine' | 'fallback'>('boot');
  const doneRef = useRef(false);
  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone?.();
  }, [onDone]);
  const goFallback = useCallback(() => {
    setPhase((p) => (p === 'boot' ? 'fallback' : p));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Give up waiting for the CDN after 4s — go offline fallback instead.
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) goFallback();
    }, 4000);
    loadParticleSlider()
      .then((ok) => {
        if (cancelled) return;
        clearTimeout(fallbackTimer);
        setPhase(ok ? 'engine' : 'fallback');
      })
      .catch(() => {
        if (cancelled) return;
        clearTimeout(fallbackTimer);
        goFallback();
      });
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [goFallback]);

  useEffect(() => {
    if (phase === 'boot') return;
    // Let the formation finish, hold 2s so it can be seen, then hand off.
    const hold = phase === 'engine' ? 5200 : 5500;
    const t = setTimeout(finish, hold);
    return () => clearTimeout(t);
  }, [phase, finish]);

  return (
    <div
      aria-hidden="true"
      data-testid="app-loading-screen"
      className={`w1-loader fixed inset-0 z-[100] pointer-events-none select-none transition-opacity duration-700 ${
        visible ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div id="loader">
        {phase === 'engine' ? (
          <EngineCanvas onError={goFallback} />
        ) : phase === 'fallback' ? (
          <FallbackCanvas />
        ) : null}
      </div>
    </div>
  );
}
