import { useEffect, useState } from 'react'
import { getPointCloud, type PointCloud } from '../api/pointClouds'
import { PointCloudViewer } from '../components/viewer/PointCloudViewer'
import { formatBytes, formatCoordinate, formatDate, formatNumber } from '../utils/format'

export default function PointCloudDetailPage({
  recordId,
  onBack,
}: {
  recordId: string
  onBack: () => void
}) {
  const [record, setRecord] = useState<PointCloud | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setError('')
    void getPointCloud(recordId)
      .then((data) => active && setRecord(data))
      .catch((requestError) => active && setError(requestError instanceof Error ? requestError.message : '详情加载失败'))
    return () => { active = false }
  }, [recordId])

  if (error) {
    return (
      <section className="panel detail-state">
        <strong>无法打开点云</strong>
        <p>{error}</p>
        <button className="primary-button" type="button" onClick={onBack}>返回列表</button>
      </section>
    )
  }

  if (!record) return <section className="panel detail-state">正在加载点云详情…</section>

  return (
    <div className="content-stack">
      <button className="back-button" type="button" onClick={onBack}>← 返回点云列表</button>

      <section className="detail-heading">
        <div>
          <span className="section-kicker">POINT CLOUD DETAIL</span>
          <h1>{record.original_name}</h1>
          <p>上传于 {formatDate(record.created_at)} · SHA-256 {record.sha256.slice(0, 16)}…</p>
        </div>
        <span className={`status-pill status-${record.status.toLowerCase()}`}>{record.status}</span>
      </section>

      <section className="metadata-grid">
        <article><span>文件大小</span><strong>{formatBytes(record.size_bytes)}</strong></article>
        <article><span>点数量</span><strong>{formatNumber(record.point_count)}</strong></article>
        <article><span>LAS / 点格式</span><strong>{record.las_version} / {record.point_format}</strong></article>
        <article><span>颜色数据</span><strong>{record.has_rgb ? 'RGB' : record.has_intensity ? '强度 + 高程' : '高程'}</strong></article>
      </section>

      <PointCloudViewer recordId={record.id} />

      <section className="panel coordinates-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">原始坐标</span>
            <h2>坐标范围与精度</h2>
          </div>
        </div>
        <dl>
          <div><dt>X</dt><dd>{formatCoordinate(record.min_x)} ～ {formatCoordinate(record.max_x)}</dd></div>
          <div><dt>Y</dt><dd>{formatCoordinate(record.min_y)} ～ {formatCoordinate(record.max_y)}</dd></div>
          <div><dt>Z</dt><dd>{formatCoordinate(record.min_z)} ～ {formatCoordinate(record.max_z)}</dd></div>
          <div><dt>Scale</dt><dd>{record.scale_x}, {record.scale_y}, {record.scale_z}</dd></div>
          <div><dt>Offset</dt><dd>{formatCoordinate(record.offset_x)}, {formatCoordinate(record.offset_y)}, {formatCoordinate(record.offset_z)}</dd></div>
        </dl>
      </section>

      <section className="panel coordinates-panel">
        <div className="panel-heading">
          <div>
            <span className="section-kicker">LAS METADATA</span>
            <h2>专业元数据</h2>
          </div>
        </div>
        <dl>
          <div><dt>CRS</dt><dd>{record.crs_epsg ? `EPSG:${record.crs_epsg}` : record.crs_wkt ? 'WKT 坐标系' : '文件未声明'}</dd></div>
          <div><dt>生成软件</dt><dd>{record.generating_software ?? '未声明'}</dd></div>
          <div><dt>系统标识</dt><dd>{record.system_identifier ?? '未声明'}</dd></div>
          <div><dt>GPS 时间</dt><dd>{record.gps_time_min === null ? '无' : `${record.gps_time_min} ～ ${record.gps_time_max}`}</dd></div>
          <div><dt>分类统计</dt><dd>{formatStats(record.classification_stats)}</dd></div>
          <div><dt>回波统计</dt><dd>{formatStats(record.return_stats)}</dd></div>
          <div><dt>VLR / EVLR</dt><dd>{record.vlr_summary?.length ?? 0} / {record.evlr_summary?.length ?? 0}</dd></div>
        </dl>
      </section>
    </div>
  )
}

function formatStats(stats: Record<string, number> | null): string {
  if (!stats || Object.keys(stats).length === 0) return '无'
  return Object.entries(stats)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([key, count]) => `${key}: ${formatNumber(count)}`)
    .join(' · ')
}
