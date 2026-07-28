import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { getPointCloudPreview, type PointCloudPreview } from '../../api/pointClouds'
import type { EditorObject, EditorObjectType, EditorPoint } from '../../api/edits'

export type EditorTool = 'orbit' | 'point' | 'polyline' | 'polygon' | 'measurement' | 'annotation'

interface PointCloudEditorProps {
  recordId: string
  tool: EditorTool
  objects: EditorObject[]
  onCreateObject: (object: EditorObject) => void
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach((material) => {
      const withMap = material as THREE.Material & { map?: THREE.Texture }
      withMap.map?.dispose()
      material.dispose()
    })
  })
}

function toVector(point: EditorPoint) {
  return new THREE.Vector3(point.x, point.y, point.z)
}

function createOverlay(objects: EditorObject[]): THREE.Group {
  const group = new THREE.Group()
  objects.forEach((object) => {
    const color = new THREE.Color(object.color)
    if (object.type === 'point' || object.type === 'annotation') {
      const geometry = new THREE.SphereGeometry(object.type === 'annotation' ? 2.2 : 1.4, 14, 10)
      const material = new THREE.MeshBasicMaterial({ color, depthTest: false })
      const marker = new THREE.Mesh(geometry, material)
      marker.position.copy(toVector(object.points[0]))
      marker.renderOrder = 4
      group.add(marker)
      return
    }
    const points = object.points.map(toVector)
    if (object.type === 'polygon' && points.length > 2) points.push(points[0].clone())
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({ color, depthTest: false })
    const line = new THREE.Line(geometry, material)
    line.renderOrder = 3
    group.add(line)
    object.points.forEach((point) => {
      const node = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 10, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      )
      node.position.copy(toVector(point))
      node.renderOrder = 4
      group.add(node)
    })
  })
  return group
}

function requiredPoints(tool: EditorTool) {
  if (tool === 'polygon') return 3
  if (tool === 'polyline' || tool === 'measurement') return 2
  return 1
}

export function PointCloudEditor({ recordId, tool, objects, onCreateObject }: PointCloudEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const pointCloudRef = useRef<THREE.Points | null>(null)
  const overlayRef = useRef<THREE.Group | null>(null)
  const draftRef = useRef<EditorPoint[]>([])
  const [preview, setPreview] = useState<PointCloudPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const pointSize = 1.6
  const positions = useMemo(() => preview ? new Float32Array(preview.positions) : null, [preview])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void getPointCloudPreview(recordId, controller.signal)
      .then((data) => active && setPreview(data))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : '点云加载失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
      controller.abort()
    }
  }, [recordId])

  useEffect(() => {
    draftRef.current = []
    if (controlsRef.current) controlsRef.current.enabled = tool === 'orbit'
  }, [tool])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !preview || !positions) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#050b14')
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    host.replaceChildren(renderer.domElement)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(preview.colors), 3))
    geometry.computeBoundingSphere()
    const material = new THREE.PointsMaterial({ size: pointSize, vertexColors: true, sizeAttenuation: true })
    const pointCloud = new THREE.Points(geometry, material)
    scene.add(pointCloud)
    const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1)
    camera.near = Math.max(radius / 10000, 0.01)
    camera.far = radius * 30
    camera.position.set(radius * 1.15, radius * 0.85, radius * 1.25)
    camera.updateProjectionMatrix()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.enabled = tool === 'orbit'
    controls.update()

    const resize = () => {
      const width = Math.max(host.clientWidth, 1)
      const height = Math.max(host.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    renderer.setAnimationLoop(() => {
      controls.update()
      renderer.render(scene, camera)
    })

    sceneRef.current = scene
    cameraRef.current = camera
    rendererRef.current = renderer
    controlsRef.current = controls
    pointCloudRef.current = pointCloud
    const initialOverlay = createOverlay(objects)
    scene.add(initialOverlay)
    overlayRef.current = initialOverlay

    return () => {
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.dispose()
      scene.remove(pointCloud)
      geometry.dispose()
      material.dispose()
      if (overlayRef.current) {
        scene.remove(overlayRef.current)
        disposeObject(overlayRef.current)
        overlayRef.current = null
      }
      renderer.renderLists.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      host.replaceChildren()
      scene.clear()
      sceneRef.current = null
      cameraRef.current = null
      rendererRef.current = null
      controlsRef.current = null
      pointCloudRef.current = null
    }
  // Tool and point size are updated without recreating the WebGL context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, preview])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    if (overlayRef.current) {
      scene.remove(overlayRef.current)
      disposeObject(overlayRef.current)
    }
    const overlay = createOverlay(objects)
    scene.add(overlay)
    overlayRef.current = overlay
  }, [objects])

  const placeObject = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'orbit' || !cameraRef.current || !rendererRef.current || !pointCloudRef.current) return
    const rect = rendererRef.current.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const raycaster = new THREE.Raycaster()
    raycaster.params.Points.threshold = Math.max(pointCloudRef.current.geometry.boundingSphere?.radius ?? 1, 1) / 180
    raycaster.setFromCamera(pointer, cameraRef.current)
    const hit = raycaster.intersectObject(pointCloudRef.current, false)[0]
    if (!hit) return
    draftRef.current.push({ x: hit.point.x, y: hit.point.y, z: hit.point.z })
    if (draftRef.current.length < requiredPoints(tool)) return
    const type = tool as EditorObjectType
    const label = type === 'measurement'
      ? `${draftRef.current[0] && toVector(draftRef.current[0]).distanceTo(toVector(draftRef.current.at(-1)!)).toFixed(2)} m`
      : type === 'annotation' ? window.prompt('标注内容', '新标注') ?? '新标注' : ''
    onCreateObject({
      id: crypto.randomUUID(),
      type,
      points: [...draftRef.current],
      label,
      color: type === 'measurement' ? '#fbbf24' : type === 'annotation' ? '#fb7185' : '#38bdf8',
      created_at: new Date().toISOString(),
    })
    draftRef.current = []
  }

  return (
    <section className="editor-viewer">
      <div className={`editor-canvas tool-${tool}`} ref={hostRef} onPointerDown={placeObject}>
        {loading && <div className={`viewer-state viewer-loading${preview ? ' is-transitioning' : ''}`}>
          <span className="loading-ring" />
          <strong>{preview ? '正在切换点云' : '正在从 MinIO 加载点云'}</strong>
          <small>读取预览并准备三维场景…</small>
        </div>}
        {error && <div className="viewer-state viewer-error">{error}</div>}
      </div>
    </section>
  )
}
