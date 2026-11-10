import { h, inject, provide, reactive } from 'vue';
import type { InjectionKey } from 'vue';
import { message as staticMessage, Modal } from 'ant-design-vue';
import { ExclamationCircleOutlined } from '@ant-design/icons-vue';
import type { ModalFunc, ModalFuncProps } from 'ant-design-vue/es/modal/Modal';

/**
 * 反馈层统一入口：替代原 Element Plus 的 ElMessage / ElMessageBox。
 * message / modal 实例来自 <a-app> 上下文（AppShell 内 provideFeedback），
 * 保证 toast 颜色跟随 antdTheme 主题令牌；useFeedback 未注入时退回静态 API。
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

export interface FeedbackApi {
  message: ToastApi;
  /** resolve 于确认，reject('cancel') 于取消/关闭——保持原 ElMessageBox 语义 */
  confirm(opts: ConfirmOptions): Promise<void>;
}

export function makeConfirm(confirm: ModalFunc) {
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

// ---------- 注入 ----------
const FeedbackKey: InjectionKey<FeedbackApi> = Symbol('feedback');

export function provideFeedback(api: FeedbackApi): void {
  provide(FeedbackKey, api);
}

export function useFeedback(): FeedbackApi {
  // 静态兜底（无 a-app 上下文时）：仅用于极端场景，正常路径都走上下文实例
  return inject(FeedbackKey, { message: staticMessage, confirm: makeConfirm(Modal.confirm as ModalFunc) });
}
