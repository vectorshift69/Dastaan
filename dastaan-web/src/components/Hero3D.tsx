"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  Float,
  Environment,
  Lightformer,
  ContactShadows,
} from "@react-three/drei";
import { useRef, useMemo, useEffect, Suspense } from "react";
import * as THREE from "three";

const GOLD = { color: "#e0b93a", metalness: 1, roughness: 0.14 } as const;
const GOLD_BRIGHT = { color: "#f0d878", metalness: 1, roughness: 0.08 } as const;
const STEEL = { color: "#f2f0ea", metalness: 0.95, roughness: 0.16 } as const;
const CHARCOAL = { color: "#454545", metalness: 0.55, roughness: 0.38 } as const;

/* ------------------------------------------------------------------ */
/* Scroll choreography — the constellation moves between "slides"      */
/* as the page scrolls, like a presentation:                           */
/*   slide 0 (hero)      → right of the headline                       */
/*   slide 1 (services)  → sweeps to the left margin, turns            */
/*   slide 2 (stylists)  → crosses to the right, turns back            */
/*   slide 3 (branches)  → sinks away and hands the page over          */
/* ------------------------------------------------------------------ */

const ss = (t: number) => t * t * (3 - 2 * t); // smoothstep

function key(p: number, arr: number[]) {
  const i = Math.max(0, Math.min(arr.length - 2, Math.floor(p)));
  const f = ss(Math.min(Math.max(p - i, 0), 1));
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

function Choreo({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const scroll = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      scroll.current = window.scrollY / window.innerHeight;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useFrame((state, delta) => {
    if (!g.current) return;
    const p = Math.min(scroll.current, 3);

    const X = key(p, [1.15, -2.1, 2.1, 0]);
    const Y = key(p, [0.05, -0.1, 0.15, -4.2]);
    const RY = key(p, [0, 1.15, -0.95, 0.4]);
    const RZ = key(p, [0, 0.22, -0.18, 0]);
    const S = key(p, [1, 0.78, 0.82, 0.25]);

    // mouse parallax rides on top of the choreography
    const mx = (state.pointer.x * Math.PI) / 18;
    const my = (state.pointer.y * Math.PI) / 26;

    g.current.position.x = THREE.MathUtils.damp(g.current.position.x, X, 3, delta);
    g.current.position.y = THREE.MathUtils.damp(g.current.position.y, Y, 3, delta);
    g.current.rotation.y = THREE.MathUtils.damp(g.current.rotation.y, RY + mx, 2.5, delta);
    g.current.rotation.x = THREE.MathUtils.damp(g.current.rotation.x, -my, 2.5, delta);
    g.current.rotation.z = THREE.MathUtils.damp(g.current.rotation.z, RZ, 2.5, delta);
    const s = THREE.MathUtils.damp(g.current.scale.x, S, 3, delta);
    g.current.scale.setScalar(s);
  });

  return <group ref={g}>{children}</group>;
}

/* Tapered scissor blade as an extruded 2D profile */
function useBladeGeometry() {
  return useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-0.07, 0);
    s.lineTo(0.075, 0);
    s.quadraticCurveTo(0.09, 0.75, 0.012, 1.52);
    s.quadraticCurveTo(-0.05, 0.8, -0.07, 0);
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: 0.028,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
    });
    geo.center();
    geo.translate(0, 0.76, 0);
    return geo;
  }, []);
}

