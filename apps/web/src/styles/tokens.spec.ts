import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const tokensCss = readFileSync(join(__dirname, 'tokens.css'), 'utf8');
const themeTs = readFileSync(join(__dirname, '..', 'theme.ts'), 'utf8');

/** M0 验收：主色 #B4232A 生效（PRD §13.2）；AntD 主题色由 theme.ts ConfigProvider 接管 */
describe('主题令牌', () => {
  it('主色为 #B4232A', () => {
    expect(tokensCss).toContain('--sasu-color-primary: #b4232a');
    expect(themeTs).toContain("colorPrimary: '#b4232a'");
  });

  it('悬停色与状态色齐备', () => {
    expect(tokensCss).toContain('--sasu-color-primary-hover: #8f1b21');
    expect(tokensCss).toContain('--sasu-color-success: #2e7d5b');
    expect(tokensCss).toContain('--sasu-color-warning: #c77700');
    expect(tokensCss).toContain('--sasu-color-danger: #c0392b');
    expect(themeTs).toContain("colorSuccess: '#2e7d5b'");
    expect(themeTs).toContain("colorWarning: '#c77700'");
    expect(themeTs).toContain("colorError: '#c0392b'");
    expect(themeTs).toContain('borderRadius: 10');
  });
});
