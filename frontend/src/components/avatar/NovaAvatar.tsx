import * as React from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useFBX, Environment, Sparkles } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { AssistantState } from '../../lib/types'

// ---------------------------------------------------------------------------
// NovaAvatar — NOVA's on-screen presence, a real rigged 3D character
// ("Shinobu.fbx", a VRoid-style export: skinned Body/Face/Hair meshes with
// their own embedded textures) ported from the procureai prototype's
// AnyaAvatar. The base breathing/sway loop still comes from the four Mixamo
// mocap clips (public/models/shinobu/emotions), but each NOVA state also
// applies its own hand-authored, additive bone rotation on top (see
// PROCEDURAL_POSES) — layered onto the mocap pose after the mixer updates
// each frame — so LISTENING/THINKING/SPEAKING/HAPPY/CONFUSED/ERROR each move
// visibly different body parts (head tilt/turn, arm raises, gestures)
// instead of just reusing the same four clips at different speeds.
//
// Cloning a rigged FBX needs SkeletonUtils' clone() rather than plain
// Object3D.clone() — the naive clone doesn't rebind a SkinnedMesh's skeleton
// to the newly cloned bones, which otherwise silently renders nothing.
// ---------------------------------------------------------------------------

// Relative, not "/models/..." — an absolute path resolves against the OS
// filesystem root under Electron's file:// packaged load (see vite.config.ts's
// `base: './'` comment for the same issue at the HTML level; this is the
// same bug in a hand-written string Vite's base rewriting never touches).
const MODEL_URL = './models/shinobu/shinobu.fbx'

const ANIMATION_URLS = {
  idle: './models/shinobu/emotions/idle.fbx',
  focus: './models/shinobu/emotions/focus.fbx',
  angry: './models/shinobu/emotions/angry.fbx',
  annoyedShake: './models/shinobu/emotions/annoyed-shake.fbx',
} as const

// Base looping mocap clip each state rides on top of, before the additive
// procedural pose (below) is layered on.
const STATE_BASE_CLIPS: Record<AssistantState, { clip: keyof typeof ANIMATION_URLS; timeScale: number }> = {
  idle: { clip: 'idle', timeScale: 1 },
  listening: { clip: 'idle', timeScale: 0.9 },
  thinking: { clip: 'idle', timeScale: 0.6 },
  speaking: { clip: 'focus', timeScale: 0.9 },
  happy: { clip: 'focus', timeScale: 1.2 },
  confused: { clip: 'idle', timeScale: 0.8 },
  error: { clip: 'angry', timeScale: 0.8 },
}

type BoneKey =
  | 'Head'
  | 'Neck'
  | 'Spine'
  | 'Spine1'
  | 'Spine2'
  | 'Hips'
  | 'LeftArm'
  | 'RightArm'
  | 'LeftForeArm'
  | 'RightForeArm'

const BONE_NAMES: BoneKey[] = [
  'Head',
  'Neck',
  'Spine',
  'Spine1',
  'Spine2',
  'Hips',
  'LeftArm',
  'RightArm',
  'LeftForeArm',
  'RightForeArm',
]

type Pose = Partial<Record<BoneKey, [number, number, number]>>

/**
 * Hand-authored additive rotation (radians, XYZ euler) per bone, applied on
 * top of whatever the base mocap clip already put the skeleton at. `t` is
 * elapsed seconds, used to drive each state's own idle motion so it never
 * looks like a frozen photo.
 */
