import { useCallback, useMemo, useState, type ReactNode } from 'react'
import {
  GlobalStateContext,
  type ModalDescriptor,
  type ModalEvent,
} from './globalState'

export function GlobalStateProvider({ children }: { children: ReactNode }) {
  const [activeModal, setActiveModal] = useState<ModalDescriptor | null>(null)
  const [modalRevision, setModalRevision] = useState(0)
  const [lastModalEvent, setLastModalEvent] = useState<ModalEvent | null>(null)
  const [authRevision, setAuthRevision] = useState(0)

  const openModal = useCallback((name: string, payload?: unknown) => {
    setActiveModal({ name, payload })
    setModalRevision((currentRevision) => {
      const revision = currentRevision + 1
      setLastModalEvent({ action: 'open', name, revision })
      return revision
    })
  }, [])

  const closeModal = useCallback(() => {
    setActiveModal((currentModal) => {
      const name = currentModal?.name ?? 'unknown'
      setModalRevision((currentRevision) => {
        const revision = currentRevision + 1
        setLastModalEvent({ action: 'close', name, revision })
        return revision
      })
      return null
    })
  }, [])

  const notifyAuthChanged = useCallback(() => {
    setAuthRevision((revision) => revision + 1)
  }, [])

  const value = useMemo(
    () => ({
      activeModal,
      modalRevision,
      lastModalEvent,
      authRevision,
      openModal,
      closeModal,
      notifyAuthChanged,
    }),
    [activeModal, authRevision, closeModal, lastModalEvent, modalRevision, notifyAuthChanged, openModal],
  )

  return <GlobalStateContext.Provider value={value}>{children}</GlobalStateContext.Provider>
}
