import type { ThemeConfig } from 'ant-design-vue/es/config-provider/context';

/**
 * Ant Design Vue 主题令牌（承接原 Element Plus CSS 变量覆盖，PRD §13.2/§13.3）。
 * 主色 #B4232A；状态色沿用 sasu 色板；圆角 10px 与 --sasu-radius-base 对齐。
 * colorInfo / colorLink：链接与选中态保持品牌红；Alert info / Tag processing 等
 * 中性信息场景用副色藏青，避免「提示」被误读为「错误」。
 */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: '#b4232a',
    colorLink: '#b4232a',
    colorInfo: '#1f4e79',
    colorSuccess: '#2e7d5b',
    colorWarning: '#c77700',
    colorError: '#c0392b',
    colorTextBase: '#1f2329',
    colorBgLayout: '#f7f8fa',
    borderRadius: 10,
    fontFamily: "-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
};
