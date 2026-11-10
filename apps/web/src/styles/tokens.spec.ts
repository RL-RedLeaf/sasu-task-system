import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

/** M0 验收：main.ts 挂 tokens.css 且主色 #B4232A 生效（PRD §13.2） */
describe('tokens.css 主题令牌', () => {
  it('主色为 #B4232A', () => {
    expect(tokensCss).toContain('--sasu-color-primary: #b4232a');
    expect(tokensCss).toContain('--el-color-primary: var(--sasu-color-primary)');
  });

  it('悬停色、状态色与圆角齐备', () => {
    expect(tokensCss).toContain('--sasu-color-primary-hover: #8f1b21');
    expect(tokensCss).toContain('--sasu-color-success: #2e7d5b');
    expect(tokensCss).toContain('--sasu-color-warning: #c77700');
    expect(tokensCss).toContain('--sasu-color-danger: #c0392b');
    expect(tokensCss).toContain('--el-border-radius-base: var(--sasu-radius-base)');
  });
});
