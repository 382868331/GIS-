import type { PointCloudPage } from '../../api/pointClouds'
import { formatBytes, formatDate, formatNumber } from '../../utils/format'

interface PointCloudTableProps {
  data: PointCloudPage
  loading: boolean
  onPageChange: (page: number) => void
  onView: (id: string) => void
  onEdit: (id: string, name: string) => void
  onDownload: (id: string, name: string) => void
  onDelete: (id: string, name: string) => void
}

export function PointCloudTable({
  data,
  loading,
  onPageChange,
  onView,
  onEdit,
  onDownload,
  onDelete,
}: PointCloudTableProps) {
  return (
    <section className="panel records-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">文件管理</span>
          <h2>点云记录</h2>
          <p>共 {formatNumber(data.total)} 条，按上传时间倒序排列。</p>
        </div>
      </div>

      {loading ? (
        <div className="table-state">正在加载点云记录…</div>
      ) : data.items.length === 0 ? (
        <div className="empty-state">
          <span aria-hidden="true">◎</span>
          <strong>还没有点云记录</strong>
          <p>上传第一个合法 LAS 文件后，它会出现在这里。</p>
        </div>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>文件</th>
                <th>点数量</th>
                <th>LAS</th>
                <th>颜色</th>
                <th>状态</th>
                <th>上传时间</th>
                <th><span className="sr-only">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong className="file-name">{record.original_name}</strong>
                    <small>{formatBytes(record.size_bytes)}</small>
                  </td>
                  <td>{formatNumber(record.point_count)}</td>
                  <td>v{record.las_version} / 格式 {record.point_format}</td>
                  <td>{record.has_rgb ? 'RGB' : record.has_intensity ? '强度 / 高程' : '高程'}</td>
                  <td><span className={`status-pill status-${record.status.toLowerCase()}`}>{record.status}</span></td>
                  <td>{formatDate(record.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => onView(record.id)}>查看</button>
                      <button type="button" onClick={() => onEdit(record.id, record.original_name)}>编辑</button>
                      <button type="button" onClick={() => onDownload(record.id, record.original_name)}>下载</button>
                      <button className="danger-text" type="button" onClick={() => onDelete(record.id, record.original_name)}>删除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.total_pages > 1 && (
        <nav className="pagination" aria-label="点云列表分页">
          <button type="button" disabled={data.page <= 1} onClick={() => onPageChange(data.page - 1)}>上一页</button>
          <span>第 {data.page} / {data.total_pages} 页</span>
          <button type="button" disabled={data.page >= data.total_pages} onClick={() => onPageChange(data.page + 1)}>下一页</button>
        </nav>
      )}
    </section>
  )
}
