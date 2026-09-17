import * as React from 'react'
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber'
import { Environment, Sparkles } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { VRMLoaderPlugin, VRMUtils, VRMHumanBoneName, type VRM } from '@pixiv/three-vrm'
import type { AssistantState } from '../../lib/types'

// ---------------------------------------------------------------------------
// NovaVRMAvatar — renders WHATEVER VRM model the user picked, using VRM's
// standardized humanoid bone names and expression presets (happy/angry/sad/
// blink/aa...) instead of a model-specific rig like NovaAvatar's Shinobu
// FBX. That standardization is exactly what makes "pick any VRM" possible:
// the same pose/expression code drives any VRM 0.x or 1.0 model unchanged.
// ---------------------------------------------------------------------------

type BoneKey =
  | 'head'
  | 'neck'
  | 'chest'
  | 'spine'
  | 'hips'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'

const BONE_NAMES: Record<BoneKey, VRMHumanBoneName> = {
  head: VRMHumanBoneName.Head,
  neck: VRMHumanBoneName.Neck,
  chest: VRMHumanBoneName.Chest,
  spine: VRMHumanBoneName.Spine,
  hips: VRMHumanBoneName.Hips,
  leftUpperArm: VRMHumanBoneName.LeftUpperArm,
  rightUpperArm: VRMHumanBoneName.RightUpperArm,
  leftLowerArm: VRMHumanBoneName.LeftLowerArm,
  rightLowerArm: VRMHumanBoneName.RightLowerArm,
}

type Pose = Partial<Record<BoneKey, [number, number, number]>>

// VRM's "normalized" bones are presented in the model's raw bind pose,
// which for humanoid rigs is a T-pose — arms held straight out sideways.
// Every state below builds on this resting, arms-down pose rather than
// deltas from zero, or the character would stand in a permanent T-pose.
const REST: Pose = {
  leftUpperArm: [0, 0, -1.15],
  rightUpperArm: [0, 0, 1.15],
}

function poseFor(state: AssistantState, t: number): Pose {
  switch (state) {
    case 'listening':
      return {
        ...REST,
        head: [0.04 + 0.03 * Math.sin(t * 1.6), 0.22 * Math.sin(t * 0.7), 0.02],
        neck: [0.02, 0.08 * Math.sin(t * 0.7), 0],
        chest: [0.04, 0, 0],
      }
    case 'thinking':
      // Right arm lifts partway from resting, toward a "hand near chin" gesture.
      return {
        ...REST,
        head: [0.3 + 0.03 * Math.sin(t * 1.1), 0.3, 0.14],
        neck: [0.1, 0.15, 0.05],
        spine: [0.03, 0.04, 0],
        rightUpperArm: [0, 0, 0.5],
        rightLowerArm: [0, 0.1, 1.3],
      }
    case 'speaking':
      return {
        ...REST,
        head: [0.05 * Math.sin(t * 5.2), 0.09 * Math.sin(t * 2.6), 0],
        neck: [0.03 * Math.sin(t * 5.2), 0, 0],
        leftUpperArm: [0.05, 0, -1.15 + 0.22 * Math.sin(t * 3.4)],
        rightUpperArm: [0.05, 0, 1.15 - 0.22 * Math.sin(t * 3.4 + 1.2)],
      }
    case 'happy':
      // Both arms raised up and out — a deliberate departure from rest.
      return {
        head: [-0.12 + 0.04 * Math.sin(t * 4), 0.05 * Math.sin(t * 2), 0],
        leftUpperArm: [0.1, 0, -0.9 - 0.08 * Math.sin(t * 5)],
        rightUpperArm: [0.1, 0, 0.9 + 0.08 * Math.sin(t * 5 + 1)],
        chest: [0, 0, 0.02 * Math.sin(t * 5)],
        hips: [0.03 * Math.abs(Math.sin(t * 5)), 0, 0],
      }
    case 'confused':
      return {
        ...REST,
        head: [0.06, 0.4 * Math.sin(t * 1.3), 0.2],
        neck: [0.03, 0.14 * Math.sin(t * 1.3), 0.06],
        spine: [0, 0.05 * Math.sin(t * 1.3), 0],
      }
    case 'error':
      // Arms tense inward slightly from resting.
      return {
        ...REST,
        head: [0.14, 0.45 * Math.sin(t * 3.2), 0],
        neck: [0.05, 0.16 * Math.sin(t * 3.2), 0],
        leftUpperArm: [0.05, 0, -0.85],
        rightUpperArm: [0.05, 0, 0.85],
      }
    default:
      // idle — a slow breathing sway, driven continuously so she never
      // looks like a frozen screenshot.
      return {
        ...REST,
        chest: [0.015 * Math.sin(t * 0.9), 0, 0],
        head: [0.02 * Math.sin(t * 0.6), 0.05 * Math.sin(t * 0.4), 0],
      }
  }
}

