import { Component, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Activity, Agent, Task } from '../../shared/types';

const DESKS: [number, number, number][] = [
  [-4.3, 0, -2.4],
  [3.6, 0, -2.4],
  [-4.3, 0, 2.7],
  [3.6, 0, 2.7],
];
type Props = {
  agents: Agent[];
  tasks: Task[];
  activities: Activity[];
  mode: 'orbit' | 'top';
  zoom: number;
  reset: number;
  onAgentClick: (id: string) => void;
};

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

export default function Office(props: Props) {
  const labelPortal = useRef<HTMLDivElement>(null!);
  const [available] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      return false;
    }
  });
  const fallback = (
    <div className="office-fallback">
      <div className="fallback-desks">
        {props.agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => props.onAgentClick(agent.id)}
            style={{ '--agent-color': agent.color } as React.CSSProperties}
          >
            <span className="fallback-agent">
              <i />
              <i />
            </span>
            <span className="fallback-desk" />
            <strong>{agent.name}</strong>
            <small>{agent.role}</small>
          </button>
        ))}
      </div>
      <p>3D needs WebGL. Your team’s workflow is fully available in this view.</p>
    </div>
  );
  if (!available) return fallback;
  return (
    <SceneBoundary fallback={fallback}>
      <div className="office-renderer">
        <Canvas
          orthographic
          shadows
          dpr={[1, 1.5]}
          camera={{ position: [17, 18, 21], zoom: 32, near: 0.1, far: 150 }}
          gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.setClearColor('#edf0e9');
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.08;
          }}
          aria-label="Interactive 3D office with four agents at their desks"
        >
          <Scene {...props} labelPortal={labelPortal} />
        </Canvas>
        <div className="scene-label-layer" ref={labelPortal} />
      </div>
    </SceneBoundary>
  );
}

function CameraRig({ mode, zoom, reset }: Pick<Props, 'mode' | 'zoom' | 'reset'>) {
  const { camera, size } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  useEffect(() => {
    const position: [number, number, number] = mode === 'top' ? [0, 27, 0.01] : [17, 18, 21];
    camera.position.set(...position);
    camera.lookAt(0, 0, 0);
    controls.current?.target.set(0, 0, 0);
    controls.current?.update();
  }, [camera, mode, reset]);
  useEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom = Math.min(size.width / 24, size.height / 17) * zoom;
      camera.updateProjectionMatrix();
    }
  }, [camera, size, zoom, mode]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={mode === 'orbit'}
      enablePan
      maxPolarAngle={Math.PI / 2.35}
      minPolarAngle={0.12}
      minZoom={12}
      maxZoom={95}
      zoomSpeed={0.6}
      rotateSpeed={0.5}
      target={[0, 0, 0]}
    />
  );
}

function Scene(props: Props & { labelPortal: RefObject<HTMLDivElement> }) {
  const reducedMotion = useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return (
    <>
      <CameraRig mode={props.mode} zoom={props.zoom} reset={props.reset} />
      <ambientLight intensity={0.7} />
      <hemisphereLight args={['#fffdf5', '#c7d0bd', 1]} />
      <directionalLight
        position={[-8, 17, 9]}
        intensity={2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-15}
        shadow-camera-right={15}
        shadow-camera-top={15}
        shadow-camera-bottom={-15}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[10, 7, -7]} intensity={0.8} color="#e8eeff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#edf0e9" roughness={1} />
      </mesh>
      <RoundedBox
        args={[17.7, 0.32, 13.5]}
        radius={0.2}
        position={[0, -0.12, 0]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color="#d8d8cc" />
      </RoundedBox>
      <RoundedBox args={[17.45, 0.08, 13.25]} radius={0.1} position={[0, 0.07, 0]} receiveShadow>
        <meshStandardMaterial color="#eeeae0" roughness={0.95} />
      </RoundedBox>
      <gridHelper
        args={[17.3, 18, '#d6d4c9', '#e0ddd3']}
        position={[0, 0.115, 0]}
        scale={[1, 1, 0.76]}
      />
      <Room />
      {props.agents.map((agent) => {
        const task = props.tasks.find(
          (t) => t.agentId === agent.id && (t.status === 'working' || t.status === 'review'),
        );
        return (
          <group key={agent.id} position={DESKS[agent.desk]}>
            <Desk color={agent.color} active={task?.status === 'working'} />
            <AgentFigure
              agent={agent}
              status={task?.status}
              reducedMotion={reducedMotion.current}
              labelPortal={props.labelPortal}
              onClick={() => props.onAgentClick(agent.id)}
            />
          </group>
        );
      })}
      <MeetingTable />
      <Plant position={[-7.5, 0, -5.3]} scale={1.2} />
      <Plant position={[7.6, 0, -5.2]} scale={1.1} />
      <Plant position={[-7.6, 0, 5.3]} scale={0.8} />
      <Plant position={[7.3, 0, 5.4]} scale={0.75} />
      <Bookcase />
      <Collaboration
        agents={props.agents}
        activities={props.activities}
        reducedMotion={reducedMotion.current}
      />
    </>
  );
}

