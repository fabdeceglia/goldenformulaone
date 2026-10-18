import { useCallback, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

/** Browser chrome colours, matching the top of the page haze. */
const THEME_COLOR: Record<Theme, string> = { light: '#d9d3dc', dark: '#0d0c0a' }

/**
 * The theme the document is already wearing. It is set before first paint by the
 * inline bootstrap in index.html, so reading it back here keeps React in step
 * without a flash of the wrong theme on load.
 */
function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** Write the theme to the document — the attribute the CSS keys off — and to the
 *  browser chrome through the theme-color meta tag. */
function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}

/** Light or dark, chosen by the visitor and remembered across visits. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Private mode: the choice simply does not persist.
    }
  }, [theme])

  return { theme, toggle }
}