// Which VRM expression preset (if any) each state drives, and how strongly.
const STATE_EXPRESSION: Partial<Record<AssistantState, { name: string; weight: number }>> = {
  happy: { name: 'happy', weight: 1 },
  error: { name: 'angry', weight: 0.8 },
  confused: { name: 'sad', weight: 0.6 },
  thinking: { name: 'relaxed', weight: 0.3 },
}
const EXPRESSION_NAMES = ['happy', 'angry', 'sad', 'relaxed', 'surprised'] as const

// Idle personality flourishes — without these, a VRM character just breathes
// and blinks forever, which reads as lifeless next to the default Shinobu
// character's random mocap gestures. Fired randomly every ~7-17s while
// idle, briefly overriding the pose/expression before handing back.
type FlourishKind = 'lookAround' | 'stretch' | 'surprised'
const FLOURISH_KINDS: FlourishKind[] = ['lookAround', 'stretch', 'surprised']
const FLOURISH_EXPRESSION: Record<FlourishKind, { name: string; weight: number }> = {
  lookAround: { name: 'relaxed', weight: 0.25 },
  stretch: { name: 'relaxed', weight: 0.4 },
  surprised: { name: 'surprised', weight: 0.8 },
}

function flourishPoseFor(kind: FlourishKind, localT: number): Pose {
  switch (kind) {
    case 'lookAround':
      return {
        ...REST,
        head: [0.05, 0.5 * Math.sin(localT * 2.2), 0.05],
        neck: [0.02, 0.15 * Math.sin(localT * 2.2), 0],
      }
    case 'stretch':
      return {
        head: [-0.1, 0, 0],
        leftUpperArm: [0.2, 0, -1.3 - 0.15 * Math.sin(localT * 3)],
        rightUpperArm: [0.2, 0, 1.3 + 0.15 * Math.sin(localT * 3)],
        chest: [0.03, 0, 0],
      }
    case 'surprised':
      return { ...REST, head: [-0.08 + 0.02 * Math.sin(localT * 6), 0, 0], chest: [-0.02, 0, 0] }
  }
}

