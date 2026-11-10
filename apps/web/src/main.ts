import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
// AntD reset 先于主题令牌，保证 body 背景与字体以 --sasu-* 为准
import 'ant-design-vue/dist/reset.css';
// 主题令牌必须最先挂载（M0 交付清单：主色 #B4232A 生效）
import './styles/tokens.css';

createApp(App).use(createPinia()).use(router).mount('#app');
