import { useRef, type CSSProperties } from "react"
import { useInView } from "framer-motion"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import "./avatar-orbit.css"

export interface OrbitMember {
  id: string | number
  name: string
  avatar?: string
}

function AvatarRing({
  members,
  index,
  onSelect,
}: {
  members: OrbitMember[]
  index: number
  onSelect?: (member: OrbitMember) => void
}) {
  const Member = onSelect ? "button" : "span"
  return (
    <ul
      className="avatar-orbit__ring"
      aria-label={`第 ${index + 1} 圈`}
      style={
        {
          "--diameter": `${36 + index * 26}%`,
          "--duration": `${22 + index * 8}s`,
          "--direction": index % 2 ? "reverse" : "normal",
        } as CSSProperties
      }
    >
      {members.map((member, position) => {
        const angle = (Math.PI * 2 * position) / members.length - Math.PI / 2
        return (
          <li
            key={member.id}
            className="avatar-orbit__item"
            style={{
              left: `${50 + 50 * Math.cos(angle)}%`,
              top: `${50 + 50 * Math.sin(angle)}%`,
            }}
          >
            <Member
              className="avatar-orbit__avatar"
              type={onSelect ? "button" : undefined}
              role={onSelect ? undefined : "img"}
              aria-label={onSelect ? `查看 ${member.name} 的信息` : member.name}
              title={member.name}
              onClick={onSelect ? () => onSelect(member) : undefined}
            >
              <Avatar className="size-full" aria-hidden="true">
                <AvatarImage src={member.avatar} alt="" />
                <AvatarFallback>{member.name.slice(0, 1)}</AvatarFallback>
              </Avatar>
            </Member>
          </li>
        )
      })}
    </ul>
  )
}

/** 同步旋转圆环与反向旋转头像，暂停和恢复时保持头像正立。 */
export function AvatarOrbit({
  members,
  label = "团队成员",
  onSelect,
}: {
  members: OrbitMember[]
  label?: string
  onSelect?: (member: OrbitMember) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const rings = [
    members.slice(0, 8),
    members.slice(8, 20),
    members.slice(20),
  ].filter((ring) => ring.length)
  return (
    <div ref={ref} className="avatar-orbit" data-paused={!inView}>
      <div
        className="avatar-orbit__stage"
        role="group"
        aria-label={`${members.length} 位${label}的头像轨道`}
        tabIndex={0}
      >
        <div className="avatar-orbit__glow" aria-hidden="true" />
        {rings.map((_, index) => (
          <div
            key={index}
            className="avatar-orbit__path"
            aria-hidden="true"
            style={{ width: `${36 + index * 26}%` }}
          />
        ))}
        <div className="avatar-orbit__center" aria-hidden="true">
          <strong>{members.length}</strong>
          <span>{label}</span>
        </div>
        {rings.map((ring, index) => (
          <AvatarRing
            key={index}
            members={ring}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
