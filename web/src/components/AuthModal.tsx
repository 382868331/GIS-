import { useEffect, useState, type FormEvent } from 'react'
import { login, prepareDemoAccount } from '../api/client'
import { useGlobalState } from '../state/globalState'
import './AuthModal.css'

type Agreement = 'terms' | 'privacy' | null

const REMEMBER_EMAIL_KEY = 'pointcloud_remembered_email'
const REMEMBER_PASSWORD_KEY = 'pointcloud_remembered_password'

const agreementContent = {
  terms: {
    title: '用户协议',
    intro: '欢迎使用点云上传平台。本协议适用于您对演示平台及相关功能的访问和使用。',
    sections: [
      ['一、服务说明', '本平台提供账号认证、点云文件上传、处理状态展示及相关数据演示功能。平台目前属于演示环境，功能、容量与可用时间可能根据测试需要调整。'],
      ['二、账号与安全', '您应使用本人有权使用的邮箱注册，并妥善保管账号信息。演示模式允许在密码不匹配时更新密码，请勿在本平台使用其他重要系统的真实密码。'],
      ['三、内容规范', '您不得上传违法违规、侵犯他人知识产权、包含恶意程序或未经授权的个人敏感信息。您应确保对上传的点云文件及附属数据拥有合法处理权限。'],
      ['四、知识产权', '您上传内容的权利仍归原权利人所有。平台界面、程序与标识受到相关法律保护，未经许可不得复制、反向工程或用于商业分发。'],
      ['五、责任限制', '演示服务按现状提供，不承诺永久保存数据或持续可用。因网络、设备、第三方服务或不可抗力造成的中断与数据损失，平台将在法律允许范围内免责。'],
      ['六、协议变更', '平台可根据产品和合规要求更新本协议。重要变化将在页面中提示；继续使用即视为接受更新后的内容。'],
      ['七、联系我们', '如对协议、账号或上传内容有疑问，可通过项目维护人员提供的联系方式提出反馈。'],
    ],
  },
  privacy: {
    title: '隐私政策',
    intro: '我们重视您的个人信息安全。本政策说明演示平台会收集哪些信息、如何使用以及您拥有的选择。',
    sections: [
      ['一、收集的信息', '为完成登录，我们处理邮箱、密码摘要和会话标识；为提供上传功能，我们可能处理文件名称、大小、上传时间、处理状态以及必要的运行日志。'],
      ['二、信息的使用', '相关信息仅用于身份认证、维持登录状态、完成点云上传与处理、排查故障、保障服务安全和改进演示体验。'],
      ['三、本地记住功能', '勾选“记住账号和密码”后，邮箱与密码会保存在当前浏览器的本地存储中，以便下次自动填写。此功能默认开启，您可取消勾选并提交，以清除已保存信息。请勿在公共设备上启用。'],
      ['四、Cookie 与会话', '平台使用仅限必要用途的登录 Cookie。Cookie 用于识别会话，设置为仅由服务端读取，并在退出登录或达到有效期后失效。'],
      ['五、共享与披露', '除依法配合监管、保护平台与用户安全或获得您的明确授权外，我们不会向无关第三方出售或共享您的个人信息。'],
      ['六、保存期限', '账号数据在演示环境运行期间保存；上传文件和运行日志会根据测试需要定期清理。浏览器本地保存的数据由您通过浏览器设置或取消记住功能管理。'],
      ['七、您的权利', '您可以查询、更正或删除账号信息，撤回记住账号密码的选择，并要求删除上传数据。因演示模式允许重置密码，请避免存放真实敏感资料。'],
      ['八、安全措施', '我们通过密码哈希、受限 Cookie、访问控制和最小化收集等措施保护数据，但互联网传输与本地存储仍存在风险，请妥善管理设备和账号。'],
      ['九、政策更新', '政策发生重大变化时，我们会在登录界面提供提示。更新后的政策自展示日期起生效。'],
    ],
  },
} as const