function poseFor(state: AssistantState, t: number): Pose {
  switch (state) {
    case 'listening':
      // Attentive: head turns gently toward the "speaker", slight lean in.
      return {
        Head: [0.04 + 0.03 * Math.sin(t * 1.6), 0.22 * Math.sin(t * 0.7), 0.02],
        Neck: [0.02, 0.08 * Math.sin(t * 0.7), 0],
        Spine2: [0.05, 0, 0],
      }
    case 'thinking':
      // Pondering: head drops and turns away, one arm raises toward the chin.
      return {
        Head: [0.32 + 0.03 * Math.sin(t * 1.1), 0.32, 0.16],
        Neck: [0.12, 0.16, 0.06],
        Spine1: [0.04, 0.05, 0],
        RightArm: [0.1, 0, -0.55],
        RightForeArm: [0, 0.1, -1.15],
      }
    case 'speaking':
      // Talking with her hands: rhythmic head bob (stands in for lip sync
      // with no viseme blendshapes available) plus alternating arm gesture.
      return {
        Head: [0.05 * Math.sin(t * 5.2), 0.09 * Math.sin(t * 2.6), 0],
        Neck: [0.03 * Math.sin(t * 5.2), 0, 0],
        LeftArm: [0.05, 0, 0.22 * Math.sin(t * 3.4)],
        RightArm: [0.05, 0, -0.22 * Math.sin(t * 3.4 + 1.2)],
        LeftForeArm: [0, 0, 0.18 * Math.sin(t * 3.4 + 0.6)],
        RightForeArm: [0, 0, -0.18 * Math.sin(t * 3.4 + 1.8)],
      }
    case 'happy':
      // Both arms lift, a little bounce and head perk — reads as excited.
      return {
        Head: [-0.12 + 0.04 * Math.sin(t * 4), 0.05 * Math.sin(t * 2), 0],
        LeftArm: [0.1, 0, 0.95 + 0.08 * Math.sin(t * 5)],
        RightArm: [0.1, 0, -0.95 - 0.08 * Math.sin(t * 5 + 1)],
        LeftForeArm: [0, 0, 0.25],
        RightForeArm: [0, 0, -0.25],
        Spine: [0, 0, 0.02 * Math.sin(t * 5)],
        Hips: [0.035 * Math.abs(Math.sin(t * 5)), 0, 0],
      }
    case 'confused':
      // Bigger, slower head tilt-and-shake than idle's subtle sway.
      return {
        Head: [0.06, 0.4 * Math.sin(t * 1.3), 0.22],
        Neck: [0.03, 0.14 * Math.sin(t * 1.3), 0.06],
        Spine1: [0, 0.06 * Math.sin(t * 1.3), 0],
      }
    case 'error':
      // A firm "no" head-shake with tensed, slightly crossed arms.
      return {
        Head: [0.14, 0.45 * Math.sin(t * 3.2), 0],
        Neck: [0.05, 0.16 * Math.sin(t * 3.2), 0],
        LeftArm: [0.05, 0, 0.35],
        RightArm: [0.05, 0, -0.35],
        Spine1: [0.05, 0, 0],
      }
    default:
      return {}
  }
}

