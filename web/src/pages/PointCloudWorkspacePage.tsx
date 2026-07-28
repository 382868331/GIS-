import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditorObject } from '../api/edits'
import { getEditDocument, saveEditDocument } from '../api/edits'
import {
  bootstrapPointCloud,
  deletePointCloud,
  downloadPointCloud,
  getPointClouds,
  getUploadConfig,
  type PointCloud,
  type UploadConfig,
} from '../api/pointClouds'
import { PointCloudEditor, type EditorTool } from '../components/editor/PointCloudEditor'
import { Icon } from '../components/ui/Icon'
import { useNotifications } from '../hooks/useNotifications'
import { useResumableUpload } from '../hooks/useResumableUpload'
import { formatBytes, formatDate } from '../utils/format'

const editorTools: Array<{ id: EditorTool; icon: 'orbit' | 'point' | 'line' | 'polygon' | 'measure' | 'annotation'; label: string }> = [
  { id: 'orbit', icon: 'orbit', label: '浏览视角' },
  { id: 'point', icon: 'point', label: '添加点' },
  { id: 'polyline', icon: 'line', label: '绘制线' },
  { id: 'polygon', icon: 'polygon', label: '绘制面' },
  { id: 'measurement', icon: 'measure', label: '测量距离' },
  { id: 'annotation', icon: 'annotation', label: '文字标注' },
]

type SaveState = 'loading' | 'saved' | 'dirty' | 'saving' | 'error'
type MenuName = 'files' | 'tools' | 'delete' | 'notifications' | null

