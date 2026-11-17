import type { StorybookConfig } from '@storybook/react-vite'

// Storybook ของ Alice UI: ใช้ในเครื่องและใน CI เท่านั้น ไม่มี deploy สาธารณะ และไม่อยู่ใน production build
const config: StorybookConfig = {
  stories: ['../src/web/ui/stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  // ไม่ใช้ vite.config.ts ของแอป (root คือ src/web และ proxy ไป server) — Storybook ไม่ต่อ server ใด ๆ
  async viteFinal(config) {
    const { mergeConfig } = await import('vite')
    return mergeConfig(config, { server: { proxy: {} } })
  },
}
export default config
