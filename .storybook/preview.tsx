import type { Decorator, Preview } from '@storybook/react-vite'
import { useEffect } from 'react'
import '../src/web/ui/tokens.css'
import '../src/web/ui/alice-ui.css'
import { applyThemePreference, ToastProvider, TooltipProvider, type ThemePreference } from '../src/web/ui'

const withTheme: Decorator = (Story, context) => {
  const theme = (context.globals.theme ?? 'light') as ThemePreference
  useEffect(() => applyThemePreference(theme), [theme])
  applyThemePreference(theme)
  return (
    <TooltipProvider>
      <ToastProvider>
        <div className="ui-root" style={{ padding: 24, minHeight: '100vh' }}>
          <Story />
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}

const preview: Preview = {
  decorators: [withTheme],
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'system', title: 'System' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error', options: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } } },
    viewport: {
      options: {
        narrow: { name: 'Narrow 320', styles: { width: '320px', height: '640px' } },
        mobile: { name: 'Mobile 390', styles: { width: '390px', height: '844px' } },
        tablet: { name: 'Tablet 768', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop 1280', styles: { width: '1280px', height: '800px' } },
      },
    },
  },
}
export default preview
