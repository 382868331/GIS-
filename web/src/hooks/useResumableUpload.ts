import { useCallback, useRef, useState } from 'react'
import {
  cancelUpload,
  completeUpload,
  createUploadSession,
  uploadFileChunk,
  type PointCloud,
  type UploadSession,
} from '../api/pointClouds'

type UploadPhase =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'paused'
  | 'validating'
  | 'completed'
  | 'error'

interface UploadState {
  phase: UploadPhase
  session: UploadSession | null
  file: File | null
  uploadedBytes: number
  progress: number
  error: string
}

const initialState: UploadState = {
  phase: 'idle',
  session: null,
  file: null,
  uploadedBytes: 0,
  progress: 0,
  error: '',
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function useResumableUpload(onComplete: (record: PointCloud) => void) {
  const [state, setState] = useState<UploadState>(initialState)
  const controllers = useRef(new Set<AbortController>())
  const generation = useRef(0)

  const runUpload = useCallback(async (file: File, session: UploadSession) => {
    const currentGeneration = ++generation.current
    const uploaded = new Set(session.uploaded_chunks)
    const pending = Array.from({ length: session.total_chunks }, (_, index) => index)
      .filter((index) => !uploaded.has(index))
    let cursor = 0
    let uploadedBytes = session.uploaded_chunks.reduce((sum, index) => {
      const start = index * session.chunk_size
      return sum + Math.min(session.chunk_size, session.size_bytes - start)
    }, 0)

    setState({
      phase: 'uploading',
      session,
      file,
      uploadedBytes,
      progress: uploadedBytes / file.size,
      error: '',
    })

    const worker = async () => {
      while (cursor < pending.length && currentGeneration === generation.current) {
        const index = pending[cursor]
        cursor += 1
        const start = index * session.chunk_size
        const end = Math.min(start + session.chunk_size, file.size)
        const chunk = file.slice(start, end)
        const controller = new AbortController()
        controllers.current.add(controller)
        try {
          const result = await uploadFileChunk(
            session.id,
            index,
            chunk,
            await sha256(chunk),
            controller.signal,
          )
          uploadedBytes = result.uploaded_bytes
          setState((current) => ({
            ...current,
            session: current.session
              ? { ...current.session, uploaded_chunks: result.uploaded_chunks }
              : current.session,
            uploadedBytes,
            progress: uploadedBytes / file.size,
          }))
        } finally {
          controllers.current.delete(controller)
        }
      }
    }

    try {
      await Promise.all([worker(), worker(), worker()])
      if (currentGeneration !== generation.current) return
      setState((current) => ({ ...current, phase: 'validating', progress: 1 }))
      const record = await completeUpload(session.id)
      setState((current) => ({ ...current, phase: 'completed', progress: 1 }))
      onComplete(record)
    } catch (error) {
      if (currentGeneration !== generation.current) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState((current) => ({
        ...current,
        phase: 'error',
        error: error instanceof Error ? error.message : '上传失败',
      }))
    }
  }, [onComplete])

  const start = useCallback(async (file: File) => {
    generation.current += 1
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    setState({ ...initialState, phase: 'preparing', file })
    try {
      const session = await createUploadSession(file)
      await runUpload(file, session)
    } catch (error) {
      setState({
        ...initialState,
        phase: 'error',
        file,
        error: error instanceof Error ? error.message : '无法创建上传会话',
      })
    }
  }, [runUpload])

  const pause = useCallback(() => {
    generation.current += 1
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    setState((current) => ({ ...current, phase: 'paused' }))
  }, [])

  const resume = useCallback(async () => {
    if (state.file && state.session) await runUpload(state.file, state.session)
  }, [runUpload, state.file, state.session])

  const cancel = useCallback(async () => {
    generation.current += 1
    controllers.current.forEach((controller) => controller.abort())
    controllers.current.clear()
    if (state.session) {
      try {
        await cancelUpload(state.session.id)
      } catch {
        // Reset local state even if the already-expired server session is gone.
      }
    }
    setState(initialState)
  }, [state.session])

  const reset = useCallback(() => setState(initialState), [])

  return { state, start, pause, resume, cancel, reset }
}
