// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface CyberneticGridShaderProps {
  /**
   * Optional className for the container. When provided, replaces the default
   * absolute-fill positioning. Use this to pin the shader to a specific area
   * (e.g. `fixed inset-0 -z-10` for a viewport-wide background, or
   * `absolute inset-0` for a contained backdrop).
   */
  className?: string;
  /** Inline styles merged with the default container styles. */
  style?: React.CSSProperties;
  /**
   * When true (default), the canvas ignores pointer events so it can sit
   * behind interactive UI without blocking clicks.
   */
  pointerThrough?: boolean;
  /** ARIA label for the decorative background. */
  ariaLabel?: string;
}

/**
 * Animated WebGL background that renders a subtle cybernetic grid with a soft
 * radial vignette baked into the fragment shader. Tuned to be calm enough to
 * sit behind primary UI without competing for attention.
 */
const CyberneticGridShader = ({
  className,
  style,
  pointerThrough = true,
  ariaLabel = "Cybernetic Grid animated background",
}: CyberneticGridShaderProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Canvas inherits the container size; CSS keeps it pinned in place.
    const canvas = renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const clock = new THREE.Clock();

    const vertexShader = /* glsl */ `
      void main() {
        gl_Position = vec4(position, 1.0);
      }
    `;

    // Heavily damped from the original demo so the motion stays restful and
    // the colors recede behind foreground content. A radial vignette is baked
    // in at the end so the effect always fades into darkness at the edges
    // regardless of where it is rendered.
    const fragmentShader = /* glsl */ `
      precision highp float;
      uniform vec2  iResolution;
      uniform float iTime;
      uniform vec2  iMouse;

      float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
      }

      void main() {
        vec2 uv    = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
        vec2 mouse = (iMouse           - 0.5 * iResolution.xy) / iResolution.y;

        // Slow global time so pulses feel like ambient breathing, not a beat.
        float t         = iTime * 0.08;
        float mouseDist = length(uv - mouse);

        // Very gentle ripple around the cursor. Falls off quickly so the rest
        // of the grid stays calm.
        float warp = sin(mouseDist * 14.0 - t * 2.0) * 0.018;
        warp *= smoothstep(0.35, 0.0, mouseDist);
        uv += warp;

        // Grid lines.
        vec2  gridUv = abs(fract(uv * 10.0) - 0.5);
        float line   = pow(1.0 - min(gridUv.x, gridUv.y), 60.0);

        // Cool, desaturated base — easy on the eyes against dark UI.
        vec3 gridColor = vec3(0.18, 0.42, 0.85);
        vec3 color     = gridColor * line * (0.32 + sin(t * 1.4) * 0.06);

        // Soft accent pulses — kept low amplitude and shifted toward cyan so
        // they read as subtle highlights instead of hot magenta flashes.
        float energy = sin(uv.x * 16.0 + t * 2.5) * sin(uv.y * 16.0 + t * 1.8);
        energy = smoothstep(0.92, 1.0, energy);
        color += vec3(0.35, 0.7, 1.0) * energy * line * 0.35;

        // Faint cursor glow — gives a hint of interactivity without a hotspot.
        float glow = smoothstep(0.12, 0.0, mouseDist);
        color += vec3(0.6, 0.8, 1.0) * glow * 0.12;

        // Whisper of grain to break up banding on dark displays.
        color += (random(uv + t * 0.1) - 0.5) * 0.012;

        // Baked-in radial vignette so the edges always fade to black, even
        // when the shader is layered without an external mask.
        vec2  vUv      = gl_FragCoord.xy / iResolution.xy;
        float vignette = smoothstep(0.95, 0.35, distance(vUv, vec2(0.5)));
        color *= vignette;

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new THREE.Vector2() },
      iMouse: {
        value: new THREE.Vector2(
          window.innerWidth / 2,
          window.innerHeight / 2
        ),
      },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
    });

    const geometry = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const onResize = () => {
      const width = container.clientWidth || window.innerWidth;
      const height = container.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      uniforms.iResolution.value.set(width, height);
    };

    // Observe the container so the canvas tracks its parent regardless of
    // layout-driven size changes (sidebars opening, footer toggling, etc.).
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
    window.addEventListener("resize", onResize);
    onResize();

    const onMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      uniforms.iMouse.value.set(
        e.clientX - rect.left,
        rect.height - (e.clientY - rect.top)
      );
    };
    window.addEventListener("mousemove", onMouseMove);

    renderer.setAnimationLoop(() => {
      uniforms.iTime.value = clock.getElapsedTime();
      renderer.render(scene, camera);
    });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      resizeObserver.disconnect();

      renderer.setAnimationLoop(null);

      if (canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }

      material.dispose();
      geometry.dispose();
      renderer.dispose();
    };
  }, []);

  // Default to filling the nearest positioned ancestor; callers can override
  // with `fixed inset-0 -z-10` for a viewport-wide background.
  const defaultClassName = "absolute inset-0 overflow-hidden";

  return (
    <div
      ref={containerRef}
      className={className ?? defaultClassName}
      style={{
        pointerEvents: pointerThrough ? "none" : "auto",
        ...style,
      }}
      aria-hidden="true"
      aria-label={ariaLabel}
    />
  );
};

export default CyberneticGridShader;