function NovaModel({
  state,
  waveTriggerRef,
}: {
  state: AssistantState
  waveTriggerRef: React.MutableRefObject<(() => void) | null>
}) {
  const fbx = useFBX(MODEL_URL)
  const animFbx = {
    idle: useFBX(ANIMATION_URLS.idle),
    focus: useFBX(ANIMATION_URLS.focus),
    angry: useFBX(ANIMATION_URLS.angry),
    annoyedShake: useFBX(ANIMATION_URLS.annoyedShake),
  }
  const groupRef = React.useRef<THREE.Group>(null)
  const { camera } = useThree()
  const activeActionRef = React.useRef<THREE.AnimationAction | null>(null)

  const { model, normalizedHeight } = React.useMemo(() => {
    const cloned = cloneSkinned(fbx) as THREE.Group

    cloned.traverse((child: THREE.Object3D) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.frustumCulled = false
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats as THREE.MeshStandardMaterial[]) {
          m.side = THREE.DoubleSide
          m.roughness = 0.65
          m.metalness = 0.03
          m.envMapIntensity = 0.6
          m.needsUpdate = true
        }
      }
    })

    const box = new THREE.Box3().setFromObject(cloned)
    const size = new THREE.Vector3()
    box.getSize(size)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    const scale = 3.1 / maxDim
    cloned.scale.setScalar(scale)
    cloned.position.set(-center.x * scale, -box.min.y * scale - (size.y * scale) / 2 + 0.15, -center.z * scale)

    return { model: cloned, normalizedHeight: size.y * scale }
  }, [fbx])

  // Bone lookup for the procedural additive poses — names come off the rig
  // as "mixamorig:Head" etc.
  const bones = React.useMemo(() => {
    const map: Partial<Record<BoneKey, THREE.Bone>> = {}
    model.traverse((child: THREE.Object3D) => {
      const bone = child as THREE.Bone
      if (!bone.isBone) return
      const short = bone.name.replace('mixamorig:', '') as BoneKey
      if (BONE_NAMES.includes(short)) map[short] = bone
    })
    return map
  }, [model])

  // Eased-toward-target euler per bone, so switching state doesn't pop the
  // pose instantly — it settles into the new gesture over a few frames.
  const currentPoseRef = React.useRef<Record<BoneKey, THREE.Euler>>(
    Object.fromEntries(BONE_NAMES.map((k) => [k, new THREE.Euler()])) as Record<BoneKey, THREE.Euler>
  )
  const poseQuatScratch = React.useRef(new THREE.Quaternion())

  // One AnimationMixer driving Shinobu's own skeleton, fed by clips lifted
  // from the four Mixamo FBX files above (each is skeleton-only — no mesh —
  // so we only ever read .animations[0] off it, never render it).
  const { mixer, actions } = React.useMemo(() => {
    const m = new THREE.AnimationMixer(model)
    const a: Partial<Record<keyof typeof ANIMATION_URLS, THREE.AnimationAction>> = {}
    for (const key of Object.keys(animFbx) as (keyof typeof ANIMATION_URLS)[]) {
      const sourceClip = animFbx[key].animations[0]
      if (!sourceClip) continue
      // Drop any leg/foot/toe rotation tracks — on a short/stylized rig a
      // full-body mocap hip-sway reads as a twisted, floating stance rather
      // than a subtle idle sway. Keeps her standing normally while the
      // upper-body motion (spine, arms, head) still plays in full.
      const tracks = sourceClip.tracks.filter((track) => !/(UpLeg|Leg|Foot|Toe)/i.test(track.name))
      const clip = new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks)
      const action = m.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Infinity)
      a[key] = action
    }
    return { mixer: m, actions: a }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  const stateRef = React.useRef(state)
  stateRef.current = state
  const isGesturingRef = React.useRef(false)

  /** Base (looping) clip for whatever NOVA state is currently active. */
  const playBaseClip = React.useCallback(
    (immediate: boolean) => {
      const { clip, timeScale } = STATE_BASE_CLIPS[stateRef.current]
      const next = actions[clip]
      if (!next) return
      const prev = activeActionRef.current
      next.setLoop(THREE.LoopRepeat, Infinity)
      next.timeScale = timeScale
      next.reset().play()
      if (!immediate && prev && prev !== next) {
        next.crossFadeFrom(prev, 0.5, true)
      } else {
        next.fadeIn(immediate ? 0 : 0.4)
      }
      activeActionRef.current = next
    },
    [actions]
  )

  /** Play one clip once, interrupting whatever's active, then hand back to the base clip. */
  const playOneShot = React.useCallback(
    (key: keyof typeof ANIMATION_URLS, fade = 0.4) => {
      const gesture = actions[key]
      const prev = activeActionRef.current
      if (!gesture || gesture === prev) return
      gesture.setLoop(THREE.LoopOnce, 1)
      gesture.clampWhenFinished = true
      gesture.timeScale = 1
      gesture.reset().fadeIn(fade).play()
      if (prev) gesture.crossFadeFrom(prev, fade, false)
      activeActionRef.current = gesture
      isGesturingRef.current = true
    },
    [actions]
  )

  // First clip ever assigned should be fully visible immediately — fading it
  // in from weight 0 with nothing underneath briefly shows the FBX's raw bind
  // pose (a T-pose), which reads as "broken" for an instant on every load.
  const mountedRef = React.useRef(false)
  React.useEffect(() => {
    playBaseClip(!mountedRef.current)
    mountedRef.current = true
  }, [state, playBaseClip])

  // Idle personality flourishes: every so often while just standing around,
  // play one of the other clips once as a one-shot gesture instead of only
  // ever breathing in place, then settle back into the idle loop. Only fires
  // in the idle state so it never fights with a real state-driven clip.
  const nextGestureAtRef = React.useRef(6 + Math.random() * 6)
  const elapsedRef = React.useRef(0)

  React.useEffect(() => {
    const onFinished = (event: { action: THREE.AnimationAction }) => {
      if (!isGesturingRef.current || event.action !== activeActionRef.current) return
      isGesturingRef.current = false
      playBaseClip(false)
      nextGestureAtRef.current = elapsedRef.current + 10 + Math.random() * 8
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [mixer, playBaseClip])

  // Reaction on click — exposed imperatively rather than as an R3F onClick on
  // the mesh itself, because decorative overlays could sit in front of the
  // model from the camera's point of view. The outer DOM container's onClick
  // (see <NovaAvatar>) calls this for any click anywhere in the viewport.
  React.useEffect(() => {
    waveTriggerRef.current = () => {
      if (isGesturingRef.current) return
      playOneShot('angry', 0.25)
    }
    return () => {
      waveTriggerRef.current = null
    }
  }, [playOneShot, waveTriggerRef])

  useFrame((frameState, delta) => {
    mixer.update(delta)
    elapsedRef.current = frameState.clock.getElapsedTime()

    // Idle-only personality gestures (mocap one-shots), unrelated to the
    // procedural poses below.
    if (state === 'idle' && !isGesturingRef.current && elapsedRef.current >= nextGestureAtRef.current) {
      const options = (['focus', 'angry', 'annoyedShake'] as const).filter((key) => actions[key])
      if (options.length > 0) playOneShot(options[Math.floor(Math.random() * options.length)])
    }

    // Additive procedural pose: ease each bone's euler toward this state's
    // target, then rotate it on top of whatever the mocap clip already set.
    const target = isGesturingRef.current ? {} : poseFor(state, elapsedRef.current)
    const ease = 1 - Math.exp(-delta * 6)
    for (const key of BONE_NAMES) {
      const bone = bones[key]
      if (!bone) continue
      const [tx, ty, tz] = target[key] ?? [0, 0, 0]
      const cur = currentPoseRef.current[key]
      cur.x += (tx - cur.x) * ease
      cur.y += (ty - cur.y) * ease
      cur.z += (tz - cur.z) * ease
      if (Math.abs(cur.x) < 1e-4 && Math.abs(cur.y) < 1e-4 && Math.abs(cur.z) < 1e-4) continue
      poseQuatScratch.current.setFromEuler(cur)
      bone.quaternion.multiply(poseQuatScratch.current)
    }
  })

  React.useEffect(() => {
    // Fit-to-frame (see NovaVRMAvatar's identical fix for why): solve the
    // distance where the model's full height fills the camera's vertical
    // FOV plus a small padding margin, instead of a fixed distance that
    // only looks right in one particular window aspect ratio. The model is
    // vertically centered around world y=0.15 (see the position offset
    // above), not y=0.
    const cam = camera as THREE.PerspectiveCamera
    const fovRad = THREE.MathUtils.degToRad(cam.fov)
    const margin = 1.15
    const distance = (normalizedHeight * margin) / (2 * Math.tan(fovRad / 2))
    cam.position.set(0, 0.15, distance)
    cam.lookAt(0, 0.15, 0)
  }, [camera, normalizedHeight])

  return (
    <group ref={groupRef}>
      <primitive object={model} />
    </group>
  )
}

export interface NovaAvatarProps {
  state: AssistantState
  className?: string
  /** Lets a parent (e.g. the desktop-companion window's "hold E to
   * interact") trigger the same reaction as clicking her. */
  interactRef?: React.MutableRefObject<(() => void) | null>
}

/** If the 3D model fails to load for any reason, fail silently rather than taking the whole app down. */
class AvatarErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('NovaAvatar failed to load', error)
  }
  render() {
    if (this.state.error) return null
    return this.props.children
  }
}

