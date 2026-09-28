import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import {
  Color,
  Euler,
  Quaternion,
  SRGBColorSpace,
  type Group,
  type ShaderMaterial,
  type Texture,
} from "three"

// 三维位置保留真实前后层，单颗粒用圆形点着色；无需为每个点绘制实体网格。
const vertexShader = `
  attribute vec3 logoColor;
  attribute float particleSize;
  uniform float pixelHeight;
  varying vec3 particleColor;
  void main() {
    particleColor = logoColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // 当前场景使用正交相机，尺寸跟随相机缩放及实际画布像素密度。
    gl_PointSize = max(1.0, particleSize * pixelHeight * 0.5 * projectionMatrix[1][1] * length(modelMatrix[0].xyz));
  }
`
const fragmentShader = `
  varying vec3 particleColor;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float radius = dot(p, p);
    if (radius > 1.0) discard;
    vec3 normal = vec3(p.x, -p.y, sqrt(1.0 - radius));
    float light = max(dot(normal, normalize(vec3(-0.5, 0.7, 1.0))), 0.0);
    float glint = pow(light, 18.0) * 0.12;
    gl_FragColor = vec4(particleColor * (0.72 + light * 0.38) + glint, 1.0);
    #include <colorspace_fragment>
  }
`

type ParticleLogoProps = {
  texture: Texture
  width: number
  compact: boolean
  moving: boolean
}

// 原图只作为形状与颜色来源，不作为平面贴图显示，也不修改原始品牌素材。
function sampleLogo(texture: Texture, width: number, compact: boolean) {
  const source = texture.image as HTMLImageElement
  const canvas = document.createElement("canvas")
  canvas.width = compact ? 112 : 160
  canvas.height = Math.max(
    1,
    Math.round((canvas.width * source.naturalHeight) / source.naturalWidth)
  )
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) throw new Error("无法读取品牌轮廓")
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const pixels: { x: number; y: number; r: number; g: number; b: number }[] = []
  let left = canvas.width
  let right = 0
  let top = canvas.height
  let bottom = 0

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4
      const [r, g, b, alpha] = data.subarray(offset, offset + 4)
      const brightest = Math.max(r, g, b)
      const darkest = Math.min(r, g, b)
      // 透明处、白底及白底抗锯齿边缘不生成任何几何体。
      if (
        alpha < 100 ||
        darkest > 215 ||
        (brightest > 190 && brightest - darkest < 28)
      )
        continue
      pixels.push({ x, y, r, g, b })
      left = Math.min(left, x)
      right = Math.max(right, x)
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
    }
  }

  if (!pixels.length) throw new Error("品牌轮廓为空")
  const spacing = width / (right - left + 1)
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  const depth = width * 0.038
  const layers = compact ? 2 : 3
  const color = new Color()
  const positions = new Float32Array(pixels.length * layers * 3)
  const sizes = new Float32Array(pixels.length * layers)
  const colors = new Float32Array(pixels.length * layers * 3)

  for (let layer = 0; layer < layers; layer += 1) {
    const z = depth * (layer / (layers - 1) - 0.5)
    for (let index = 0; index < pixels.length; index += 1) {
      const pixel = pixels[index]
      const id = layer * pixels.length + index
      const seed = Math.sin(pixel.x * 12.9898 + pixel.y * 78.233 + layer * 13.7)
      const variation = seed * 0.08
      positions[id * 3] = (pixel.x - centerX + variation) * spacing
      positions[id * 3 + 1] = (centerY - pixel.y + variation) * spacing
      positions[id * 3 + 2] = z + seed * spacing * 0.18
      // 有微小间隙的晶粒，前后层错位后可看见真实厚度。
      sizes[id] = spacing * (0.98 + seed * 0.13)
      color.setRGB(pixel.r / 255, pixel.g / 255, pixel.b / 255, SRGBColorSpace)
      color.multiplyScalar(layer === layers - 1 ? 1 : 0.62 + layer * 0.06)
      color.toArray(colors, id * 3)
    }
  }

  return { positions, sizes, colors }
}

export default function ParticleLogo({
  texture,
  width,
  compact,
  moving,
}: ParticleLogoProps) {
  const facing = useRef<Group>(null)
  const sculpture = useRef<Group>(null)
  const material = useRef<ShaderMaterial>(null)
  const time = useRef(0)
  const uniforms = useMemo(() => ({ pixelHeight: { value: 1 } }), [])
  const orientation = useMemo(
    () => ({
      parent: new Quaternion(),
      euler: new Euler(),
    }),
    []
  )
  const samples = useMemo(
    () => sampleLogo(texture, width, compact),
    [texture, width, compact]
  )

  useFrame(({ camera, size, gl }, delta) => {
    if (material.current)
      material.current.uniforms.pixelHeight.value =
        size.height * gl.getPixelRatio()
    if (!facing.current || !sculpture.current) return
    if (moving) time.current += Math.min(delta, 0.05)
    // 补偿环带姿态，保留可阅读的正面；微微转动展示颗粒雕塑侧面。
    facing.current.parent?.getWorldQuaternion(orientation.parent)
    facing.current.quaternion
      .copy(orientation.parent.invert())
      .multiply(camera.quaternion)
    orientation.euler.set(
      -0.12 + Math.sin(time.current * 0.65) * 0.09,
      0.2 + Math.sin(time.current * 0.48) * 0.18,
      -0.025 + Math.sin(time.current * 0.38) * 0.025
    )
    sculpture.current.quaternion.setFromEuler(orientation.euler)
  })

  return (
    <group ref={facing} name="particle-logo">
      <group ref={sculpture}>
        <points name="logo-volume">
          <bufferGeometry key={`${texture.uuid}:${width}:${compact}`}>
            <bufferAttribute
              attach="attributes-position"
              args={[samples.positions, 3]}
            />
            <bufferAttribute
              attach="attributes-logoColor"
              args={[samples.colors, 3]}
            />
            <bufferAttribute
              attach="attributes-particleSize"
              args={[samples.sizes, 1]}
            />
          </bufferGeometry>
          <shaderMaterial
            ref={material}
            uniforms={uniforms}
            vertexShader={vertexShader}
            fragmentShader={fragmentShader}
            toneMapped={false}
            depthTest
            depthWrite
          />
        </points>
      </group>
    </group>
  )
}