function Room() {
  return (
    <>
      <RoundedBox
        args={[17.5, 3.8, 0.17]}
        position={[0, 1.95, -6.55]}
        radius={0.03}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#fbfaf4" />
      </RoundedBox>
      <RoundedBox
        args={[0.17, 3.8, 13.15]}
        position={[-8.6, 1.95, 0]}
        radius={0.03}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#e8e8df" />
      </RoundedBox>
      <mesh position={[0, 0.22, -6.4]}>
        <boxGeometry args={[17.2, 0.13, 0.1]} />
        <meshStandardMaterial color="#c5c8ba" />
      </mesh>
      {[-3.9, 1.4].map((z) => (
        <group key={z} position={[-8.48, 2.35, z]}>
          <mesh>
            <boxGeometry args={[0.12, 2.35, 3.85]} />
            <meshStandardMaterial color="#bbc8c5" />
          </mesh>
          <mesh position={[0.08, 0, 0]}>
            <boxGeometry args={[0.06, 2.12, 3.6]} />
            <meshStandardMaterial color="#dce8e3" roughness={0.2} />
          </mesh>
          <mesh position={[0.13, 0, 0]}>
            <boxGeometry args={[0.06, 2.16, 0.065]} />
            <meshStandardMaterial color="#fffef7" />
          </mesh>
          <mesh position={[0.13, -0.13, 0]}>
            <boxGeometry args={[0.06, 0.065, 3.6]} />
            <meshStandardMaterial color="#fffef7" />
          </mesh>
          <mesh position={[0.24, -1.24, 0]} castShadow>
            <boxGeometry args={[0.6, 0.1, 4.05]} />
            <meshStandardMaterial color="#faf9ef" />
          </mesh>
        </group>
      ))}
      <group position={[3.3, 2.25, -6.39]}>
        <RoundedBox args={[4.1, 2.18, 0.12]} radius={0.06} castShadow>
          <meshStandardMaterial color="#c2c7ba" />
        </RoundedBox>
        <mesh position={[0, 0, 0.08]}>
          <boxGeometry args={[3.91, 1.99, 0.04]} />
          <meshStandardMaterial color="#fffdf5" />
        </mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh
            key={i}
            position={[-1.3 + (i % 3) * 0.82, 0.46 - Math.floor(i / 3) * 0.51, 0.115]}
            rotation={[0, 0, ((i % 3) - 1) * 0.04]}
          >
            <boxGeometry args={[0.5, 0.33, 0.015]} />
            <meshStandardMaterial color={['#e9c675', '#c7d59b', '#bac6de'][i % 3]} />
          </mesh>
        ))}
        <mesh position={[0, -1.13, 0.22]} castShadow>
          <boxGeometry args={[4.2, 0.05, 0.35]} />
          <meshStandardMaterial color="#b3b6aa" />
        </mesh>
      </group>
      <group position={[-1.5, 2.5, -6.4]}>
        <mesh>
          <boxGeometry args={[1.7, 1.7, 0.11]} />
          <meshStandardMaterial color="#b0b69d" />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[1.48, 1.48, 0.035]} />
          <meshStandardMaterial color="#f4e9d2" />
        </mesh>
        <mesh position={[0.05, 0.1, 0.1]}>
          <circleGeometry args={[0.43, 32]} />
          <meshStandardMaterial color="#cf9374" />
        </mesh>
        <mesh position={[-0.14, -0.35, 0.11]}>
          <planeGeometry args={[1.2, 0.25]} />
          <meshStandardMaterial color="#899778" />
        </mesh>
      </group>
      <mesh position={[6.5, 2.85, -6.39]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.44, 0.44, 0.08, 40]} />
        <meshStandardMaterial color="#fffef5" />
      </mesh>
      <group position={[6.5, 2.85, -6.29]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.025, 40]} />
          <meshStandardMaterial color="#283d32" />
        </mesh>
        <mesh position={[0, 0.12, 0.04]}>
          <boxGeometry args={[0.035, 0.24, 0.02]} />
          <meshStandardMaterial color="#ecf1d8" />
        </mesh>
        <mesh position={[0.09, 0, 0.04]} rotation={[0, 0, -Math.PI / 2]}>
          <boxGeometry args={[0.035, 0.19, 0.02]} />
          <meshStandardMaterial color="#ecf1d8" />
        </mesh>
      </group>
    </>
  );
}

