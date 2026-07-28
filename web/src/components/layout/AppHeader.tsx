import { useState } from 'react'
import type { User } from '../../api/client'
import { useNotifications } from '../../hooks/useNotifications'
import { formatDate } from '../../utils/format'

interface AppHeaderProps {
  user: User
  onHome: () => void
  onLogout: () => void
}

export function AppHeader({ user, onHome, onLogout }: AppHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const { items, unreadCount, markAllRead } = useNotifications()

  return (
    <header className="app-header">
      <button className="brand-button" type="button" onClick={onHome}>
        <img src="/pointcloud-logo.png" alt="" />
        <span>
          <strong>点云上传平台</strong>
          <small>LAS 管理与三维预览</small>
        </span>
      </button>
      <div className="account">
        <div className="notification-center">
          <button
            className="notification-button"
            type="button"
            aria-label={`通知，${unreadCount} 条未读`}
            aria-expanded={notificationsOpen}
            onClick={() => {
              const next = !notificationsOpen
              setNotificationsOpen(next)
              if (next && unreadCount > 0) void markAllRead()
            }}
          >
            <span aria-hidden="true">🔔</span>
            {unreadCount > 0 && <i>{unreadCount > 99 ? '99+' : unreadCount}</i>}
          </button>
          {notificationsOpen && (
            <section className="notification-popover" aria-label="通知中心">
              <header>
                <strong>通知中心</strong>
                <span>{items.length} 条记录</span>
              </header>
              <div className="notification-list">
                {items.length === 0 ? (
                  <p className="notification-empty">暂无通知</p>
                ) : items.map((notification) => (
                  <article key={notification.id}>
                    <span className={`notification-dot${notification.is_read ? ' is-read' : ''}`} />
                    <div>
                      <strong>{notification.title}</strong>
                      <p>{notification.message}</p>
                      <time>{formatDate(notification.created_at)}</time>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
        <span>{user.email}</span>
        <button className="secondary-button" type="button" onClick={onLogout}>退出登录</button>
      </div>
    </header>
  )
}