export function PointCloudWorkspacePage({ onLogout }: { onLogout: () => void }) {
  const [records, setRecords] = useState<PointCloud[]>([])
  const [record, setRecord] = useState<PointCloud | null>(null)
  const [config, setConfig] = useState<UploadConfig | null>(null)
  const [tool, setTool] = useState<EditorTool>('orbit')
  const [objects, setObjects] = useState<EditorObject[]>([])
  const [undoStack, setUndoStack] = useState<EditorObject[][]>([])
  const [redoStack, setRedoStack] = useState<EditorObject[][]>([])
  const [revision, setRevision] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [exporting, setExporting] = useState(false)
  const [activeMenu, setActiveMenu] = useState<MenuName>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const objectsRef = useRef<EditorObject[]>([])
  const revisionRef = useRef(0)
  const generationRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const hydratedRef = useRef(false)
  const persistedObjectsRef = useRef('[]')
  const { items: notifications, unreadCount, markAllRead } = useNotifications()

  useEffect(() => { objectsRef.current = objects }, [objects])
  useEffect(() => { revisionRef.current = revision }, [revision])

  const loadRecords = useCallback(async (preferredId?: string) => {
    const page = await getPointClouds(1, 100)
    let next = page.items
    if (next.length === 0) next = [await bootstrapPointCloud()]
    setRecords(next)
    setRecord((current) =>
      next.find((item) => item.id === (preferredId ?? current?.id)) ?? next[0] ?? null,
    )
  }, [])

  useEffect(() => {
    void Promise.all([getUploadConfig(), loadRecords()])
      .then(([nextConfig]) => setConfig(nextConfig))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '工作区初始化失败'))
  }, [loadRecords])

  useEffect(() => {
    const refresh = (event: Event) => {
      const eventType = (event as CustomEvent<{ event_type?: string }>).detail?.event_type
      if (eventType?.startsWith('EDIT_')) return
      void loadRecords()
    }
    window.addEventListener('pointcloud:changed', refresh)
    return () => window.removeEventListener('pointcloud:changed', refresh)
  }, [loadRecords])

  useEffect(() => {
    if (!record) return
    let active = true
    hydratedRef.current = false
    setSaveState('loading')
    setUndoStack([])
    setRedoStack([])
    setObjects([])
    objectsRef.current = []
    void getEditDocument(record.id)
      .then((document) => {
        if (!active) return
        const nextObjects = document.document.objects ?? []
        objectsRef.current = nextObjects
        persistedObjectsRef.current = JSON.stringify(nextObjects)
        revisionRef.current = document.revision
        setObjects(nextObjects)
        setRevision(document.revision)
        setSaveState('saved')
        requestAnimationFrame(() => { if (active) hydratedRef.current = true })
      })
      .catch((reason) => {
        if (!active) return
        setSaveState('error')
        setError(reason instanceof Error ? reason.message : '编辑数据加载失败')
      })
    return () => { active = false }
  }, [record])

  const save = useCallback((mode: 'auto' | 'manual') => {
    if (!record) return Promise.resolve()
    const recordId = record.id
    const requestedGeneration = generationRef.current
    setSaveState('saving')
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const savingObjects = objectsRef.current
      const savingJson = JSON.stringify(savingObjects)
      const result = await saveEditDocument(recordId, revisionRef.current, savingObjects, mode)
      persistedObjectsRef.current = savingJson
      revisionRef.current = result.revision
      setRevision(result.revision)
      setSaveState(requestedGeneration === generationRef.current ? 'saved' : 'dirty')
    }).catch((reason) => {
      setSaveState('error')
      setError(reason instanceof Error ? reason.message : '保存失败')
    })
    return saveQueueRef.current
  }, [record])

  useEffect(() => {
    if (!hydratedRef.current || !record) return
    if (JSON.stringify(objects) === persistedObjectsRef.current) return
    setSaveState('dirty')
    const timer = window.setTimeout(() => void save('auto'), 1200)
    return () => window.clearTimeout(timer)
  }, [objects, record, save])

  const mutateObjects = (next: EditorObject[]) => {
    setUndoStack((history) => [...history.slice(-49), objectsRef.current])
    setRedoStack([])
    generationRef.current += 1
    objectsRef.current = next
    setObjects(next)
  }

  const uploaded = useCallback((nextRecord: PointCloud) => void loadRecords(nextRecord.id), [loadRecords])
  const upload = useResumableUpload(uploaded)

  const undo = () => {
    const previous = undoStack.at(-1)
    if (!previous) return
    setRedoStack((history) => [...history, objectsRef.current])
    setUndoStack((history) => history.slice(0, -1))
    generationRef.current += 1
    objectsRef.current = previous
    setObjects(previous)
  }

  const redo = () => {
    const next = redoStack.at(-1)
    if (!next) return
    setUndoStack((history) => [...history, objectsRef.current])
    setRedoStack((history) => history.slice(0, -1))
    generationRef.current += 1
    objectsRef.current = next
    setObjects(next)
  }

  const removeSelectedRecord = async () => {
    if (!record || !window.confirm(`确定删除“${record.original_name}”吗？`)) return
    await deletePointCloud(record.id)
    setRecord(null)
    setActiveMenu(null)
    await loadRecords()
  }

  const toggleMenu = (menu: Exclude<MenuName, null>) => {
    setActiveMenu((current) => current === menu ? null : menu)
    if (menu === 'notifications' && unreadCount > 0) void markAllRead()
  }

  const exportCurrent = async () => {
    if (!record || exporting) return
    setExporting(true)
    setError('')
    try {
      await downloadPointCloud(record.id, record.original_name)
      window.setTimeout(() => setExporting(false), 800)
    } catch (reason) {
      setExporting(false)
      setError(reason instanceof Error ? reason.message : '导出失败')
    }
  }

  const saveLabel = {
    loading: '正在读取编辑记录',
    dirty: '等待自动保存',
    saving: '正在保存',
    saved: `已保存 · v${revision}`,
    error: '保存失败',
  }[saveState]

  return (
    <div className="immersive-workspace" onPointerDown={(event) => {
      if (event.target === event.currentTarget) setActiveMenu(null)
    }}>
      <input ref={inputRef} className="sr-only" type="file" accept=".las,.LAS"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file && config && file.size > config.max_file_size_bytes) {
            setError(`文件不能超过 ${formatBytes(config.max_file_size_bytes)}`)
          } else if (file) void upload.start(file)
        }} />

      <div className="immersive-stage">
        {record ? (
          <PointCloudEditor recordId={record.id} tool={tool} objects={objects}
            onCreateObject={(object) => mutateObjects([...objectsRef.current, object])} />
        ) : <div className="workspace-loading">正在准备内置示例点云…</div>}
      </div>

      <div className="bottom-console">
        <div className="workspace-status">
          <span className="status-file" title={record?.original_name}>{record?.original_name ?? '准备点云数据'}</span>
          {record && <><span>{formatBytes(record.size_bytes)}</span><span>{record.point_count.toLocaleString()} 点</span><span>LAS {record.las_version}</span></>}
          {upload.state.phase !== 'idle' && (
            <span className="upload-status">
              上传：{upload.state.file?.name} · {Math.round(upload.state.progress * 100)}%
              {upload.state.phase === 'uploading' && <i><b style={{ width: `${upload.state.progress * 100}%` }} /></i>}
              {upload.state.phase === 'uploading' && <button type="button" onClick={upload.pause}>暂停</button>}
              {upload.state.phase === 'paused' && <button type="button" onClick={() => void upload.resume()}>继续</button>}
              {upload.state.phase !== 'completed' && <button type="button" onClick={() => void upload.cancel()}>取消</button>}
            </span>
          )}
          <span className={`save-state save-${saveState}`}>{saveLabel}</span>
          <span>{objects.length} 个标记</span>
          <span className="active-tool-label">{editorTools.find((item) => item.id === tool)?.label}</span>
        </div>

        <nav className="floating-toolbar" aria-label="点云操作">
          <button className="orb-button logo-orb" type="button" title="点云平台" onClick={() => setActiveMenu(null)}>
            <img src="/pointcloud-logo.png" alt="点云平台" />
          </button>
          <button className="orb-button" type="button" title="上传 LAS" onClick={() => inputRef.current?.click()}><Icon name="upload" /></button>
          <div className="orb-group">
            <button className={`orb-button${activeMenu === 'files' ? ' is-active' : ''}`} type="button" title="选择文件" onClick={() => toggleMenu('files')}><Icon name="file" /></button>
            {activeMenu === 'files' && (
              <section className="floating-panel file-panel">
                <header><strong>点云文件</strong><span>{records.length} 个</span></header>
                <div className="panel-scroll">
                  {records.map((item) => (
                    <button className={item.id === record?.id ? 'is-selected' : ''} type="button" key={item.id}
                      onClick={() => { setRecord(item); setActiveMenu(null) }}>
                      <span>{item.original_name}</span><small>{formatBytes(item.size_bytes)} · {item.point_count.toLocaleString()} 点</small>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
          <div className="orb-group">
            <button className={`orb-button${activeMenu === 'tools' ? ' is-active' : ''}`} type="button" title="编辑工具箱" onClick={() => toggleMenu('tools')}><Icon name="tools" /></button>
            {activeMenu === 'tools' && (
              <section className="floating-panel tool-panel">
                {editorTools.map((item) => (
                  <button className={tool === item.id ? 'is-selected' : ''} type="button" key={item.id}
                    onClick={() => { setTool(item.id); setActiveMenu(null) }}>
                    <Icon name={item.icon} /><span>{item.label}</span>
                  </button>
                ))}
              </section>
            )}
          </div>
          <div className="orb-group">
            <button className={`orb-button danger-orb${activeMenu === 'delete' ? ' is-active' : ''}`} type="button" title="撤销与删除" onClick={() => toggleMenu('delete')}><Icon name="trash" /></button>
            {activeMenu === 'delete' && (
              <section className="floating-panel action-panel">
                <button type="button" disabled={!undoStack.length} onClick={undo}><Icon name="undo" /><span>撤销</span></button>
                <button type="button" disabled={!redoStack.length} onClick={redo}><Icon name="redo" /><span>重做</span></button>
                <button type="button" disabled={!objects.length} onClick={() => mutateObjects(objects.slice(0, -1))}><Icon name="marker-delete" /><span>删除最近标记</span></button>
                <button className="danger-action" type="button" onClick={() => void removeSelectedRecord()}><Icon name="file-delete" /><span>删除当前文件</span></button>
              </section>
            )}
          </div>
          <div className="orb-group">
            <button className={`orb-button${activeMenu === 'notifications' ? ' is-active' : ''}`} type="button" title="通知" onClick={() => toggleMenu('notifications')}>
              <Icon name="bell" />{unreadCount > 0 && <i className="orb-badge">{unreadCount > 99 ? '99+' : unreadCount}</i>}
            </button>
            {activeMenu === 'notifications' && (
              <section className="floating-panel notices-panel">
                <header><strong>通知中心</strong><span>{notifications.length} 条</span></header>
                <div className="panel-scroll">
                  {notifications.length === 0 ? <p>暂无通知</p> : notifications.map((item) => (
                    <article key={item.id}><strong>{item.title}</strong><p>{item.message}</p><time>{formatDate(item.created_at)}</time></article>
                  ))}
                </div>
              </section>
            )}
          </div>
          <button className="orb-button save-orb" type="button" title="手动保存" disabled={!record || saveState === 'saving'} onClick={() => void save('manual')}><Icon name="save" /></button>
          <button className="orb-button export-orb" type="button" title={exporting ? '正在导出' : '导出当前 LAS'}
            disabled={!record || exporting} onClick={() => void exportCurrent()}><Icon name="export" /></button>
          <button className="orb-button" type="button" title="退出登录" onClick={onLogout}><Icon name="logout" /></button>
        </nav>
      </div>
      {error && <button className="workspace-error" type="button" onClick={() => setError('')}>{error}</button>}
    </div>
  )
}
