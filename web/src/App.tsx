import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentUser, logout, setUnauthorizedHandler, type User } from './api/client'
import { PointCloudWorkspacePage } from './pages/PointCloudWorkspacePage'
import { useGlobalState } from './state/globalState'
import './styles/base.css'
import './styles/platform.css'
import './styles/viewer.css'

type AuthState = 'loading' | 'ready' | 'unauthenticated'

const PointCloudDetailPage = lazy(() => import('./pages/PointCloudDetailPage'))

function currentRecordId(): string | null {
  const match = window.location.hash.match(/^#\/point-clouds\/([a-f0-9-]+)$/i)
  return match?.[1] ?? null
}

function App() {
  const { authRevision, openModal, notifyAuthChanged } = useGlobalState()
  const [authState, setAuthState] = useState<AuthState>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [recordId, setRecordId] = useState<string | null>(() => currentRecordId())
  const verificationRevision = useRef(0)

  const navigateHome = useCallback(() => {
    window.location.hash = '#/'
    setRecordId(null)
  }, [])

  const requireLogin = useCallback(() => {
    verificationRevision.current += 1
    setUser(null)
    setAuthState('unauthenticated')
    navigateHome()
    openModal('auth')
  }, [navigateHome, openModal])

  const verifyIdentity = useCallback(async () => {
    const revision = ++verificationRevision.current
    setAuthState('loading')
    try {
      const currentUser = await getCurrentUser()
      if (revision !== verificationRevision.current) return
      setUser(currentUser)
      setAuthState('ready')
    } catch {
      if (revision !== verificationRevision.current) return
      requireLogin()
    }
  }, [requireLogin])

  useEffect(() => {
    setUnauthorizedHandler(requireLogin)
    return () => setUnauthorizedHandler(null)
  }, [requireLogin])

  useEffect(() => {
    void verifyIdentity()
  }, [authRevision, verifyIdentity])

  useEffect(() => {
    const syncRoute = () => setRecordId(currentRecordId())
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [])

  const handleLogout = async () => {
    try {
      await logout()
    } finally {
      setUser(null)
      navigateHome()
      notifyAuthChanged()
    }
  }

  return (
    <main className="app-shell">
      <div className={`app-content${authState === 'ready' && user ? ' is-workspace' : ''}`}>
        {authState === 'loading' && <section className="panel boot-state">正在验证身份…</section>}
        {authState === 'unauthenticated' && (
          <section className="welcome-panel">
            <img src="/pointcloud-logo.png" alt="" />
            <h1>点云上传平台</h1>
            <p>登录后上传、管理并在浏览器中查看 LAS 点云。</p>
            <button className="primary-button" type="button" onClick={() => openModal('auth')}>登录 / 注册</button>
          </section>
        )}
        {authState === 'ready' && user && (
          recordId
            ? (
                <Suspense fallback={<section className="panel boot-state">正在加载三维查看器…</section>}>
                  <PointCloudDetailPage recordId={recordId} onBack={navigateHome} />
                </Suspense>
              )
            : <PointCloudWorkspacePage onLogout={() => void handleLogout()} />
        )}
      </div>
    </main>
  )
}

export default App