function ScissorHalf({ geo, flip }: { geo: THREE.ExtrudeGeometry; flip: boolean }) {
  return (
    <group scale={[flip ? -1 : 1, 1, 1]}>
      <mesh geometry={geo} castShadow>
        <meshStandardMaterial {...STEEL} />
      </mesh>
      <mesh position={[0.1, -0.32, 0]} rotation={[0, 0, 0.32]} castShadow>
        <cylinderGeometry args={[0.032, 0.045, 0.62, 20]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
      <mesh position={[0.22, -0.72, 0]} rotation={[0, 0, 0.5]} castShadow>
        <torusGeometry args={[0.17, 0.042, 20, 48]} />
        <meshStandardMaterial {...GOLD} />
      </mesh>
    </group>
  );
}

/* Scissors that idle-breathe, snip on click/tap, and react to cursor motion */
function Scissors() {
  const geo = useBladeGeometry();
  const top = useRef<THREE.Group>(null);
  const bottom = useRef<THREE.Group>(null);
  const snipAt = useRef(-10);
  const clock = useRef(0);

  useEffect(() => {
    const handler = () => { snipAt.current = clock.current; };
    window.addEventListener("pointerdown", handler);
    return () => window.removeEventListener("pointerdown", handler);
  }, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    clock.current = t;
    const roam = Math.min(1, Math.abs(state.pointer.x) + Math.abs(state.pointer.y));
    let open = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.4)) + 0.14 * roam;
    const since = t - snipAt.current;
    if (since >= 0 && since < 0.45) {
      open *= Math.abs(Math.cos((since / 0.45) * Math.PI));
    }
    if (top.current) top.current.rotation.z = open;
    if (bottom.current) bottom.current.rotation.z = -open;
  });

  return (
    <Float speed={1.5} rotationIntensity={0.35} floatIntensity={0.7}>
      <group position={[0, 0.15, 0]} rotation={[0.15, -0.35, -0.5]} scale={1.25}>
        <group ref={top}>
          <ScissorHalf geo={geo} flip={false} />
        </group>
        <group ref={bottom} scale={[1, 1, -1]}>
          <ScissorHalf geo={geo} flip />
        </group>
        <mesh castShadow>
          <sphereGeometry args={[0.075, 28, 20]} />
          <meshStandardMaterial {...GOLD_BRIGHT} />
        </mesh>
      </group>
    </Float>
  );
}

