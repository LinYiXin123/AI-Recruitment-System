import { useEffect, useMemo, useRef } from "react"
import { useFrame, useLoader } from "@react-three/fiber"
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  TextureLoader,
  type Group,
} from "three"

type BrandOrbitSystemProps = {
  auto: boolean
  compact: boolean
  reduced: boolean
}

type OrbitDefinition = {
  color: string
  logo: string
  logoHeight: number
  logoWidth: number
  particleCount: number
  phase: number
  radius: number
  speed: number
  tilt: [number, number, number]
}

const orbitDefinitions: OrbitDefinition[] = [
  {
    color: "#58a8ff",
    logo: "/orbit/brands/livzon-logo.webp",
    logoHeight: 0.25,
    logoWidth: 0.76,
    particleCount: 76,
    phase: 0.28,
    radius: 2.48,
    speed: 0.16,
    tilt: [0.86, 0.18, -0.22],
  },
  {
    color: "#65c7a0",
    logo: "/orbit/brands/joincare-logo.webp",
    logoHeight: 0.24,
    logoWidth: 0.73,
    particleCount: 68,
    phase: 2.35,
    radius: 2.62,
    speed: 0.16,
    tilt: [0.34, 1.08, 0.48],
  },
  {
    color: "#7dd8ff",
    logo: "/orbit/brands/third-logo.png",
    logoHeight: 0.24,
    logoWidth: 0.86,
    particleCount: 82,
    phase: 1.08,
    radius: 2.74,
    speed: 0.16,
    tilt: [1.03, 0.7, -0.7],
  },
]

function makeParticleGeometry(definition: OrbitDefinition) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(definition.particleCount * 3)

  for (let index = 0; index < definition.particleCount; index += 1) {
    const progress = index / definition.particleCount
    const angle = progress * Math.PI * 2
    const shimmer = 0.015 * Math.sin(index * 12.9898 + definition.radius * 7)
    const radius = definition.radius + shimmer
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = Math.sin(angle) * radius
    positions[index * 3 + 2] = 0
  }

  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  return geometry
}

