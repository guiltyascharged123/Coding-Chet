import {
  Component,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import type { Activity, Agent, Task } from '../../shared/types';

import { DESKS, OfficeSimulation } from '../office/simulation';
import { placeLabels } from '../office/labels';
type Props = {
  agents: Agent[];
  tasks: Task[];
  activities: Activity[];
  mode: 'orbit' | 'top';
  zoom: number;
  reset: number;
  moving: boolean;
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
            gl.setClearColor('#303b45');
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.25;
          }}
          aria-label="Interactive 3D office with agents walking, meeting, and working"
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
  const simulation = useMemo(() => new OfficeSimulation(), []);
  useEffect(
    () => simulation.update(props.agents, props.tasks, props.activities),
    [simulation, props.agents, props.tasks, props.activities],
  );
  useFrame((_, delta) => {
    if (props.moving) simulation.step(delta);
  }, -1);
  return (
    <>
      <CameraRig mode={props.mode} zoom={props.zoom} reset={props.reset} />
      <ambientLight intensity={0.85} />
      <hemisphereLight args={['#e0e6ed', '#414b51', 1.3]} />
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
        <meshStandardMaterial color="#303b45" roughness={1} />
      </mesh>
      <RoundedBox
        args={[17.7, 0.32, 13.5]}
        radius={0.2}
        position={[0, -0.12, 0]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color="#434d55" />
      </RoundedBox>
      <RoundedBox args={[17.45, 0.08, 13.25]} radius={0.1} position={[0, 0.07, 0]} receiveShadow>
        <meshStandardMaterial color="#657079" roughness={0.95} />
      </RoundedBox>
      <gridHelper
        args={[17.3, 18, '#58646d', '#616e76']}
        position={[0, 0.115, 0]}
        scale={[1, 1, 0.76]}
      />
      <Room />
      {props.agents.map((agent) => {
        const task = props.tasks.find(
          (t) => t.agentId === agent.id && (t.status === 'working' || t.status === 'review'),
        );
        return (
          <group key={agent.id}>
            <group position={DESKS[agent.desk]}>
              <Desk color={agent.color} active={task?.status === 'working'} />
            </group>
            <AgentFigure
              agent={agent}
              status={task?.status}
              simulation={simulation}
              moving={props.moving}
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
      <OfficeEquipment />
      <LabelLayout simulation={simulation} agents={props.agents} portal={props.labelPortal} />
      {[
        { position: [0, 0.18, 0.6] as [number, number, number], label: 'MEETING AREA' },
        { position: [3.5, 3.7, -6.1] as [number, number, number], label: 'PLANNING WALL' },
        { position: [7.5, 2.2, 0.3] as [number, number, number], label: 'COFFEE' },
      ].map((zone) => (
        <Html
          key={zone.label}
          portal={props.labelPortal}
          position={zone.position}
          center
          zIndexRange={[1, 0]}
        >
          <span className="scene-zone-label">{zone.label}</span>
        </Html>
      ))}
    </>
  );
}

function LabelLayout({
  simulation,
  agents,
  portal,
}: {
  simulation: OfficeSimulation;
  agents: Agent[];
  portal: RefObject<HTMLDivElement>;
}) {
  const leaders = useRef<SVGSVGElement | null>(null);
  const offsets = useRef(new Map<string, { x: number; y: number }>());
  const last = useRef(-1);
  useEffect(() => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('scene-label-leaders');
    svg.setAttribute('aria-hidden', 'true');
    for (const agent of agents) {
      const line = document.createElementNS(svg.namespaceURI, 'line');
      line.setAttribute('data-agent', agent.id);
      line.setAttribute('stroke', agent.color);
      line.setAttribute('stroke-width', '1.3');
      line.setAttribute('opacity', '0.7');
      svg.append(line);
    }
    portal.current.append(svg);
    leaders.current = svg;
    return () => {
      svg.remove();
    };
  }, [agents, portal]);
  useFrame(({ clock, camera, size }) => {
    if (clock.elapsedTime - last.current < 0.1 || !portal.current) return;
    last.current = clock.elapsedTime;
    const parent = portal.current.getBoundingClientRect();
    const elements = [...portal.current.querySelectorAll<HTMLButtonElement>('.scene-agent-label')];
    const boxes = elements.map((element) => {
      const rect = element.getBoundingClientRect(),
        id = element.dataset.agentId!,
        offset = offsets.current.get(id) || { x: 0, y: 0 };
      return {
        id,
        left: rect.left - parent.left - offset.x,
        top: rect.top - parent.top - offset.y,
        width: rect.width,
        height: rect.height,
      };
    });
    for (const box of placeLabels(boxes, size.width, size.height)) {
      const original = boxes.find((b) => b.id === box.id)!,
        element = elements.find((el) => el.dataset.agentId === box.id)!;
      const offset = { x: box.left - original.left, y: box.top - original.top };
      element.style.translate = `${offset.x}px ${offset.y}px`;
      offsets.current.set(box.id, offset);
      const person = simulation.people.get(box.id),
        line = leaders.current?.querySelector(`[data-agent="${box.id}"]`);
      if (person && line) {
        const head = new THREE.Vector3(person.x, 2.05, person.z).project(camera);
        line.setAttribute('x1', String(((head.x + 1) * size.width) / 2));
        line.setAttribute('y1', String(((1 - head.y) * size.height) / 2));
        line.setAttribute('x2', String(box.left + box.width / 2));
        line.setAttribute('y2', String(box.top + box.height));
      }
    }
  });
  return null;
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
        <meshStandardMaterial color="#59656e" />
      </RoundedBox>
      <RoundedBox
        args={[0.17, 3.8, 13.15]}
        position={[-8.6, 1.95, 0]}
        radius={0.03}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color="#515e68" />
      </RoundedBox>
      <mesh position={[0, 0.22, -6.4]}>
        <boxGeometry args={[17.2, 0.13, 0.1]} />
        <meshStandardMaterial color="#424f59" />
      </mesh>
      {[-3.9, 1.4].map((z) => (
        <group key={z} position={[-8.48, 2.35, z]}>
          <mesh>
            <boxGeometry args={[0.12, 2.35, 3.85]} />
            <meshStandardMaterial color="#324752" />
          </mesh>
          <mesh position={[0.08, 0, 0]}>
            <boxGeometry args={[0.06, 2.12, 3.6]} />
            <meshStandardMaterial color="#698494" roughness={0.2} />
          </mesh>
          <mesh position={[0.13, 0, 0]}>
            <boxGeometry args={[0.06, 2.16, 0.065]} />
            <meshStandardMaterial color="#7a8d99" />
          </mesh>
          <mesh position={[0.13, -0.13, 0]}>
            <boxGeometry args={[0.06, 0.065, 3.6]} />
            <meshStandardMaterial color="#7a8d99" />
          </mesh>
          <mesh position={[0.24, -1.24, 0]} castShadow>
            <boxGeometry args={[0.6, 0.1, 4.05]} />
            <meshStandardMaterial color="#7a8d99" />
          </mesh>
        </group>
      ))}
      <group position={[3.3, 2.25, -6.39]}>
        <RoundedBox args={[4.1, 2.18, 0.12]} radius={0.06} castShadow>
          <meshStandardMaterial color="#3b4954" />
        </RoundedBox>
        <mesh position={[0, 0, 0.08]}>
          <boxGeometry args={[3.91, 1.99, 0.04]} />
          <meshStandardMaterial color="#9caaa9" />
        </mesh>
        {Array.from({ length: 9 }, (_, i) => (
          <mesh
            key={i}
            position={[-1.3 + (i % 3) * 0.82, 0.46 - Math.floor(i / 3) * 0.51, 0.115]}
            rotation={[0, 0, ((i % 3) - 1) * 0.04]}
          >
            <boxGeometry args={[0.5, 0.33, 0.015]} />
            <meshStandardMaterial color={['#bd914b', '#528578', '#5285b5'][i % 3]} />
          </mesh>
        ))}
        <mesh position={[0, -1.13, 0.22]} castShadow>
          <boxGeometry args={[4.2, 0.05, 0.35]} />
          <meshStandardMaterial color="#44545e" />
        </mesh>
      </group>
      <group position={[-1.5, 2.5, -6.4]}>
        <mesh>
          <boxGeometry args={[1.7, 1.7, 0.11]} />
          <meshStandardMaterial color="#344753" />
        </mesh>
        <mesh position={[0, 0, 0.07]}>
          <boxGeometry args={[1.48, 1.48, 0.035]} />
          <meshStandardMaterial color="#7f8c91" />
        </mesh>
        <mesh position={[0.05, 0.1, 0.1]}>
          <circleGeometry args={[0.43, 32]} />
          <meshStandardMaterial color="#a36f4e" />
        </mesh>
        <mesh position={[-0.14, -0.35, 0.11]}>
          <planeGeometry args={[1.2, 0.25]} />
          <meshStandardMaterial color="#3e6a65" />
        </mesh>
      </group>
      <mesh position={[6.5, 2.85, -6.39]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.44, 0.44, 0.08, 40]} />
        <meshStandardMaterial color="#8e9b9f" />
      </mesh>
      <group position={[6.5, 2.85, -6.29]}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.38, 0.38, 0.025, 40]} />
          <meshStandardMaterial color="#283d32" />
        </mesh>
        <mesh position={[0, 0.12, 0.04]}>
          <boxGeometry args={[0.035, 0.24, 0.02]} />
          <meshStandardMaterial color="#d2d8d6" />
        </mesh>
        <mesh position={[0.09, 0, 0.04]} rotation={[0, 0, -Math.PI / 2]}>
          <boxGeometry args={[0.035, 0.19, 0.02]} />
          <meshStandardMaterial color="#d2d8d6" />
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
        <meshStandardMaterial color="#977350" roughness={0.8} />
      </RoundedBox>
      {[-1.17, 1.17].map((x) =>
        [-0.48, 0.48].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.65, z]} castShadow>
            <boxGeometry args={[0.1, 1.12, 0.1]} />
            <meshStandardMaterial color="#3d4b55" />
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
        <meshStandardMaterial color="#52616a" />
      </RoundedBox>
      {[0.45, 0.72, 0.99].map((y) => (
        <mesh key={y} position={[1.05, y, 0.48]}>
          <boxGeometry args={[0.22, 0.025, 0.03]} />
          <meshStandardMaterial color="#34434e" />
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
          color={active ? '#759d9d' : '#526d7b'}
          emissive={active ? color : '#304955'}
          emissiveIntensity={active ? 0.45 : 0.08}
        />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[-0.37 + (i % 2) * 0.1, 2.16 - i * 0.1, -0.32]}>
          <planeGeometry args={[i === 0 ? 0.58 : 0.68, 0.025]} />
          <meshStandardMaterial color={active ? '#354f58' : '#839ba3'} />
        </mesh>
      ))}
      <RoundedBox args={[0.87, 0.035, 0.29]} radius={0.02} position={[-0.25, 1.33, 0.27]}>
        <meshStandardMaterial color="#657079" />
      </RoundedBox>
      <mesh position={[0.4, 1.34, 0.25]}>
        <sphereGeometry args={[0.085, 12, 8]} />
        <meshStandardMaterial color="#91a0a5" />
      </mesh>
      <group position={[-1.08, 1.31, -0.26]}>
        <mesh position={[0, 0.12, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.085, 0.24, 20]} />
          <meshStandardMaterial color="#b5b6ab" />
        </mesh>
        <mesh position={[0, 0.247, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.075, 20]} />
          <meshStandardMaterial color="#705039" />
        </mesh>
        <mesh position={[0.1, 0.13, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.065, 0.019, 8, 14]} />
          <meshStandardMaterial color="#b5b6ab" />
        </mesh>
      </group>
      <group position={[0, 0, 1.1]}>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.045, 0.045, 0.6, 12]} />
          <meshStandardMaterial color="#5b6760" />
        </mesh>
        <RoundedBox args={[0.75, 0.14, 0.71]} radius={0.1} position={[0, 0.7, 0]} castShadow>
          <meshStandardMaterial color="#354852" />
        </RoundedBox>
        <RoundedBox args={[0.75, 0.85, 0.11]} radius={0.1} position={[0, 1.12, 0.35]} castShadow>
          <meshStandardMaterial color="#3a4e59" />
        </RoundedBox>
        {[0, Math.PI / 3, -Math.PI / 3].map((r) => (
          <mesh key={r} position={[0, 0.14, 0]} rotation={[0, r, 0]}>
            <boxGeometry args={[0.9, 0.05, 0.06]} />
            <meshStandardMaterial color="#475963" />
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
  moving,
  simulation,
  labelPortal,
}: {
  agent: Agent;
  status?: string;
  onClick: () => void;
  moving: boolean;
  simulation: OfficeSimulation;
  labelPortal: RefObject<HTMLDivElement>;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null),
    rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null),
    rightLeg = useRef<THREE.Group>(null);
  const folder = useRef<THREE.Group>(null),
    cup = useRef<THREE.Group>(null);
  const label = useRef<HTMLButtonElement>(null),
    actionLabel = useRef<HTMLElement>(null);
  useFrame(({ clock }) => {
    const person = simulation.people.get(agent.id);
    if (!person || !root.current || !body.current) return;
    root.current.position.set(person.x, 0, person.z);
    body.current.rotation.y = person.heading;
    const walking = moving && person.walking;
    const stride = Math.sin(person.distance * 8);

    const action = person.goal.action;
    const interacting = !walking && !person.path.length;
    const seated = interacting && action === 'desk' && status === 'working';
    body.current.position.y = walking ? Math.abs(stride) * 0.065 : seated ? -0.08 : 0;
    body.current.position.z = THREE.MathUtils.lerp(
      body.current.position.z,
      seated ? -1.06 : 0,
      0.15,
    );
    if (leftLeg.current) leftLeg.current.rotation.x = walking ? stride * 0.58 : seated ? -1.3 : 0;
    if (rightLeg.current)
      rightLeg.current.rotation.x = walking ? -stride * 0.58 : seated ? -1.3 : 0;
    if (leftArm.current)
      leftArm.current.rotation.x = walking
        ? -stride * 0.5
        : interacting && (action === 'whiteboard' || action === 'handoff')
          ? -1.1 + (moving ? Math.sin(clock.elapsedTime * 2.5) * 0.15 : 0)
          : 0;
    if (rightArm.current)
      rightArm.current.rotation.x = walking
        ? stride * 0.5
        : interacting && action === 'coffee'
          ? -1.8
          : interacting && action === 'desk' && status === 'working'
            ? -0.7 + (moving ? Math.sin(clock.elapsedTime * 7) * 0.13 : 0)
            : 0;
    if (folder.current) folder.current.visible = action === 'handoff' || action === 'printer';
    if (cup.current) cup.current.visible = interacting && action === 'coffee';
    if (label.current) {
      label.current.dataset.x = person.x.toFixed(2);
      label.current.dataset.z = person.z.toFixed(2);
      label.current.dataset.walking = String(walking);
      label.current.dataset.action = action;
      const text = !moving
        ? 'Movement paused'
        : walking
          ? `To ${person.goal.label}`
          : action === 'handoff'
            ? 'Sharing a handoff'
            : status === 'review'
              ? 'Waiting for your review'
              : action === 'desk'
                ? status === 'working'
                  ? 'Working at desk'
                  : 'At desk'
                : action === 'coffee'
                  ? 'Coffee break'
                  : action === 'whiteboard'
                    ? 'At the planning wall'
                    : action === 'printer'
                      ? 'Collecting documents'
                      : 'Meeting area';
      if (actionLabel.current && actionLabel.current.textContent !== text)
        actionLabel.current.textContent = text;
    }
  });
  return (
    <group
      ref={root}
      position={[DESKS[agent.desk][0], 0, DESKS[agent.desk][2] + 2.16]}
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0]}>
        <ringGeometry args={[0.37, 0.46, 40]} />
        <meshStandardMaterial
          color={status === 'review' ? '#d5ab69' : agent.color}
          transparent
          opacity={status ? 0.65 : 0.22}
        />
      </mesh>
      <group ref={body}>
        <mesh position={[0, 1.08, 0]} castShadow>
          <sphereGeometry args={[0.34, 24, 20]} />
          <meshStandardMaterial color={agent.color} roughness={0.6} />
        </mesh>
        <mesh position={[0, 1.59, 0]} scale={[1.04, 1, 0.93]} castShadow>
          <sphereGeometry args={[0.43, 28, 20]} />
          <meshStandardMaterial color={agent.color} roughness={0.55} />
        </mesh>
        {[-0.15, 0.15].map((x) => (
          <group key={x} position={[x, 1.64, 0.365]}>
            <mesh scale={[1, 1.16, 0.5]}>
              <sphereGeometry args={[0.1, 14, 10]} />
              <meshStandardMaterial color="#e5e8e8" />
            </mesh>
            <mesh position={[0.01, -0.01, 0.05]} scale={[1, 1.16, 0.5]}>
              <sphereGeometry args={[0.05, 12, 10]} />
              <meshStandardMaterial color="#202c35" />
            </mesh>
            <mesh position={[-0.005, 0.012, 0.073]}>
              <sphereGeometry args={[0.015, 8, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 1.43, 0.398]} rotation={[0, 0, Math.PI]}>
          <torusGeometry args={[0.05, 0.012, 8, 12, Math.PI]} />
          <meshStandardMaterial color="#283844" />
        </mesh>
        {[
          { x: -0.35, ref: leftArm },
          { x: 0.35, ref: rightArm },
        ].map(({ x, ref }) => (
          <group key={x} ref={ref} position={[x, 1.21, 0]}>
            <mesh position={[0, -0.16, 0]} rotation={[0, 0, x < 0 ? -0.2 : 0.2]} castShadow>
              <capsuleGeometry args={[0.085, 0.3, 6, 12]} />
              <meshStandardMaterial color={agent.color} />
            </mesh>
          </group>
        ))}
        {[
          { x: -0.15, ref: leftLeg },
          { x: 0.15, ref: rightLeg },
        ].map(({ x, ref }) => (
          <group key={x} ref={ref} position={[x, 0.85, 0]}>
            <mesh position={[0, -0.26, 0.035]} castShadow>
              <capsuleGeometry args={[0.105, 0.3, 6, 12]} />
              <meshStandardMaterial color={agent.color} />
            </mesh>
            <mesh position={[0, -0.47, 0.08]} scale={[1, 0.55, 1.3]} castShadow>
              <sphereGeometry args={[0.12, 12, 10]} />
              <meshStandardMaterial color="#293743" />
            </mesh>
          </group>
        ))}
        <group ref={folder} visible={false} position={[-0.34, 1.06, 0.22]} rotation={[0.2, 0, 0.1]}>
          <RoundedBox args={[0.36, 0.4, 0.06]} radius={0.02} castShadow>
            <meshStandardMaterial color="#b98d4c" />
          </RoundedBox>
          <mesh position={[0, 0.04, 0.035]}>
            <planeGeometry args={[0.23, 0.19]} />
            <meshStandardMaterial color="#d6d8cf" />
          </mesh>
        </group>
        <group ref={cup} visible={false} position={[0.32, 1.52, 0.27]}>
          <mesh>
            <cylinderGeometry args={[0.075, 0.065, 0.15, 16]} />
            <meshStandardMaterial color="#b98d4c" />
          </mesh>
        </group>
      </group>
      <Html portal={labelPortal} position={[0, 3.35, 0]} center zIndexRange={[10, 2]}>
        <button
          ref={label}
          data-agent-id={agent.id}
          className="scene-agent-label"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          <i style={{ background: agent.color }} />
          <span>
            {agent.name}
            <small ref={actionLabel}>At desk</small>
          </span>
          {status === 'review' && <b className="scene-needs-review">!</b>}
        </button>
      </Html>
    </group>
  );
}

function Plant({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.35, 0]} castShadow>
        <cylinderGeometry args={[0.34, 0.25, 0.65, 20]} />
        <meshStandardMaterial color="#88765f" roughness={1} />
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
        <meshStandardMaterial color="#405360" />
      </mesh>
      <mesh position={[0, 1.02, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[1.13, 1.13, 0.12, 48]} />
        <meshStandardMaterial color="#9c7b58" />
      </mesh>
      <mesh position={[0, 0.56, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.36, 0.86, 24]} />
        <meshStandardMaterial color="#475761" />
      </mesh>
      <group position={[0.35, 1.1, -0.05]} scale={0.26}>
        <Plant position={[0, 0, 0]} />
      </group>
      <mesh position={[-0.38, 1.102, 0.2]} rotation={[0, 0.23, 0]}>
        <boxGeometry args={[0.45, 0.015, 0.55]} />
        <meshStandardMaterial color="#9caaa9" />
      </mesh>
      {[-1, 1].map((x) => (
        <group key={x} position={[x * 1.3, 0, 0.45]} rotation={[0, (x * -Math.PI) / 2, 0]}>
          <RoundedBox args={[0.58, 0.13, 0.58]} radius={0.09} position={[0, 0.56, 0]} castShadow>
            <meshStandardMaterial color="#586976" />
          </RoundedBox>
          <RoundedBox args={[0.58, 0.6, 0.1]} radius={0.06} position={[0, 0.9, 0.25]} castShadow>
            <meshStandardMaterial color="#586976" />
          </RoundedBox>
          {[-0.2, 0.2].map((a) =>
            [-0.2, 0.2].map((b) => (
              <mesh key={`${a}${b}`} position={[a, 0.29, b]}>
                <boxGeometry args={[0.05, 0.55, 0.05]} />
                <meshStandardMaterial color="#354650" />
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
        <meshStandardMaterial color="#806246" />
      </RoundedBox>
      <mesh position={[0, 1.5, 0.35]}>
        <boxGeometry args={[3.17, 2.4, 0.025]} />
        <meshStandardMaterial color="#624f3d" />
      </mesh>
      {[0.35, 1.15, 1.95, 2.75].map((y) => (
        <mesh key={y} position={[0, y, 0.38]} castShadow>
          <boxGeometry args={[3.4, 0.075, 0.67]} />
          <meshStandardMaterial color="#957553" />
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
            color={['#4a6c66', '#ad9470', '#476979', '#986a4c', '#667487'][i % 5]}
          />
        </mesh>
      ))}
    </group>
  );
}

function OfficeEquipment() {
  return (
    <>
      <group position={[7.5, 0, 0.3]}>
        <RoundedBox
          args={[1.1, 1.2, 2.1]}
          radius={0.06}
          position={[0, 0.72, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color="#48545f" />
        </RoundedBox>
        <RoundedBox args={[1.25, 0.12, 2.25]} radius={0.04} position={[0, 1.38, 0]} castShadow>
          <meshStandardMaterial color="#9b7957" />
        </RoundedBox>
        <RoundedBox args={[0.65, 0.7, 0.65]} radius={0.06} position={[0, 1.77, -0.4]} castShadow>
          <meshStandardMaterial color="#27333d" />
        </RoundedBox>
        <mesh position={[-0.335, 1.8, -0.4]} rotation={[0, -Math.PI / 2, 0]}>
          <planeGeometry args={[0.35, 0.18]} />
          <meshStandardMaterial color="#739d9d" emissive="#528585" emissiveIntensity={0.35} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[-0.2, 1.54, 0.25 + i * 0.22]} castShadow>
            <cylinderGeometry args={[0.075, 0.06, 0.2, 16]} />
            <meshStandardMaterial color="#c4b9a5" />
          </mesh>
        ))}
      </group>
      <group position={[-7.4, 0, 1.2]}>
        <RoundedBox args={[1.0, 0.9, 1.1]} radius={0.04} position={[0, 0.6, 0]} castShadow>
          <meshStandardMaterial color="#52606a" />
        </RoundedBox>
        <RoundedBox args={[1.05, 0.4, 1.05]} radius={0.06} position={[0, 1.23, 0]} castShadow>
          <meshStandardMaterial color="#80909a" />
        </RoundedBox>
        <mesh position={[0, 1.445, 0]}>
          <boxGeometry args={[0.7, 0.025, 0.75]} />
          <meshStandardMaterial color="#bfc6c7" />
        </mesh>
        <mesh position={[0.53, 1.25, 0.15]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.36, 0.13]} />
          <meshStandardMaterial color="#8da9a7" emissive="#517a76" emissiveIntensity={0.3} />
        </mesh>
      </group>
    </>
  );
}
