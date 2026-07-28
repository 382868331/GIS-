import { createContext, useContext } from 'react'

export interface ModalDescriptor {
  name: string
  payload?: unknown
}

export interface ModalEvent {
  action: 'open' | 'close'
  name: string
  revision: number
}

export interface GlobalStateValue {
  activeModal: ModalDescriptor | null
  modalRevision: number
  lastModalEvent: ModalEvent | null
  authRevision: number
  openModal: (name: string, payload?: unknown) => void
  closeModal: () => void
  notifyAuthChanged: () => void
}

export const GlobalStateContext = createContext<GlobalStateValue | null>(null)

export function useGlobalState(): GlobalStateValue {
  const context = useContext(GlobalStateContext)
  if (!context) throw new Error('useGlobalState must be used inside GlobalStateProvider')
  return context
}
