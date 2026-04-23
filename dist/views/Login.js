import { ref } from '../deps.js';
import { actions } from '../store.js';
import { showToast } from '../ui.js';
import { useRoute, useRouter } from '../deps.js';

export default {
  name: 'LoginView',
  setup() {
    const router = useRouter();
    const route = useRoute();
    const mode = ref(route.query.mode === 'register' ? 'register' : 'login');
    const loginForm = ref({ username: '', password: '' });
    const registerForm = ref({ username: '', password: '', phone: '' });
    const loginFeedback = ref({ type: '', message: '' });
    const registerFeedback = ref({ type: '', message: '' });

    const setFeedback = (target, type, message) => {
      target.value = { type, message };
    };

    const clearFeedback = (target) => {
      target.value = { type: '', message: '' };
    };

    const switchMode = (nextMode, options = {}) => {
      mode.value = nextMode;
      if (!options.preserveLoginFeedback) {
        clearFeedback(loginFeedback);
      }
      if (!options.preserveRegisterFeedback) {
        clearFeedback(registerFeedback);
      }
    };

    const submitLogin = async () => {
      if (!loginForm.value.username.trim()) {
        setFeedback(loginFeedback, 'warning', '请输入账号后再登录。');
        return;
      }
      if (!loginForm.value.password) {
        setFeedback(loginFeedback, 'warning', '请输入密码后再登录。');
        return;
      }
      try {
        clearFeedback(loginFeedback);
        await actions.login(loginForm.value.username, loginForm.value.password);
        setFeedback(loginFeedback, 'success', '登录成功，正在进入个人云盘。');
        showToast('登录成功', 'success');
        router.push(route.query.redirect || '/drive');
      } catch (error) {
        const message = error.message || '登录失败';
        if (message.includes('账号或密码错误')) {
          setFeedback(loginFeedback, 'error', '账号或密码错误，请检查后重试。');
        } else if (message.includes('被冻结')) {
          setFeedback(loginFeedback, 'error', message);
        } else {
          setFeedback(loginFeedback, 'error', `登录失败：${message}`);
        }
        showToast(error.message || '登录失败', 'error');
      }
    };

    const submitRegister = async () => {
      if (!registerForm.value.username.trim()) {
        setFeedback(registerFeedback, 'warning', '请先填写昵称。');
        return;
      }
      if (!registerForm.value.password) {
        setFeedback(registerFeedback, 'warning', '请先设置登录密码。');
        return;
      }
      if (!registerForm.value.phone.trim()) {
        setFeedback(registerFeedback, 'warning', '请输入已录入白名单的手机号。');
        return;
      }
      try {
        clearFeedback(registerFeedback);
        const data = await actions.register(
          registerForm.value.username,
          registerForm.value.password,
          registerForm.value.phone,
        );
        const successMessage = data.is_admin
          ? `注册成功，当前账号已获得管理员权限。登录账号：${data.username}`
          : `注册成功，请使用账号 ${data.username} 登录`;
        setFeedback(registerFeedback, 'success', '注册成功，已自动生成实名账号。请切换到登录页继续。');
        setFeedback(loginFeedback, 'success', successMessage);
        showToast(successMessage, 'success');
        loginForm.value.username = data.username || registerForm.value.username.trim();
        loginForm.value.password = '';
        registerForm.value.password = '';
        switchMode('login', { preserveLoginFeedback: true });
      } catch (error) {
        const message = error.message || '注册失败';
        setFeedback(registerFeedback, 'error', `注册失败：${message}`);
        showToast(error.message || '注册失败', 'error');
      }
    };

    return {
      mode,
      loginForm,
      registerForm,
      loginFeedback,
      registerFeedback,
      switchMode,
      clearFeedback,
      submitLogin,
      submitRegister,
    };
  },
  template: `
    <div class="flex min-h-screen items-center justify-center px-4 py-10">
      <div class="grid w-full max-w-6xl overflow-hidden rounded-[40px] border border-white/70 bg-white/85 shadow-2xl shadow-slate-300/60 backdrop-blur lg:grid-cols-[1.1fr_0.9fr]">
        <section class="hidden bg-slate-950 px-10 py-12 text-white lg:block">
          <div class="max-w-md">
            <h1 class="text-5xl font-bold leading-tight">课堂云盘与项目仓库</h1>
            <div class="mt-10 grid gap-4">
              <div class="rounded-[28px] border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">个人云盘</h2>
                <p class="mt-2 text-sm leading-7 text-slate-300">保存个人文件与作业。</p>
              </div>
              <div class="rounded-[28px] border border-white/10 bg-white/5 p-5">
                <h2 class="text-lg font-semibold">项目仓库</h2>
                <p class="mt-2 text-sm leading-7 text-slate-300">支持长期维护与多人协作。</p>
              </div>
            </div>
          </div>
        </section>

        <section class="px-6 py-8 md:px-10 md:py-12">
          <div class="mx-auto max-w-md">
            <div class="flex rounded-full bg-slate-100 p-1 text-sm font-semibold text-slate-500">
              <button class="flex-1 rounded-full px-4 py-2" :class="mode === 'login' ? 'bg-white text-slate-900 shadow' : ''" @click="switchMode('login')">登录</button>
              <button class="flex-1 rounded-full px-4 py-2" :class="mode === 'register' ? 'bg-white text-slate-900 shadow' : ''" @click="switchMode('register')">注册</button>
            </div>

            <div v-if="mode === 'login'" class="mt-8 space-y-4">
              <div>
                <h2 class="text-3xl font-bold text-slate-900">欢迎回来</h2>
                <p class="mt-2 text-sm leading-7 text-slate-500">请输入你的账号和密码。如果密码错误或账号不存在，会在下方直接提示。</p>
              </div>
              <input v-model="loginForm.username" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="请输入学号或账号" @input="clearFeedback(loginFeedback)">
              <input v-model="loginForm.password" type="password" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="请输入密码" @input="clearFeedback(loginFeedback)">
              <div v-if="loginFeedback.message" class="rounded-[24px] px-4 py-3 text-sm leading-7"
                :class="loginFeedback.type === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-700' : (loginFeedback.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700')">
                {{ loginFeedback.message }}
              </div>
              <button class="w-full rounded-3xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-200" @click="submitLogin">登录并进入 /drive</button>
            </div>

            <div v-else class="mt-8 space-y-4">
              <div>
                <h2 class="text-3xl font-bold text-slate-900">创建学生账号</h2>
                <p class="mt-2 text-sm leading-7 text-slate-500">注册仅面向已录入白名单的手机号。最终账号会自动生成为“昵称_真实姓名”。</p>
              </div>
              <input v-model="registerForm.username" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="设置你的昵称，例如：飞天小女警" @input="clearFeedback(registerFeedback)">
              <input v-model="registerForm.password" type="password" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="设置登录密码" @input="clearFeedback(registerFeedback)">
              <input v-model="registerForm.phone" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="请输入已录入白名单的手机号" @input="clearFeedback(registerFeedback)">
              <div v-if="registerFeedback.message" class="rounded-[24px] px-4 py-3 text-sm leading-7"
                :class="registerFeedback.type === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-700' : (registerFeedback.type === 'success' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700')">
                {{ registerFeedback.message }}
              </div>
              <button class="w-full rounded-3xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-200" @click="submitRegister">注册账号</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `,
};