/* Straight razor, half-open */
function Razor() {
  return (
    <Float speed={1.1} rotationIntensity={0.45} floatIntensity={0.9}>
      <group position={[-1.35, -1.25, -0.8]} rotation={[0.3, 0.5, 0.55]} scale={0.85}>
        <mesh castShadow>
          <capsuleGeometry args={[0.09, 1.25, 8, 20]} />
          <meshStandardMaterial {...CHARCOAL} />
        </mesh>
        {[0.72, -0.72].map((y) => (
          <mesh key={y} position={[0, y, 0]} castShadow>
            <sphereGeometry args={[0.1, 24, 16]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
        ))}
        <group position={[0, 0.68, 0]} rotation={[0, 0, -2.1]}>
          <mesh position={[0, 0.62, 0]} castShadow>
            <boxGeometry args={[0.2, 1.15, 0.035]} />
            <meshStandardMaterial {...STEEL} />
          </mesh>
          <mesh position={[0.1, 0.62, 0]} castShadow>
            <cylinderGeometry args={[0.032, 0.032, 1.15, 16]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
          <mesh position={[0, 1.32, 0]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.07, 0.3, 0.03]} />
            <meshStandardMaterial {...GOLD} />
          </mesh>
        </group>
      </group>
    </Float>
  );
}

/* Salon comb */
function Comb() {
  const TEETH = 16;
  return (
    <Float speed={1.7} rotationIntensity={0.5} floatIntensity={1}>
      <group position={[1.95, 1.25, -0.9]} rotation={[0.4, -0.4, 0.9]} scale={0.9}>
        <mesh castShadow>
          <boxGeometry args={[1.5, 0.17, 0.05]} />
          <meshStandardMaterial {...CHARCOAL} />
        </mesh>
        <mesh position={[0, 0.055, 0]}>
          <boxGeometry args={[1.5, 0.02, 0.052]} />
          <meshStandardMaterial {...GOLD_BRIGHT} />
        </mesh>
        {Array.from({ length: TEETH }).map((_, i) => {
          const x = -0.68 + (i * 1.36) / (TEETH - 1);
          return (
            <mesh key={i} position={[x, -0.26, 0]} castShadow>
              <boxGeometry args={[0.036, 0.38, 0.04]} />
              <meshStandardMaterial {...CHARCOAL} />
            </mesh>
          );
        })}
      </group>
    </Float>
  );
}

/* Round vanity hand-mirror — the unisex touch */
function Mirror() {
  return (
    <Float speed={1.3} rotationIntensity={0.4} floatIntensity={0.8}>
      <group position={[-0.75, 1.55, -1.5]} rotation={[0.25, 0.55, -0.35]} scale={0.72}>
        {/* frame */}
        <mesh castShadow>
          <torusGeometry args={[0.55, 0.06, 24, 72]} />
          <meshStandardMaterial {...GOLD} />
        </mesh>
        {/* glass */}
        <mesh>
          <circleGeometry args={[0.52, 48]} />
          <meshPhysicalMaterial
            color="#cfd6dd"
            metalness={1}
            roughness={0.03}
            clearcoat={1}
            side={THREE.DoubleSide}
          />
        </mesh>
        {/* handle */}
        <mesh position={[0, -0.92, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.065, 0.75, 20]} />
          <meshStandardMaterial {...GOLD} />
        </mesh>
        <mesh position={[0, -1.34, 0]}>
          <sphereGeometry args={[0.08, 24, 16]} />
          <meshStandardMaterial {...GOLD_BRIGHT} />
        </mesh>
      </group>
    </Float>
  );
}

/* Tiny gold dust motes for depth */
function Motes() {
  const pts = useMemo(() => {
    const arr: [number, number, number][] = [];
    for (let i = 0; i < 26; i++) {
      arr.push([
        (Math.random() - 0.5) * 7,
        (Math.random() - 0.5) * 5,
        -1.5 - Math.random() * 3,
      ]);
    }
    return arr;
  }, []);
  return (
    <>
      {pts.map((p, i) => (
        <Float key={i} speed={0.8 + (i % 5) * 0.3} floatIntensity={2} rotationIntensity={0}>
          <mesh position={p}>
            <sphereGeometry args={[0.018 + (i % 3) * 0.01, 8, 8]} />
            <meshStandardMaterial {...GOLD_BRIGHT} />
          </mesh>
        </Float>
      ))}
    </>
  );
}

/* Procedural studio lighting — zero external assets, loads instantly */
function Studio() {
  return (
    <Environment resolution={256}>
      <group rotation={[-Math.PI / 3, 0, 1]}>
        <Lightformer form="rect" intensity={7} position={[0, 5, -9]} scale={[10, 10, 1]} />
        <Lightformer form="rect" intensity={3} position={[-5, 1, -1]} rotation-y={Math.PI / 2} scale={[16, 0.6, 1]} />
        <Lightformer form="rect" intensity={4} position={[10, 1, 0]} rotation-y={-Math.PI / 2} scale={[16, 1.6, 1]} />
        <Lightformer form="circle" color="#e3c25e" intensity={5} position={[2, 3, 4]} scale={4} />
      </group>
    </Environment>
  );
}

export default function Hero3D() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <Canvas
        dpr={[1, 1.8]}
        camera={{ position: [0, 0.15, 6.2], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <fog attach="fog" args={["#0c0c0c", 10, 16]} />
          <ambientLight intensity={0.8} />
          <spotLight position={[4, 4, 5]} intensity={70} angle={0.55} penumbra={1} color="#fff6dd" />
          <pointLight position={[-3, -1, 3]} intensity={12} color="#e3c25e" />
          <Choreo>
            <Scissors />
            <Razor />
            <Comb />
            <Mirror />
            <Motes />
          </Choreo>
          <ContactShadows position={[0, -2.5, 0]} opacity={0.5} scale={10} blur={2.8} far={4} color="#000000" />
          <Studio />
        </Suspense>
      </Canvas>
    </div>
  );
}
