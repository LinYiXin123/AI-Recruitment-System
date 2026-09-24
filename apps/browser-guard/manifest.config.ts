import type { ManifestV3Export } from '@crxjs/vite-plugin';

const manifest = {
  manifest_version: 3,
  name: '页面安全提示',
  version: '0.1.0',
  description: '只对你明确启用的网站提示可能的开发者工具停靠或页面完整性异常。',
  permissions: ['activeTab', 'permissions', 'scripting', 'storage', 'tabs'],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  action: {
    default_title: '页面安全提示',
    default_popup: 'popup.html',
  },
  background: {
    service_worker: 'src/service-worker.ts',
    type: 'module',
  },
  options_page: 'options.html',
} satisfies ManifestV3Export;

export default manifest;
