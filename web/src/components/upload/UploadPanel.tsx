import { useEffect, useRef, useState } from 'react'
import type { UploadConfig } from '../../api/pointClouds'
import { useResumableUpload } from '../../hooks/useResumableUpload'
import { formatBytes } from '../../utils/format'

interface UploadPanelProps {
  config: UploadConfig
  onUploaded: () => void
}

export function UploadPanel({ config, onUploaded }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const { state, start, pause, resume, cancel, reset } = useResumableUpload(onUploaded)

  useEffect(() => {
    if (state.phase === 'completed') {
      const timer = window.setTimeout(() => {
        reset()
        setSelectedFile(null)
        if (inputRef.current) inputRef.current.value = ''
      }, 1800)
      return () => window.clearTimeout(timer)
    }
  }, [reset, state.phase])

  const selectFile = (file: File | null) => {
    setSelectionError('')
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.las')) {
      setSelectionError('只允许选择 .las 文件')
      return
    }
    if (file.size === 0) {
      setSelectionError('文件不能为空')
      return
    }
    if (file.size > config.max_file_size_bytes) {
      setSelectionError(`文件不能超过 ${formatBytes(config.max_file_size_bytes)}`)
      return
    }
    setSelectedFile(file)
  }

  const active = ['preparing', 'uploading', 'paused', 'validating'].includes(state.phase)
  const file = state.file ?? selectedFile
  const percent = Math.round(state.progress * 100)

  return (
    <section className="panel upload-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">断点续传</span>
          <h2>上传 LAS 点云</h2>
          <p>支持刷新后重新选择同一文件继续，分片大小 {formatBytes(config.chunk_size_bytes)}。</p>
        </div>
        <span className="limit-badge">最大 {formatBytes(config.max_file_size_bytes)}</span>
      </div>

      <div
        className={`drop-zone${file ? ' has-file' : ''}`}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          if (!active) selectFile(event.dataTransfer.files[0] ?? null)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".las,.LAS"
          disabled={active}
          onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
        />
        <span className="upload-symbol" aria-hidden="true">↑</span>
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)}</span>
          </>
        ) : (
          <>
            <strong>拖入 LAS 文件，或点击选择</strong>
            <span>前端检查后仍会由后端验证 LASF 签名及真实结构</span>
          </>
        )}
      </div>

      {(active || state.phase === 'completed' || state.phase === 'error') && file && (
        <div className="upload-progress" aria-live="polite">
          <div className="progress-meta">
            <strong>
              {state.phase === 'preparing' && '正在创建上传会话'}
              {state.phase === 'uploading' && `正在上传 ${percent}%`}
              {state.phase === 'paused' && `已暂停 ${percent}%`}
              {state.phase === 'validating' && '上传完成，正在验证并提取元数据'}
              {state.phase === 'completed' && '上传与校验完成'}
              {state.phase === 'error' && '上传失败'}
            </strong>
            <span>{formatBytes(state.uploadedBytes)} / {formatBytes(file.size)}</span>
          </div>
          <div className="progress-track">
            <i style={{ width: `${percent}%` }} />
          </div>
          {state.session && (
            <small>
              已完成 {state.session.uploaded_chunks.length} / {state.session.total_chunks} 个分片
            </small>
          )}
        </div>
      )}

      {(selectionError || state.error) && (
        <p className="inline-error" role="alert">{selectionError || state.error}</p>
      )}

      <div className="upload-actions">
        {!active && state.phase !== 'error' && state.phase !== 'completed' && (
          <button className="primary-button" type="button" disabled={!selectedFile}
            onClick={() => selectedFile && void start(selectedFile)}>
            开始上传
          </button>
        )}
        {state.phase === 'uploading' && (
          <button className="secondary-button" type="button" onClick={pause}>暂停上传</button>
        )}
        {state.phase === 'paused' && (
          <button className="primary-button" type="button" onClick={() => void resume()}>继续上传</button>
        )}
        {state.phase === 'error' && file && (
          <button className="primary-button" type="button" onClick={() => void start(file)}>重试并续传</button>
        )}
        {state.session && !['completed', 'validating'].includes(state.phase) && (
          <button className="text-button danger-text" type="button" onClick={() => void cancel()}>
            取消并清除分片
          </button>
        )}
      </div>
    </section>
  )
}