function Desk({ color, active }: { color: string; active: boolean }) {
  return (
    <>
      <RoundedBox args={[3.4, 0.035, 3.2]} radius={0.18} position={[0, 0.135, 0.45]} receiveShadow>
        <meshStandardMaterial color={color} roughness={1} transparent opacity={0.32} />
      </RoundedBox>
      <RoundedBox
        args={[2.85, 0.14, 1.38]}
        radius={0.07}
        position={[0, 1.23, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#d9b991" roughness={0.8} />
      </RoundedBox>
      {[-1.17, 1.17].map((x) =>
        [-0.48, 0.48].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.65, z]} castShadow>
            <boxGeometry args={[0.1, 1.12, 0.1]} />
            <meshStandardMaterial color="#e5e4da" />
          </mesh>
        )),
      )}
      <RoundedBox
        args={[0.65, 0.9, 0.9]}
        radius={0.06}
        position={[1.05, 0.69, 0.02]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#f7f5ea" />
      </RoundedBox>
      {[0.45, 0.72, 0.99].map((y) => (
        <mesh key={y} position={[1.05, y, 0.48]}>
          <boxGeometry args={[0.22, 0.025, 0.03]} />
          <meshStandardMaterial color="#b5b7ac" />
        </mesh>
      ))}
      <mesh position={[-0.2, 1.35, -0.32]} castShadow>
        <boxGeometry args={[0.46, 0.06, 0.3]} />
        <meshStandardMaterial color="#5d6863" />
      </mesh>
      <mesh position={[-0.2, 1.62, -0.39]} castShadow>
        <boxGeometry args={[0.07, 0.5, 0.07]} />
        <meshStandardMaterial color="#65706b" />
      </mesh>
      <RoundedBox
        args={[1.25, 0.81, 0.095]}
        radius={0.04}
        position={[-0.2, 1.98, -0.39]}
        castShadow
      >
        <meshStandardMaterial color="#414e48" />
      </RoundedBox>
      <mesh position={[-0.2, 1.98, -0.335]}>
        <planeGeometry args={[1.1, 0.66]} />
        <meshStandardMaterial
          color={active ? '#d9eed4' : '#becac0'}
          emissive={active ? color : '#b1b9ae'}
          emissiveIntensity={active ? 0.45 : 0.08}
        />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[-0.37 + (i % 2) * 0.1, 2.16 - i * 0.1, -0.32]}>
          <planeGeometry args={[i === 0 ? 0.58 : 0.68, 0.025]} />
          <meshStandardMaterial color={active ? '#6b9177' : '#9eafa2'} />
        </mesh>
      ))}
      <RoundedBox args={[0.87, 0.035, 0.29]} radius={0.02} position={[-0.25, 1.33, 0.27]}>
        <meshStandardMaterial color="#eeeae0" />
      </RoundedBox>
      <mesh position={[0.4, 1.34, 0.25]}>
        <sphereGeometry args={[0.085, 12, 8]} />
        <meshStandardMaterial color="#eae8dd" />
      </mesh>
      <group position={[-1.08, 1.31, -0.26]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.085, 0.24, 20]} />
          <meshStandardMaterial color="#f9f5e8" />
        </mesh>
        <mesh position={[0, 0.247, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.075, 20]} />
          <meshStandardMaterial color="#705039" />
        </mesh>
        <mesh position={[0.1, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.065, 0.019, 8, 14]} />
          <meshStandardMaterial color="#f9f5e8" />
        </mesh>
      </group>
      <group position={[0, 0, 1.1]}>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.6, 12]} />
          <meshStandardMaterial color="#5b6760" />
        </mesh>
        <RoundedBox args={[0.75, 0.14, 0.71]} radius={0.1} position={[0, 0.7, 0]} castShadow>
          <meshStandardMaterial color="#687a69" />
        </RoundedBox>
        <RoundedBox args={[0.75, 0.85, 0.11]} radius={0.1} position={[0, 1.12, 0.35]} castShadow>
          <meshStandardMaterial color="#6c7e6c" />
        </RoundedBox>
        {[0, Math.PI / 3, -Math.PI / 3].map((r) => (
          <mesh key={r} position={[0, 0.14, 0]} rotation={[0, r, 0]}>
            <boxGeometry args={[0.9, 0.05, 0.06]} />
            <meshStandardMaterial color="#788178" />
          </mesh>
        ))}
      </group>
    </>
  );
}

