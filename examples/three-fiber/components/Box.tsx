import { useFrame, MeshProps } from 'https://esm.sh/@react-three/fiber'
import React, { useRef, useState } from 'react'

export function Box(props: MeshProps) {
  // Set up state for the hovered and active state
  const [hovered, setHover] = useState(false)
  const [active, setActive] = useState(false)

  // This reference will give us direct access to the mesh
  const ref = useRef<any>()

  // Rotate mesh every frame, this is outside of React without overhead
  useFrame(() => {
    ref.current.rotation.x = ref.current.rotation.y += 0.01
  })

  return (
    <mesh
      {...props}
      ref={ref}
      scale={active ? 1.5 : 1}
      onClick={() => setActive(!active)}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={hovered ? 'hotpink' : 'orange'} />
    </mesh>
  )
}
