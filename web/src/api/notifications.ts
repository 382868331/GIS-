import { API_BASE_URL, apiRequest } from './client'

export interface Notification {
  id: string
  event_type: string
  title: string
  message: string
  resource_type: string | null
  resource_id: string | null
  payload: Record<string, unknown>
  is_read: boolean
  created_at: string
}

export interface NotificationList {
  items: Notification[]
  unread_count: number
}

export function getNotifications(): Promise<NotificationList> {
  return apiRequest('/api/notifications?limit=30')
}

export function markAllNotificationsRead(): Promise<void> {
  return apiRequest('/api/notifications/read-all', { method: 'POST' })
}

export function notificationWebSocketUrl(): string {
  const url = new URL(API_BASE_URL)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/api/notifications/ws'
  url.search = ''
  return url.toString()
}
