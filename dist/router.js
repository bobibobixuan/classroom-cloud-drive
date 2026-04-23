import { createRouter, createWebHistory } from './deps.js';
import { state, actions } from './store.js';
import AppShell from './components/AppShell.js';
import LoginView from './views/Login.js';
import DriveView from './views/Drive.js';
import RepoMineView from './views/RepoMine.js';
import RepoHallView from './views/RepoHall.js';
import RepoDetailView from './views/RepoDetail.js';
import AdminView from './views/Admin.js';

const routes = [
  {
    path: '/login',
    component: LoginView,
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    component: AppShell,
    children: [
      { path: '', redirect: '/drive' },
      { path: '/drive', component: DriveView, meta: { title: '个人云盘' } },
      { path: '/repos/mine', component: RepoMineView, meta: { title: '我的仓库' } },
      { path: '/repos/hall', component: RepoHallView, meta: { title: '仓库大厅' } },
      { path: '/repos/:id', component: RepoDetailView, meta: { title: '仓库详情' } },
      { path: '/admin', redirect: '/admin/users', meta: { admin: true } },
      { path: '/admin/users', component: AdminView, meta: { title: '管理员配置', admin: true, adminSection: 'users' } },
      { path: '/admin/repos', component: AdminView, meta: { title: '仓库设置', admin: true, adminSection: 'repos' } },
      { path: '/admin/shares', component: AdminView, meta: { title: '公开链接设置', admin: true, adminSection: 'shares' } },
      { path: '/admin/recycle', component: AdminView, meta: { title: '回收站清理', admin: true, adminSection: 'recycle' } },
      { path: '/admin/logs', component: AdminView, meta: { title: '操作日志', admin: true, adminSection: 'logs' } },
    ],
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  },
});

router.beforeEach(async (to) => {
  const isPublic = !!to.meta.public;
  if (state.token && !state.ready) {
    const bootstrapped = await actions.bootstrap();
    if (!bootstrapped && !isPublic) {
      return { path: '/login', query: { redirect: to.fullPath }, replace: true };
    }
  }
  if (!isPublic && !state.token) {
    return { path: '/login', query: { redirect: to.fullPath }, replace: true };
  }
  if (to.path === '/login' && state.token) {
    return to.query.redirect || '/drive';
  }
  if (to.meta.admin && !state.isAdmin) {
    return '/drive';
  }
  return true;
});