function AgentFigure({
  agent,
  status,
  onClick,
  reducedMotion,
  labelPortal,
}: {
  agent: Agent;
  status?: string;
  onClick: () => void;
  reducedMotion: boolean;
  labelPortal: RefObject<HTMLDivElement>;
}) {
  const body = useRef<THREE.Group>(null);
  const arm = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const phase = agent.desk * 1.7;
  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.elapsedTime + phase;
    if (body.current) {
      body.current.position.y = Math.sin(t * 1.8) * 0.024;
      body.current.rotation.y = Math.sin(t * 0.7) * (status === 'working' ? 0.1 : 0.035);
    }
    if (arm.current)
      arm.current.rotation.x =
        status === 'working' ? -0.3 + Math.sin(t * 5) * 0.16 : Math.sin(t * 1.3) * 0.07;
    if (ring.current) {
      ring.current.scale.setScalar(1 + Math.sin(t * 2) * 0.07);
      (ring.current.material as THREE.MeshStandardMaterial).opacity = 0.28 + Math.sin(t * 2) * 0.1;
    }
  });
  return (
    <group
      position={[0, 0, 1.35]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = '';
      }}
    >
      {status && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.18, 0]}>
          <ringGeometry args={[0.52, 0.65, 40]} />
          <meshStandardMaterial
            color={status === 'review' ? '#cd8e31' : agent.color}
            transparent
            opacity={0.4}
          />
        </mesh>
      )}
      <group ref={body}>
        <mesh position={[0, 1.12, 0]} castShadow>
          <sphereGeometry args={[0.38, 24, 20]} />
          <meshStandardMaterial color={agent.color} roughness={0.48} />
        </mesh>
        <mesh position={[0, 1.65, 0]} scale={[1.08, 1, 0.93]} castShadow>
          <sphereGeometry args={[0.45, 32, 24]} />
          <meshStandardMaterial color={agent.color} roughness={0.45} />
        </mesh>
        {[-0.16, 0.16].map((x) => (
          <group key={x} position={[x, 1.69, 0.385]}>
            <mesh scale={[1, 1.18, 0.5]}>
              <sphereGeometry args={[0.11, 16, 12]} />
              <meshStandardMaterial color="#fffefa" />
            </mesh>
            <mesh position={[0.015, -0.01, 0.052]} scale={[1, 1.2, 0.5]}>
              <sphereGeometry args={[0.054, 14, 10]} />
              <meshStandardMaterial color="#283b37" />
            </mesh>
            <mesh position={[0.001, 0.012, 0.077]}>
              <sphereGeometry args={[0.017, 8, 8]} />
              <meshBasicMaterial color="white" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.48, 0.419]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.055, 0.014, 8, 12, Math.PI]} />
          <meshStandardMaterial color="#38544d" />
        </mesh>
        <mesh ref={arm} position={[-0.37, 1.1, 0]} rotation={[0, 0, -0.32]} castShadow>
          <capsuleGeometry args={[0.09, 0.34, 6, 12]} />
          <meshStandardMaterial color={agent.color} />
        </mesh>
        <mesh position={[0.37, 1.1, 0]} rotation={[-0.2, 0, 0.32]} castShadow>
          <capsuleGeometry args={[0.09, 0.34, 6, 12]} />
          <meshStandardMaterial color={agent.color} />
        </mesh>
        {[-0.16, 0.16].map((x) => (
          <mesh key={x} position={[x, 0.69, 0.045]} rotation={[-0.12, 0, x]} castShadow>
            <capsuleGeometry args={[0.115, 0.27, 6, 12]} />
            <meshStandardMaterial color={agent.color} />
          </mesh>
        ))}
        <mesh position={[0, 1.13, 0.36]}>
          <sphereGeometry args={[0.025, 8, 8]} />
          <meshStandardMaterial color="#f2f5d9" />
        </mesh>
      </group>
      <Html portal={labelPortal} position={[0, 0.2, 1.05]} center zIndexRange={[10, 0]}>
        <button
          className="scene-agent-label"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <i style={{ background: agent.color }} />
          <span>{agent.name}</span>
          <small>
            {status === 'working' ? 'Working' : status === 'review' ? 'Needs you' : agent.role}
          </small>
        </button>
      </Html>
      {status === 'review' && (
        <Html portal={labelPortal} position={[0.4, 2.25, 0]} center zIndexRange={[12, 0]}>
          <span className="scene-review-bubble">!</span>
        </Html>
      )}
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.25, 0.65, 20]} />
        <meshStandardMaterial color="#d8ccb8" roughness={1} />
      </mesh>
      <mesh position={[0, 0.68, 0]}>
        <cylinderGeometry args={[0.29, 0.29, 0.035, 16]} />
        <meshStandardMaterial color="#665d43" />
      </mesh>
      <mesh position={[0, 1.15, 0]}>
        <cylinderGeometry args={[0.025, 0.04, 1, 10]} />
        <meshStandardMaterial color="#65804a" />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = i * 2.4;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.25, 0.95 + (i % 4) * 0.2, Math.sin(angle) * 0.25]}
            rotation={[Math.sin(angle) * 0.55, angle, Math.cos(angle) * 0.65]}
            scale={[0.22, 0.48, 0.1]}
            castShadow
          >
            <sphereGeometry args={[1, 12, 12]} />
            <meshStandardMaterial color={i % 2 ? '#6b8b52' : '#8a9e62'} roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

