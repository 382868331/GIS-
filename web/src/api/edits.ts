import { apiRequest } from './client'

export type EditorObjectType = 'point' | 'polyline' | 'polygon' | 'measurement' | 'annotation'

export interface EditorPoint {
  x: number
  y: number
  z: number
}

export interface EditorObject {
  id: string
  type: EditorObjectType
  points: EditorPoint[]
  label: string
  color: string
  created_at: string
}

export interface EditDocument {
  point_cloud_id: string
  revision: number
  document: {
    objects: EditorObject[]
  }
  updated_at: string
}

export function getEditDocument(recordId: string): Promise<EditDocument> {
  return apiRequest(`/api/point-clouds/${recordId}/edits`)
}

export function saveEditDocument(
  recordId: string,
  revision: number,
  objects: EditorObject[],
  saveMode: 'auto' | 'manual',
): Promise<EditDocument> {
  return apiRequest(`/api/point-clouds/${recordId}/edits`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      revision,
      document: { objects },
      save_mode: saveMode,
    }),
  })
}
