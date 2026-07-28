import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { getPointCloudPreview, type PointCloudPreview } from '../../api/pointClouds'
import { formatNumber } from '../../utils/format'

type ColorMode = 'source' | 'height' | 'intensity' | 'uniform'

function heightColors(positions: Float32Array): Float32Array {
  const count = positions.length / 3
  let min = Infinity
  let max = -Infinity
  for (let index = 2; index < positions.length; index += 3) {
    min = Math.min(min, positions[index])
    max = Math.max(max, positions[index])
  }
  const span = Math.max(max - min, 1e-6)
  const colors = new Float32Array(count * 3)
  for (let point = 0; point < count; point += 1) {
    const t = (positions[point * 3 + 2] - min) / span
    colors[point * 3] = Math.min(1, Math.max(0.08, 1.7 * t - 0.15))
    colors[point * 3 + 1] = Math.min(0.95, Math.max(0.18, 1.45 - Math.abs(t - 0.52) * 2.2))
    colors[point * 3 + 2] = Math.min(1, Math.max(0.18, 1.25 - 1.45 * t))
  }
  return colors
}

function intensityColors(values: number[]): Float32Array {
  const colors = new Float32Array(values.length * 3)
  values.forEach((value, index) => {
    const channel = Math.max(0.12, Math.min(1, value))
    colors.set([channel, channel * 0.94, Math.min(1, channel * 1.18)], index * 3)
  })
  return colors
}

export function PointCloudViewer({ recordId }: { recordId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const materialRef = useRef<THREE.PointsMaterial | null>(null)
  const geometryRef = useRef<THREE.BufferGeometry | null>(null)
  const [preview, setPreview] = useState<PointCloudPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pointSize, setPointSize] = useState(1.6)
  const [background, setBackground] = useState('#06101f')
  const [colorMode, setColorMode] = useState<ColorMode>('source')

  const positions = useMemo(
    () => preview ? new Float32Array(preview.positions) : null,
    [preview],
  )

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setLoading(true)
    setError('')
    void getPointCloudPreview(recordId, controller.signal)
      .then((data) => {
        if (active) {
          setPreview(data)
          setColorMode(data.has_rgb ? 'source' : 'height')
        }
      })
      .catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : '预览加载失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
      controller.abort()
    }
  }, [recordId])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !preview || !positions) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#06101f')
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100000)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    host.replaceChildren(renderer.domElement)
    rendererRef.current = renderer

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(preview.colors), 3))
    geometry.computeBoundingSphere()
    geometryRef.current = geometry

    const material = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      sizeAttenuation: true,
    })
    materialRef.current = material
    scene.add(new THREE.Points(geometry, material))

    const radius = Math.max(geometry.boundingSphere?.radius ?? 1, 1)
    camera.near = Math.max(radius / 10000, 0.01)
    camera.far = radius * 20
    camera.position.set(radius * 1.15, radius * 0.85, radius * 1.25)
    camera.updateProjectionMatrix()

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    controls.target.set(0, 0, 0)
    controls.update()
    controlsRef.current = controls

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

    let frame = 0
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frame = requestAnimationFrame(animate)
    }
    animate()

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      geometry.dispose()
      material.dispose()
      renderer.renderLists.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      host.replaceChildren()
      scene.clear()
      rendererRef.current = null
      controlsRef.current = null
      materialRef.current = null
      geometryRef.current = null
    }
  }, [positions, preview])

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.size = pointSize
      materialRef.current.needsUpdate = true
    }
  }, [pointSize])

  useEffect(() => {
    if (rendererRef.current) rendererRef.current.setClearColor(background)
  }, [background])

  useEffect(() => {
    const geometry = geometryRef.current
    if (!geometry || !preview || !positions) return
    let colors: Float32Array
    if (colorMode === 'source' && preview.has_rgb) colors = new Float32Array(preview.colors)
    else if (colorMode === 'intensity' && preview.intensities.some((value) => value > 0)) colors = intensityColors(preview.intensities)
    else if (colorMode === 'uniform') {
      colors = new Float32Array(preview.sampled_count * 3)
      for (let index = 0; index < preview.sampled_count; index += 1) colors.set([0.25, 0.68, 1], index * 3)
    } else colors = heightColors(positions)
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geometry.attributes.color.needsUpdate = true
  }, [colorMode, positions, preview])

  return (
    <section className="viewer-panel">
      <div className="viewer-toolbar">
        <label>
          着色
          <select value={colorMode} onChange={(event) => setColorMode(event.target.value as ColorMode)}>
            {preview?.has_rgb && <option value="source">原始 RGB</option>}
            <option value="height">高程</option>
            {preview?.intensities.some((value) => value > 0) && <option value="intensity">强度</option>}
            <option value="uniform">统一颜色</option>
          </select>
        </label>
        <label>
          点大小
          <input type="range" min="0.5" max="5" step="0.1" value={pointSize}
            onChange={(event) => setPointSize(Number(event.target.value))} />
        </label>
        <label>
          背景
          <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} />
        </label>
        <button type="button" onClick={() => controlsRef.current?.reset()}>重置相机</button>
        {preview && <span>{formatNumber(preview.sampled_count)} / {formatNumber(preview.point_count)} 点</span>}
      </div>

      {!preview?.has_rgb && !loading && !error && (
        <p className="viewer-notice">该点云不包含 RGB，当前默认使用高程着色。</p>
      )}
      <div className="viewer-canvas" ref={hostRef}>
        {loading && <div className="viewer-state">正在抽样并加载点云…</div>}
        {error && <div className="viewer-state viewer-error">{error}</div>}
      </div>
      <p className="viewer-help">左键旋转 · 滚轮缩放 · 右键平移</p>
    </section>
  )
}