function MeetingTable() {
  return (
    <group position={[0, 0, -1.2]}>
      <mesh position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[1.65, 48]} />
        <meshStandardMaterial color="#d6d4bb" />
      </mesh>
      <mesh position={[0, 1.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.13, 1.13, 0.12, 48]} />
        <meshStandardMaterial color="#f7f2e5" />
      </mesh>
      <mesh position={[0, 0.56, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.36, 0.86, 24]} />
        <meshStandardMaterial color="#c8cbbb" />
      </mesh>
      <group position={[0.35, 1.1, -0.05]} scale={0.26}>
        <Plant position={[0, 0, 0]} />
      </group>
      <mesh position={[-0.38, 1.102, 0.2]} rotation={[0, 0.23, 0]}>
        <boxGeometry args={[0.45, 0.015, 0.55]} />
        <meshStandardMaterial color="#b0c1a1" />
      </mesh>
      {[-1, 1].map((x) => (
        <group key={x} position={[x * 1.3, 0, 0.45]} rotation={[0, (x * -Math.PI) / 2, 0]}>
          <RoundedBox args={[0.58, 0.13, 0.58]} radius={0.09} position={[0, 0.56, 0]} castShadow>
            <meshStandardMaterial color="#b9a983" />
          </RoundedBox>
          <RoundedBox args={[0.58, 0.6, 0.1]} radius={0.06} position={[0, 0.9, 0.25]} castShadow>
            <meshStandardMaterial color="#b9a983" />
          </RoundedBox>
          {[-0.2, 0.2].map((a) =>
            [-0.2, 0.2].map((b) => (
              <mesh key={`${a}${b}`} position={[a, 0.29, b]}>
                <boxGeometry args={[0.05, 0.55, 0.05]} />
                <meshStandardMaterial color="#a2a78f" />
              </mesh>
            )),
          )}
        </group>
      ))}
    </group>
  );
}

