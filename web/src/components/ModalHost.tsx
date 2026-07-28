import { useGlobalState } from '../state/globalState'
import { AuthModal } from './AuthModal'

export function ModalHost() {
  const { activeModal } = useGlobalState()

  if (!activeModal) {
    return null
  }

  // Add future global dialogs here without changing page components.
  const modalRegistry: Record<string, React.ReactNode> = {
    auth: <AuthModal />,
  }

  return modalRegistry[activeModal.name] ?? null
}