function AgreementDialog({
  type,
  onClose,
}: {
  type: Exclude<Agreement, null>
  onClose: () => void
}) {
  const content = agreementContent[type]

  return (
    <div className="agreement-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="agreement-dialog" role="dialog" aria-modal="true" aria-labelledby="agreement-title">
        <header>
          <div>
            <h2 id="agreement-title">{content.title}</h2>
            <p>更新日期：2026年7月28日</p>
          </div>
          <button type="button" aria-label={`关闭${content.title}`} onClick={onClose}>×</button>
        </header>
        <div className="agreement-dialog__body">
          <p className="agreement-intro">{content.intro}</p>
          {content.sections.map(([heading, body]) => (
            <section key={heading}>
              <h3>{heading}</h3>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <footer>
          <button className="primary-button" type="button" onClick={onClose}>我已阅读</button>
        </footer>
      </section>
    </div>
  )
}

export function AuthModal() {
  const { closeModal, notifyAuthChanged } = useGlobalState()
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_EMAIL_KEY) ?? '')
  const [password, setPassword] = useState(() => localStorage.getItem(REMEMBER_PASSWORD_KEY) ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberCredentials, setRememberCredentials] = useState(true)
  const [acceptedAgreements, setAcceptedAgreements] = useState(true)
  const [visibleAgreement, setVisibleAgreement] = useState<Agreement>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (visibleAgreement) setVisibleAgreement(null)
        else closeModal()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closeModal, visibleAgreement])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    if (!acceptedAgreements) {
      setError('请阅读并同意用户协议和隐私政策')
      return
    }

    setSubmitting(true)
    try {
      await prepareDemoAccount(email, password)
      await login(email, password)
      if (rememberCredentials) {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email)
        localStorage.setItem(REMEMBER_PASSWORD_KEY, password)
      } else {
        localStorage.removeItem(REMEMBER_EMAIL_KEY)
        localStorage.removeItem(REMEMBER_PASSWORD_KEY)
      }
      notifyAuthChanged()
      closeModal()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '认证操作失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeModal()
    }}>
      <section className="auth-modal auth-modal--compact" role="dialog" aria-modal="true" aria-label="登录或注册">
        <button className="modal-close" type="button" aria-label="关闭登录弹窗" onClick={closeModal}>×</button>

        <div className="auth-welcome">
          <img src="/pointcloud-logo.png" alt="" />
          <div>
            <strong>欢迎登录</strong>
            <span>点云上传平台</span>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <label>
            邮箱
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)}
              autoComplete="email" placeholder="name@example.com" required autoFocus />
          </label>

          <label>
            密码
            <span className="password-field">
              <input type={showPassword ? 'text' : 'password'} value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password" placeholder="至少 8 位密码" minLength={8} required />
              <button className={`password-visibility${showPassword ? ' is-visible' : ''}`}
                type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword} onClick={() => setShowPassword((current) => !current)}>
                <i />
              </button>
            </span>
          </label>

          <label className="auth-checkbox">
            <input type="checkbox" checked={rememberCredentials}
              onChange={(event) => setRememberCredentials(event.target.checked)} />
            <span>记住账号和密码</span>
          </label>

          <label className="auth-checkbox auth-checkbox--agreement">
            <input type="checkbox" checked={acceptedAgreements}
              onChange={(event) => setAcceptedAgreements(event.target.checked)} />
            <span>
              我已阅读并同意
              <button type="button" onClick={() => setVisibleAgreement('terms')}>《用户协议》</button>
              和
              <button type="button" onClick={() => setVisibleAgreement('privacy')}>《隐私政策》</button>
            </span>
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在处理…' : '登录 / 注册'}
          </button>
        </form>
      </section>

      {visibleAgreement && <AgreementDialog type={visibleAgreement} onClose={() => setVisibleAgreement(null)} />}
    </div>
  )
}