function VRMModel({
  url,
  state,
  interactRef,
}: {
  url: string
  state: AssistantState
  interactRef?: React.MutableRefObject<(() => void) | null>
}) {
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.register((parser) => new VRMLoaderPlugin(parser))
  })
  const { camera } = useThree()
  const stateRef = React.useRef(state)
  stateRef.current = state
  const interactUntilRef = React.useRef(0)

  const { vrm, normalizedHeight } = React.useMemo(() => {
    const v = gltf.userData.vrm as VRM
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    v.scene.traverse((obj) => {
      obj.frustumCulled = false
    })

    const box = new THREE.Box3().setFromObject(v.scene)
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = 3.1 / maxDim
    v.scene.scale.setScalar(scale)
    v.scene.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale)

    return { vrm: v, normalizedHeight: size.y * scale }
  }, [gltf])

  const currentPoseRef = React.useRef<Record<BoneKey, THREE.Euler>>(
    Object.fromEntries(Object.keys(BONE_NAMES).map((k) => [k, new THREE.Euler()])) as Record<BoneKey, THREE.Euler>
  )
  const quatScratch = React.useRef(new THREE.Quaternion())
  const nextBlinkAtRef = React.useRef(2 + Math.random() * 3)
  const blinkUntilRef = React.useRef(0)
  const elapsedRef = React.useRef(0)
  const nextFlourishAtRef = React.useRef(5 + Math.random() * 6)
  const flourishUntilRef = React.useRef(0)
  const flourishStartRef = React.useRef(0)
  const flourishKindRef = React.useRef<FlourishKind>('lookAround')

  React.useEffect(() => {
    // Fit-to-frame: solve for the distance where the model's full
    // (normalized) height exactly fills the camera's vertical FOV, plus a
    // small padding margin — rather than a fixed distance tuned for one
    // particular window shape. This is what makes head-to-toe framing work
    // whether the viewport is a small square chat panel or a tall narrow
    // desktop-companion window; a fixed distance leaves huge empty
    // headroom in the tall case since vertical FOV coverage doesn't scale
    // with window aspect on its own.
    const cam = camera as THREE.PerspectiveCamera
    const fovRad = THREE.MathUtils.degToRad(cam.fov)
    const margin = 1.15
    const distance = (normalizedHeight * margin) / (2 * Math.tan(fovRad / 2))
    cam.position.set(0, normalizedHeight / 2, distance)
    cam.lookAt(0, normalizedHeight / 2, 0)
  }, [camera, normalizedHeight])

  React.useEffect(() => {
    if (!interactRef) return
    interactRef.current = () => {
      interactUntilRef.current = elapsedRef.current + 1.2
    }
    return () => {
      interactRef.current = null
    }
  }, [interactRef])

  useFrame((frameState, delta) => {
    const t = frameState.clock.getElapsedTime()
    elapsedRef.current = t
    const interacting = t < interactUntilRef.current

    if (!interacting && stateRef.current === 'idle' && t >= nextFlourishAtRef.current) {
      flourishKindRef.current = FLOURISH_KINDS[Math.floor(Math.random() * FLOURISH_KINDS.length)]
      flourishStartRef.current = t
      flourishUntilRef.current = t + 1.8 + Math.random()
      nextFlourishAtRef.current = t + 7 + Math.random() * 10
    }
    const flourishing = !interacting && t < flourishUntilRef.current

    const target = interacting
      ? poseFor('happy', t)
      : flourishing
        ? flourishPoseFor(flourishKindRef.current, t - flourishStartRef.current)
        : poseFor(stateRef.current, t)
    const ease = 1 - Math.exp(-delta * 6)

    for (const key of Object.keys(BONE_NAMES) as BoneKey[]) {
      const bone = vrm.humanoid?.getNormalizedBoneNode(BONE_NAMES[key])
      if (!bone) continue
      const [tx, ty, tz] = target[key] ?? [0, 0, 0]
      const cur = currentPoseRef.current[key]
      cur.x += (tx - cur.x) * ease
      cur.y += (ty - cur.y) * ease
      cur.z += (tz - cur.z) * ease
      quatScratch.current.setFromEuler(cur)
      bone.quaternion.copy(quatScratch.current)
    }

    const expressions = vrm.expressionManager
    if (expressions) {
      const active = interacting
        ? { name: 'happy', weight: 1 }
        : flourishing
          ? FLOURISH_EXPRESSION[flourishKindRef.current]
          : STATE_EXPRESSION[stateRef.current]
      for (const name of EXPRESSION_NAMES) {
        expressions.setValue(name, name === active?.name ? active.weight : 0)
      }
      // Simple mouth-open pulse while speaking — stands in for real lip
      // sync, which would need live viseme data from the TTS audio.
      if (stateRef.current === 'speaking') {
        expressions.setValue('aa', 0.35 + 0.35 * Math.abs(Math.sin(t * 9)))
      } else {
        expressions.setValue('aa', 0)
      }
      // Blink independent of state.
      if (t >= nextBlinkAtRef.current) {
        blinkUntilRef.current = t + 0.12
        nextBlinkAtRef.current = t + 2.5 + Math.random() * 3.5
      }
      const blinking = t < blinkUntilRef.current
      expressions.setValue('blink', blinking ? 1 : 0)
    }

    vrm.update(delta)
  })

  return <primitive object={vrm.scene} />
}

export interface NovaVRMAvatarProps {
  url: string
  state: AssistantState
  className?: string
  /** Lets a parent (e.g. the desktop-companion window's "hold E to
   * interact") trigger a brief happy reaction. */
  interactRef?: React.MutableRefObject<(() => void) | null>
}

class VRMErrorBoundary extends React.Component<{ children: React.ReactNode; onError?: () => void }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() {
    return { error: true }
  }
  componentDidCatch(error: Error) {
    console.error('NovaVRMAvatar failed to load', error)
    this.props.onError?.()
  }
  render() {
    if (this.state.error) return null
    return this.props.children
  }
}

export function NovaVRMAvatar({ url, state, className, interactRef }: NovaVRMAvatarProps) {
  return (
    <div className={className}>
      <Canvas
        camera={{ position: [0, 0.15, 3.4], fov: 32 }}
        dpr={[1, 1.8]}
        gl={{ alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <ambientLight intensity={0.55} color="#e7ecff" />
        <directionalLight position={[2.2, 3.2, 3]} intensity={2} color="#fff2e0" />
        <directionalLight position={[-2.5, 0.8, 1.5]} intensity={0.7} color="#bcdcff" />
        <directionalLight position={[0, 1.5, -3]} intensity={0.75} color="#ffd9f0" />
        <VRMErrorBoundary>
          <React.Suspense fallback={null}>
            <VRMModel url={url} state={state} interactRef={interactRef} />
            <Sparkles count={18} scale={2.8} size={2} speed={0.35} color="#ffd7ec" opacity={0.35} />
            <Environment preset="apartment" environmentIntensity={0.4} />
          </React.Suspense>
        </VRMErrorBoundary>
      </Canvas>
    </div>
  )
}
