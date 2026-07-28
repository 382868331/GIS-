import { useCallback, useEffect, useState } from 'react'
import {
  deletePointCloud,
  downloadPointCloud,
  getPointClouds,
  getUploadConfig,
  updatePointCloud,
  type PointCloudPage,
  type UploadConfig,
} from '../api/pointClouds'
import { PointCloudTable } from '../components/point-cloud/PointCloudTable'
import { UploadPanel } from '../components/upload/UploadPanel'

const emptyPage: PointCloudPage = {
  items: [],
  page: 1,
  page_size: 10,
  total: 0,
  total_pages: 0,
}

export function PointCloudDashboardPage({ onView }: { onView: (id: string) => void }) {
  const [config, setConfig] = useState<UploadConfig | null>(null)
  const [records, setRecords] = useState<PointCloudPage>(emptyPage)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (page = records.page || 1) => {
    setLoading(true)
    setError('')
    try {
      const [nextConfig, nextRecords] = await Promise.all([
        config ? Promise.resolve(config) : getUploadConfig(),
        getPointClouds(page, 10),
      ])
      setConfig(nextConfig)
      setRecords(nextRecords)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '点云数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [config, records.page])

  useEffect(() => {
    void load(1)
    // Initial load intentionally runs once; later refreshes use explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const refreshFromNotification = () => void load(1)
    window.addEventListener('pointcloud:changed', refreshFromNotification)
    return () => window.removeEventListener('pointcloud:changed', refreshFromNotification)
  }, [load])

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`确定删除“${name}”吗？原始 LAS 文件和数据库记录都会被删除。`)) return
    try {
      await deletePointCloud(id)
      await load(records.items.length === 1 && records.page > 1 ? records.page - 1 : records.page)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除失败')
    }
  }

  const rename = async (id: string, currentName: string) => {
    const nextName = window.prompt('请输入新的 LAS 文件名', currentName)?.trim()
    if (!nextName || nextName === currentName) return
    try {
      await updatePointCloud(id, nextName)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存失败')
    }
  }

  return (
    <div className="content-stack">
      <section className="hero-copy">
        <span className="section-kicker">POINT CLOUD WORKSPACE</span>
        <h1>上传、管理并检查三维点云</h1>
        <p>分片上传确保大文件可恢复；后端完成真实 LAS 校验、元数据提取与安全存储。</p>
      </section>

      {config ? (
        <UploadPanel config={config} onUploaded={() => void load(1)} />
      ) : (
        <section className="panel table-state">正在读取上传配置…</section>
      )}

      {error && <p className="page-error" role="alert">{error}</p>}

      <PointCloudTable
        data={records}
        loading={loading}
        onPageChange={(page) => void load(page)}
        onView={onView}
        onEdit={(id, name) => void rename(id, name)}
        onDownload={(id, name) => void downloadPointCloud(id, name).catch((downloadError) => {
          setError(downloadError instanceof Error ? downloadError.message : '下载失败')
        })}
        onDelete={(id, name) => void remove(id, name)}
      />
    </div>
  )
}