export function NovaAvatar({ state, className, interactRef }: NovaAvatarProps) {
  const internalRef = React.useRef<(() => void) | null>(null)
  const waveTriggerRef = interactRef ?? internalRef
  return (
    <div className={className} onClick={() => waveTriggerRef.current?.()} style={{ cursor: 'pointer' }}>
      <Canvas
        camera={{ position: [0, 0.15, 4.6], fov: 38 }}
        dpr={[1, 1.8]}
        gl={{ alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
      >
        <ambientLight intensity={0.5} color="#e7ecff" />
        <directionalLight position={[2.2, 3.2, 3]} intensity={2} color="#fff2e0" />
        <directionalLight position={[-2.5, 0.8, 1.5]} intensity={0.7} color="#bcdcff" />
        <directionalLight position={[0, 1.5, -3]} intensity={0.75} color="#ffd9f0" />
        <AvatarErrorBoundary>
          <React.Suspense fallback={null}>
            <NovaModel state={state} waveTriggerRef={waveTriggerRef} />
            <Sparkles count={22} scale={3.2} size={2} speed={0.35} color="#ffd7ec" opacity={0.4} />
            <Environment preset="apartment" environmentIntensity={0.4} />
          </React.Suspense>
        </AvatarErrorBoundary>
      </Canvas>
    </div>
  )
}

useFBX.preload(MODEL_URL)
for (const url of Object.values(ANIMATION_URLS)) useFBX.preload(url)
