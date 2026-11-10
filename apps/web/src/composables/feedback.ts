import { h, reactive } from 'vue';
import { message as staticMessage, Modal } from 'ant-design-vue';
import { ExclamationCircleOutlined } from '@ant-design/icons-vue';
import type { ModalFunc, ModalFuncProps } from 'ant-design-vue/es/modal/Modal';

/**
 * 反馈层统一入口：替代原 Element Plus 的 ElMessage / ElMessageBox。
 * 页面直接 `import { message, confirm, prompt } from '@/composables/feedback'`。
 * AppShell 启动时调用 bindFeedback 把 <a-app> 上下文实例挂到模块级引用上
 * （toast 颜色跟随 antdTheme）；未绑定时退回 antd 静态 API。
 */

/** 页面只用到字符串 toast；ant-design-vue 静态/上下文两套 MessageInstance
 *  签名互不兼容，这里取页面实际用法的最小结构类型以兼容两者。 */
export interface ToastApi {
  success(content: string): void;
  error(content: string): void;
  warning(content: string): void;
  info(content: string): void;
}

export interface ConfirmOptions {
  title: string;
  content: string;
  okText?: string;
  cancelText?: string;
  /** 'warning' 显示感叹号图标（对应原 ElMessageBox type: 'warning'），默认问号 */
  icon?: 'question' | 'warning';
}

export interface PromptOptions {
  title: string;
  /** 弹窗内展示的说明文字 */
  message?: string;
  placeholder?: string;
  /** 与原 ElMessageBox inputValidator 签名一致：通过返回 true，否则返回错误文案 */
  validate?: (value: string) => true | string;
}

export function makeConfirm(confirm: ModalFunc): (opts: ConfirmOptions) => Promise<void> {
  return (opts: ConfirmOptions): Promise<void> =>
    new Promise((resolve, reject) => {
      const props: ModalFuncProps = {
        title: opts.title,
        content: opts.content,
        okText: opts.okText ?? '确定',
        cancelText: opts.cancelText ?? '取消',
        onOk: () => resolve(),
        onCancel: () => reject('cancel'),
      };
      if (opts.icon === 'warning') props.icon = h(ExclamationCircleOutlined);
      confirm(props);
    });
}

interface ContextFeedback {
  message: ToastApi;
  confirm: (opts: ConfirmOptions) => Promise<void>;
}

let ctx: ContextFeedback | null = null;

/** AppShell 挂载时绑定 a-app 上下文实例（message/confirm 颜色随主题）。 */
export function bindFeedback(api: ContextFeedback): void {
  ctx = api;
}

const staticConfirm = makeConfirm(Modal.confirm as ModalFunc);

// ---------- 对外 API（模块级，setup 内外皆可用） ----------
export const message: ToastApi = {
  success: (content) => (ctx ? ctx.message.success(content) : staticMessage.success(content)),
  error: (content) => (ctx ? ctx.message.error(content) : staticMessage.error(content)),
  warning: (content) => (ctx ? ctx.message.warning(content) : staticMessage.warning(content)),
  info: (content) => (ctx ? ctx.message.info(content) : staticMessage.info(content)),
};

/** resolve 于确认，reject('cancel') 于取消/关闭——保持原 ElMessageBox 语义 */
export function confirm(opts: ConfirmOptions): Promise<void> {
  return ctx ? ctx.confirm(opts) : staticConfirm(opts);
}

// ---------- 全局输入弹窗（替代 ElMessageBox.prompt，AntD 无内置 prompt） ----------
// 单实例挂载于 AppShell（FeedbackHost.vue），页面经 prompt() 以 Promise 取值。
interface PromptState {
  open: boolean;
  title: string;
  message: string;
  placeholder: string;
  validate: PromptOptions['validate'];
}

export const promptState = reactive<PromptState>({
  open: false,
  title: '',
  message: '',
  placeholder: '',
  validate: undefined,
});

let promptResolve: ((value: string) => void) | null = null;
let promptReject: ((reason: unknown) => void) | null = null;

export function prompt(opts: PromptOptions): Promise<string> {
  Object.assign(promptState, {
    open: true,
    title: opts.title,
    message: opts.message ?? '',
    placeholder: opts.placeholder ?? '',
    validate: opts.validate,
  });
  return new Promise((resolve, reject) => {
    promptResolve = resolve;
    promptReject = reject;
  });
}

export function settlePrompt(value: string | null): void {
  promptState.open = false;
  if (!promptResolve || !promptReject) return;
  if (value === null) promptReject('cancel');
  else promptResolve(value);
  promptResolve = null;
  promptReject = null;
}