function BrandOrbit({
  definition,
  logo,
  auto,
  compact,
  reduced,
}: {
  definition: OrbitDefinition
  logo: ReturnType<TextureLoader["load"]>
  auto: boolean
  compact: boolean
  reduced: boolean
}) {
  const traveller = useRef<Group>(null)
  const angle = useRef(definition.phase)
  const particles = useMemo(
    () => makeParticleGeometry(definition),
    [definition]
  )
  const trail = useMemo(
    () =>
      Array.from({ length: compact ? 7 : 11 }, (_, index) => {
        const offset = (index + 1) * (compact ? 0.038 : 0.032)
        return {
          opacity: Math.max(0.045, 0.36 - index * 0.028),
          position: [
            Math.cos(-offset) * definition.radius,
            Math.sin(-offset) * definition.radius,
            0,
          ] as [number, number, number],
          scale: Math.max(0.018, 0.056 - index * 0.0033),
        }
      }),
    [compact, definition.radius]
  )

  useEffect(() => () => particles.dispose(), [particles])

  useFrame((_, delta) => {
    if (!traveller.current) return
    if (auto && !reduced) {
      angle.current += definition.speed * Math.min(delta, 0.05)
    }
    traveller.current.rotation.z = angle.current
  })

  const logoScale = compact ? 0.82 : 1

  return (
    <group rotation={definition.tilt}>
      <mesh renderOrder={1}>
        <torusGeometry
          args={[definition.radius, compact ? 0.018 : 0.024, 6, 192]}
        />
        <meshBasicMaterial
          color={definition.color}
          transparent
          opacity={compact ? 0.29 : 0.4}
          depthTest
          depthWrite={false}
        />
      </mesh>
      <mesh renderOrder={0}>
        <torusGeometry
          args={[definition.radius, compact ? 0.042 : 0.062, 6, 160]}
        />
        <meshBasicMaterial
          color={definition.color}
          transparent
          opacity={compact ? 0.04 : 0.07}
          blending={AdditiveBlending}
          depthTest
          depthWrite={false}
        />
      </mesh>
      <points geometry={particles} renderOrder={2}>
        <pointsMaterial
          color={definition.color}
          size={compact ? 0.034 : 0.048}
          sizeAttenuation
          transparent
          opacity={compact ? 0.58 : 0.78}
          blending={AdditiveBlending}
          depthTest
          depthWrite={false}
        />
      </points>

      <group ref={traveller} rotation={[0, 0, definition.phase]}>
        <mesh rotation={[0, 0, -0.68]} renderOrder={3}>
          <torusGeometry
            args={[definition.radius, compact ? 0.028 : 0.042, 6, 48, 0.68]}
          />
          <meshBasicMaterial
            color={definition.color}
            transparent
            opacity={compact ? 0.12 : 0.2}
            blending={AdditiveBlending}
            depthTest
            depthWrite={false}
          />
        </mesh>
        {trail.map((particle, index) => (
          <mesh
            // 粒子固定在轨道坐标中，整体旋转形成连续拖尾。
            key={index}
            position={particle.position}
            scale={particle.scale}
            renderOrder={3}
          >
            <sphereGeometry args={[1, 7, 7]} />
            <meshBasicMaterial
              color={definition.color}
              transparent
              opacity={particle.opacity}
              blending={AdditiveBlending}
              depthTest
              depthWrite={false}
            />
          </mesh>
        ))}
        <group position={[definition.radius, 0, 0]}>
          <sprite
            scale={[
              definition.logoWidth * logoScale * 1.18,
              definition.logoHeight * logoScale * 1.32,
              1,
            ]}
            renderOrder={4}
          >
            <spriteMaterial
              color={definition.color}
              transparent
              opacity={0.22}
              blending={AdditiveBlending}
              depthTest
              depthWrite={false}
            />
          </sprite>
          <sprite
            scale={[
              definition.logoWidth * logoScale * 1.08,
              definition.logoHeight * logoScale * 1.14,
              1,
            ]}
            renderOrder={5}
          >
            <spriteMaterial
              color="#ffffff"
              transparent
              opacity={0.9}
              depthTest
              depthWrite={false}
            />
          </sprite>
          <sprite
            scale={[
              definition.logoWidth * logoScale,
              definition.logoHeight * logoScale,
              1,
            ]}
            renderOrder={6}
          >
            <spriteMaterial
              map={logo}
              color="#ffffff"
              transparent
              alphaTest={0.015}
              toneMapped={false}
              depthTest
              depthWrite={false}
            />
          </sprite>
        </group>
      </group>
    </group>
  )
}

export default function BrandOrbitSystem({
  auto,
  compact,
  reduced,
}: BrandOrbitSystemProps) {
  const logos = useLoader(
    TextureLoader,
    orbitDefinitions.map((definition) => definition.logo)
  )
  const preparedLogos = useMemo(
    () =>
      logos.map((logo) => {
        const prepared = logo.clone()
        prepared.colorSpace = SRGBColorSpace
        prepared.minFilter = LinearMipmapLinearFilter
        prepared.anisotropy = 8
        prepared.needsUpdate = true
        return prepared
      }),
    [logos]
  )

  useEffect(
    () => () => {
      for (const logo of preparedLogos) logo.dispose()
    },
    [preparedLogos]
  )

  return (
    // 组件挂在地球的球心父组内，因此每条轨道共用同一个局部原点 [0, 0, 0]。
    <group name="brand-orbits" scale={compact ? 0.96 : 1}>
      {orbitDefinitions.map((definition, index) => (
        <BrandOrbit
          key={definition.logo}
          definition={definition}
          logo={preparedLogos[index]}
          auto={auto}
          compact={compact}
          reduced={reduced}
        />
      ))}
    </group>
  )
}
