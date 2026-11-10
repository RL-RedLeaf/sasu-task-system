import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// AntD reset 先于主题令牌，保证 body 背景与字体以 --sasu-* 为准
import 'ant-design-vue/dist/reset.css';
// 主题令牌必须最先挂载（M0 交付清单：主色 #B4232A 生效）
import './styles/tokens.css';
// Element Plus 过渡期：函数式组件（ElMessage/ElMessageBox/ElNotification）被页面手动 import
// 时会绕过 unplugin 的样式自动注入，这里全局补齐；迁移完成后随 EP 一起移除
import 'element-plus/es/components/message/style/css';
import 'element-plus/es/components/message-box/style/css';
import 'element-plus/es/components/notification/style/css';

createApp(App).use(createPinia()).use(router).mount('#app');
