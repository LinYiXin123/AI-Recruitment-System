import { Canvas, useFrame } from "@react-three/fiber"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react"
import {
  Box3,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Texture,
  Vector3,
} from "three"
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

type Rotation = { x: number; y: number }

const DEFAULT_POSITION = { x: -152, y: -37 }
const DEFAULT_PITCH = 2
const DEFAULT_YAW = 238.2
const DEFAULT_SCALE = 0.7
const PAUSED_YAW = 276.1
const ACTIVE_YAW_MIN = 238.2
const ACTIVE_YAW_MAX = 310

function radians(value: number) {
  return (value * Math.PI) / 180
}

function angleDifference(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

function disposeModel(model: Object3D) {
  const textures = new Set<Texture>()
  const materials = new Set<MeshStandardMaterial>()
  const geometries = new Set<BufferGeometry>()

  model.traverse((node) => {
    if (!(node instanceof Mesh)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof Texture) textures.add(value)
      }
    }
  })

  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  textures.forEach((texture) => {
    texture.dispose()
    if (
      typeof ImageBitmap !== "undefined" &&
      texture.image instanceof ImageBitmap
    )
      texture.image.close()
  })
}

function MascotModel({
  assetBaseUrl,
  rotation,
  modelScale,
  onReady,
  onFailure,
}: {
  assetBaseUrl: string
  rotation: MutableRefObject<Rotation>
  modelScale: MutableRefObject<number>
  onReady: () => void
  onFailure: () => void
}) {
  const root = useRef<Group>(null)
  const [model, setModel] = useState<Group | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const draco = new DRACOLoader()
      .setDecoderPath(`${assetBaseUrl}draco/`)
      .setDecoderConfig({ type: "wasm" })
      .setWorkerLimit(1)
    const loader = new GLTFLoader().setDRACOLoader(draco)
    let cancelled = false
    let loaded: Group | undefined

    fetch(`${assetBaseUrl}models/zhiyu-mascot.glb`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("知遇信封模型暂时不可用")
        return loader.parseAsync(
          await response.arrayBuffer(),
          `${assetBaseUrl}models/`
        )
      })
      .then((gltf) => {
        loaded = gltf.scene
        if (cancelled) {
          disposeModel(loaded)
          return
        }
        const box = new Box3().setFromObject(loaded)
        const size = box.getSize(new Vector3())
        loaded.position.sub(box.getCenter(new Vector3()))
        loaded.scale.setScalar(2.15 / Math.max(size.x, size.y, size.z))
        loaded.traverse((node) => {
          if (!(node instanceof Mesh)) return
          for (const material of Array.isArray(node.material)
            ? node.material
            : [node.material]) {
            if (!(material instanceof MeshStandardMaterial)) continue
            material.metalness = 0
            material.roughness = 0.86
            material.normalScale.setScalar(0.3)
            if (material.map) material.map.anisotropy = 4
          }
        })
        setModel(loaded)
        onReady()
      })
      .catch(() => {
        if (!cancelled) onFailure()
      })
      .finally(() => draco.dispose())

    return () => {
      cancelled = true
      controller.abort()
      draco.dispose()
      if (loaded) disposeModel(loaded)
    }
  }, [assetBaseUrl, onFailure, onReady])

  useFrame(() => {
    if (!root.current) return
    root.current.rotation.x = rotation.current.x
    root.current.rotation.y = rotation.current.y
    root.current.scale.setScalar(modelScale.current)
  })

  return <group ref={root}>{model && <primitive object={model} dispose={null} />}</group>
}

