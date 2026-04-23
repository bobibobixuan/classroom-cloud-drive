import { onMounted } from '../deps.js';
import { actions, state } from '../store.js';
import { showToast } from '../ui.js';
import { useRouter } from '../deps.js';

export default {
  name: 'RepoHallView',
  setup() {
    const router = useRouter();

    const load = async () => {
      try {
        await actions.loadRepoHall();
      } catch (error) {
        showToast(error.message || '加载仓库大厅失败', 'error');
      }
    };

    onMounted(load);

    return {
      state,
      router,
      load,
    };
  },
  template: `
    <div class="space-y-6">
      <section class="flex flex-wrap items-start justify-between gap-3 rounded-[32px] border border-slate-200 bg-slate-50 px-6 py-6">
        <div>
          <div class="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Hall</div>
          <h2 class="mt-2 text-3xl font-bold text-slate-900">公开仓库大厅</h2>
        </div>
        <button class="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold" @click="load">刷新大厅</button>
      </section>

      <section class="grid gap-4 xl:grid-cols-3">
        <article v-for="repo in state.hallRepos" :key="repo.id" class="rounded-[32px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-xl font-semibold text-slate-900">{{ repo.name }}</h3>
              <p class="mt-2 text-sm leading-7 text-slate-500">{{ repo.description || '暂无说明' }}</p>
            </div>
            <span class="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">公开</span>
          </div>
          <div class="mt-4 space-y-2 text-sm text-slate-500">
            <div>拥有者：{{ repo.owner_username }}</div>
            <div>文件数：{{ repo.file_count }} · 成员数：{{ repo.member_count }}</div>
            <div>更新时间：{{ repo.updated_at || '未知' }}</div>
          </div>
          <button class="mt-5 rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" @click="router.push('/repos/' + repo.id)">查看仓库</button>
        </article>

        <div v-if="!state.hallRepos.length" class="rounded-[32px] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 xl:col-span-3">
          大厅里还没有公开仓库。创建一个公开仓库，就能像班级内网版 GitHub 一样被浏览。
        </div>
      </section>
    </div>
  `,
};
