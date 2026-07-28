import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getNotifications,
  markAllNotificationsRead,
  notificationWebSocketUrl,
  type Notification,
} from '../api/notifications'

export function useNotifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const reconnectAttempt = useRef(0)

  const reload = useCallback(async () => {
    const result = await getNotifications()
    setItems(result.items)
    setUnreadCount(result.unread_count)
  }, [])

  useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null

    const connect = () => {
      if (disposed) return
      socket = new WebSocket(notificationWebSocketUrl())
      socket.onopen = () => {
        reconnectAttempt.current = 0
        void reload()
      }
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data) as {
          type: string
          notification?: Notification
        }
        if (data.type !== 'notification' || !data.notification) return
        setItems((current) => [
          data.notification as Notification,
          ...current.filter((item) => item.id !== data.notification?.id),
        ].slice(0, 30))
        setUnreadCount((count) => count + 1)
        if (data.notification.resource_type === 'point_cloud') {
          window.dispatchEvent(new CustomEvent('pointcloud:changed', {
            detail: {
              event_type: data.notification.event_type,
              resource_id: data.notification.resource_id,
            },
          }))
        }
      }
      socket.onclose = () => {
        if (disposed) return
        reconnectAttempt.current += 1
        const delay = Math.min(1000 * 2 ** (reconnectAttempt.current - 1), 15_000)
        reconnectTimer = window.setTimeout(connect, delay)
      }
    }

    void reload()
    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [reload])

  const markAllRead = useCallback(async () => {
    await markAllNotificationsRead()
    setItems((current) => current.map((item) => ({ ...item, is_read: true })))
    setUnreadCount(0)
  }, [])

  return { items, unreadCount, reload, markAllRead }
}