export default function OrbitMascotViewer({
  assetBaseUrl = "/orbit/",
  paused,
}: {
  assetBaseUrl?: string
  paused: boolean
}) {
  const rotation = useRef<Rotation>({
    x: radians(DEFAULT_PITCH),
    y: radians(DEFAULT_YAW),
  })
  const modelScale = useRef(DEFAULT_SCALE)
  const drag = useRef<{ id: number; x: number; y: number } | null>(null)
  const motion = useRef({ phase: 0, wasPaused: paused, wasManual: false })
  const [canRender] = useState(() => {
    const canvas = document.createElement("canvas")
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"))
  })
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const base = `${assetBaseUrl.replace(/\/$/, "")}/`
  const handleReady = useCallback(() => setReady(true), [])
  const handleFailure = useCallback(() => setFailed(true), [])

  useEffect(() => {
    let frame = 0
    let previous = performance.now()
    const animate = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05)
      previous = now
      const animation = motion.current
      if (drag.current) {
        animation.wasManual = true
      } else if (paused) {
        rotation.current.y +=
          angleDifference(rotation.current.y, radians(PAUSED_YAW)) *
          (1 - Math.exp(-2.4 * delta))
        animation.wasManual = false
      } else {
        const centre = radians((ACTIVE_YAW_MIN + ACTIVE_YAW_MAX) / 2)
        const amplitude = radians((ACTIVE_YAW_MAX - ACTIVE_YAW_MIN) / 2)
        if (animation.wasPaused || animation.wasManual) {
          animation.phase = Math.acos(
            Math.max(-1, Math.min(1, (centre - rotation.current.y) / amplitude))
          )
        }
        animation.phase += delta * 0.7
        rotation.current.y = centre - amplitude * Math.cos(animation.phase)
        animation.wasManual = false
      }
      animation.wasPaused = paused
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [paused])

  const release = (id: number) => {
    if (drag.current?.id !== id) return
    drag.current = null
    setDragging(false)
  }

  const rotate = (x: number, y: number) => {
    rotation.current.y += x * 0.012
    rotation.current.x = Math.max(
      -0.55,
      Math.min(0.55, rotation.current.x + y * 0.008)
    )
  }

  const style = {
    "--mascot-offset-x": `${DEFAULT_POSITION.x}px`,
    "--mascot-offset-y": `${DEFAULT_POSITION.y}px`,
  } as CSSProperties

  if (!canRender) return null

  return (
    <div
      className={`orbit-mascot${dragging ? " is-dragging" : ""}`}
      style={style}
      role="group"
      tabIndex={0}
      aria-label="旋转知遇信封"
      aria-describedby="orbit-mascot-instructions"
      data-ready={ready && !failed}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || failed) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        }
        setDragging(true)
      }}
      onPointerMove={(event) => {
        if (drag.current?.id !== event.pointerId) return
        rotate(event.clientX - drag.current.x, event.clientY - drag.current.y)
        drag.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        }
      }}
      onPointerUp={(event) => release(event.pointerId)}
      onPointerCancel={(event) => release(event.pointerId)}
      onLostPointerCapture={(event) => release(event.pointerId)}
      onKeyDown={(event) => {
        const distance = 18
        if (event.key === "ArrowLeft") rotate(-distance, 0)
        else if (event.key === "ArrowRight") rotate(distance, 0)
        else if (event.key === "ArrowUp") rotate(0, -distance)
        else if (event.key === "ArrowDown") rotate(0, distance)
        else return
        event.preventDefault()
      }}
    >
      <Canvas
        aria-hidden="true"
        camera={{ position: [0, 0, 5], fov: 26 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      >
        <ambientLight intensity={1.6} />
        <hemisphereLight args={["#f4f8ff", "#829ec6", 1.6]} />
        <directionalLight position={[3, 4, 5]} intensity={2.4} />
        <directionalLight
          position={[-4, 1, 2]}
          intensity={1.1}
          color="#b7d8ff"
        />
        <MascotModel
          assetBaseUrl={base}
          rotation={rotation}
          modelScale={modelScale}
          onReady={handleReady}
          onFailure={handleFailure}
        />
      </Canvas>
      {!ready && !failed && (
        <span className="orbit-mascot-loading">正在准备信封…</span>
      )}
      {failed && (
        <span className="orbit-mascot-loading">信封暂时未能呈现</span>
      )}
      <span id="orbit-mascot-instructions" className="sr-only">
        拖动或按方向键，旋转知遇信封。
      </span>
    </div>
  )
}
