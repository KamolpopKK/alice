import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'alice.ui.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/** The preference saved on this device; System when nothing (or something unknown) is stored. */
export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function saveThemePreference(value: ThemePreference): void {
  try {
    if (value === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

/** Light and Dark set `data-theme`; System removes it so tokens.css follows the OS. */
export function applyThemePreference(value: ThemePreference, root: HTMLElement = document.documentElement): void {
  if (value === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', value)
}

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light'
}

type ThemeState = { preference: ThemePreference; resolved: ResolvedTheme; setPreference: (value: ThemePreference) => void }
const ThemeContext = createContext<ThemeState | null>(null)

export function ThemeProvider({ children, initial }: { children: ReactNode; initial?: ThemePreference }) {
  const [preference, setState] = useState<ThemePreference>(() => initial ?? readThemePreference())
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme)
  useEffect(() => applyThemePreference(preference), [preference])
  useEffect(() => {
    const mql = window.matchMedia?.(DARK_QUERY)
    if (!mql) return
    const on = () => setSystem(mql.matches ? 'dark' : 'light')
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  const setPreference = useCallback((value: ThemePreference) => {
    saveThemePreference(value)
    setState(value)
  }, [])
  const value = useMemo(() => ({ preference, resolved: preference === 'system' ? system : preference, setPreference }), [preference, system, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeState {
  const state = useContext(ThemeContext)
  if (!state) throw new Error('useTheme needs a ThemeProvider')
  return state
}