function Bookcase() {
  return (
    <group position={[-5.5, 0, -5.9]}>
      <RoundedBox
        args={[3.4, 2.7, 0.65]}
        radius={0.035}
        position={[0, 1.47, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#c3a787" />
      </RoundedBox>
      <mesh position={[0, 1.5, 0.35]}>
        <boxGeometry args={[3.17, 2.4, 0.025]} />
        <meshStandardMaterial color="#d0b696" />
      </mesh>
      {[0.35, 1.15, 1.95, 2.75].map((y) => (
        <mesh key={y} position={[0, y, 0.38]} castShadow>
          <boxGeometry args={[3.4, 0.075, 0.67]} />
          <meshStandardMaterial color="#bb9f7c" />
        </mesh>
      ))}
      {Array.from({ length: 21 }, (_, i) => (
        <mesh
          key={i}
          position={[-1.35 + (i % 7) * 0.39, 0.71 + Math.floor(i / 7) * 0.8, 0.45]}
          rotation={[0, 0, i % 6 === 0 ? -0.12 : 0]}
          castShadow
        >
          <boxGeometry args={[0.18 + (i % 3) * 0.04, 0.5 + (i % 2) * 0.09, 0.32]} />
          <meshStandardMaterial
            color={['#a4b49c', '#e5d4b5', '#779087', '#bf8d70', '#9b9caa'][i % 5]}
          />
        </mesh>
      ))}
    </group>
  );
}

function Collaboration({
  agents,
  activities,
  reducedMotion,
}: Pick<Props, 'agents' | 'activities'> & { reducedMotion: boolean }) {
  const dot = useRef<THREE.Mesh>(null);
  const activity = activities.find(
    (a) =>
      a.agentId &&
      a.targetAgentId &&
      a.agentId !== a.targetAgentId &&
      Date.now() - a.createdAt < 25_000,
  );
  const from = agents.find((a) => a.id === activity?.agentId);
  const to = agents.find((a) => a.id === activity?.targetAgentId);
  const curve =
    from && to
      ? new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(DESKS[from.desk][0], 1.5, DESKS[from.desk][2] + 1.35),
          new THREE.Vector3(0, 4.5, 0),
          new THREE.Vector3(DESKS[to.desk][0], 1.5, DESKS[to.desk][2] + 1.35),
        )
      : null;
  useFrame(({ clock }) => {
    if (dot.current && curve && !reducedMotion)
      dot.current.position.copy(curve.getPoint((clock.elapsedTime * 0.3) % 1));
  });
  if (!curve || !from) return null;
  return (
    <>
      <Line
        points={curve.getPoints(50)}
        color={from.color}
        lineWidth={1.4}
        transparent
        opacity={0.45}
        dashed
        dashSize={0.12}
        gapSize={0.12}
      />
      <mesh ref={dot}>
        <sphereGeometry args={[0.075, 12, 12]} />
        <meshBasicMaterial color={from.color} />
      </mesh>
    </>
  );
}
