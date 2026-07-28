import { API_BASE_URL, apiRequest } from './client'

export interface UploadConfig {
  max_file_size_bytes: number
  chunk_size_bytes: number
  max_preview_points: number
}

export interface UploadSession {
  id: string
  file_name: string
  size_bytes: number
  chunk_size: number
  total_chunks: number
  uploaded_chunks: number[]
  status: string
  expires_at: string
}

export interface ChunkUploadResult {
  upload_id: string
  chunk_index: number
  uploaded_chunks: number[]
  uploaded_bytes: number
  complete: boolean
}

export interface PointCloud {
  id: string
  original_name: string
  size_bytes: number
  sha256: string
  las_version: string
  point_format: number
  point_count: number
  has_rgb: boolean
  has_intensity: boolean
  min_x: number
  max_x: number
  min_y: number
  max_y: number
  min_z: number
  max_z: number
  scale_x: number
  scale_y: number
  scale_z: number
  offset_x: number
  offset_y: number
  offset_z: number
  crs_wkt: string | null
  crs_epsg: number | null
  classification_stats: Record<string, number> | null
  return_stats: Record<string, number> | null
  gps_time_min: number | null
  gps_time_max: number | null
  generating_software: string | null
  system_identifier: string | null
  vlr_summary: Array<Record<string, unknown>> | null
  evlr_summary: Array<Record<string, unknown>> | null
  status: string
  error_message: string | null
  created_at: string
  updated_at: string
}

export interface PointCloudPage {
  items: PointCloud[]
  page: number
  page_size: number
  total: number
  total_pages: number
}

export interface PointCloudPreview {
  id: string
  point_count: number
  sampled_count: number
  has_rgb: boolean
  color_mode: 'RGB' | 'HEIGHT'
  positions: number[]
  colors: number[]
  intensities: number[]
  bounds: {
    min: number[]
    max: number[]
    center: number[]
  }
}

export function getUploadConfig(): Promise<UploadConfig> {
  return apiRequest('/api/point-clouds/config')
}

export function bootstrapPointCloud(): Promise<PointCloud> {
  return apiRequest('/api/point-clouds/bootstrap', { method: 'POST' })
}

export function createUploadSession(file: File): Promise<UploadSession> {
  return apiRequest('/api/point-clouds/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name, size_bytes: file.size }),
  })
}

export function getUploadSession(uploadId: string): Promise<UploadSession> {
  return apiRequest(`/api/point-clouds/uploads/${uploadId}`)
}

export function uploadFileChunk(
  uploadId: string,
  chunkIndex: number,
  content: Blob,
  sha256: string,
  signal: AbortSignal,
): Promise<ChunkUploadResult> {
  return apiRequest(`/api/point-clouds/uploads/${uploadId}/chunks/${chunkIndex}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Chunk-SHA256': sha256,
    },
    body: content,
    signal,
  })
}

export function completeUpload(uploadId: string): Promise<PointCloud> {
  return apiRequest(`/api/point-clouds/uploads/${uploadId}/complete`, {
    method: 'POST',
  })
}

export function cancelUpload(uploadId: string): Promise<void> {
  return apiRequest(`/api/point-clouds/uploads/${uploadId}`, { method: 'DELETE' })
}

export function getPointClouds(page = 1, pageSize = 10): Promise<PointCloudPage> {
  return apiRequest(`/api/point-clouds?page=${page}&page_size=${pageSize}`)
}

export function getPointCloud(id: string): Promise<PointCloud> {
  return apiRequest(`/api/point-clouds/${id}`)
}

export function getPointCloudPreview(id: string, signal?: AbortSignal): Promise<PointCloudPreview> {
  return apiRequest(`/api/point-clouds/${id}/preview`, { signal })
}

export function deletePointCloud(id: string): Promise<void> {
  return apiRequest(`/api/point-clouds/${id}`, { method: 'DELETE' })
}

export function updatePointCloud(id: string, originalName: string): Promise<PointCloud> {
  return apiRequest(`/api/point-clouds/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ original_name: originalName }),
  })
}

export async function downloadPointCloud(id: string, fileName: string): Promise<void> {
  const anchor = document.createElement('a')
  anchor.href = `${API_BASE_URL}/api/point-clouds/${id}/download`
  anchor.download = fileName
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}
