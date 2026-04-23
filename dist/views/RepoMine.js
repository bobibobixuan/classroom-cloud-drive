import { computed, onMounted, ref } from '../deps.js';
import { actions, state } from '../store.js';
import { showToast } from '../ui.js';
import { useRouter } from '../deps.js';

export default {
  name: 'RepoMineView',
  setup() {
    const router = useRouter();
    const creating = ref(false);
    const form = ref({ name: '', description: '', visibility: 'private' });

    const load = async () => {
      try {
        await actions.loadMyRepos();
      } catch (error) {
        showToast(error.message || '加载仓库失败', 'error');
      }
    };

    onMounted(load);

    const repoCount = computed(() => state.myRepos.length);

    const submitCreate = async () => {
      if (!form.value.name.trim()) {
        showToast('请输入仓库名称', 'warning');
        return;
      }
      try {
        const data = await actions.createRepo(form.value);
        form.value = { name: '', description: '', visibility: 'private' };
        creating.value = false;
        showToast('仓库已创建', 'success');
        router.push(`/repos/${data.repo_id}`);
      } catch (error) {
        showToast(error.message || '创建仓库失败', 'error');
      }
    };

    return {
      state,
      creating,
      form,
      repoCount,
      router,
      submitCreate,
    };
  },
  template: `
    <div class="space-y-6">
      <section class="flex flex-wrap items-start justify-between gap-3 rounded-[32px] border border-slate-200 bg-slate-50 px-6 py-6">
        <div>
          <div class="text-sm font-medium uppercase tracking-[0.24em] text-slate-400">Repositories</div>
          <h2 class="mt-2 text-3xl font-bold text-slate-900">我的项目仓库</h2>
          <p class="mt-2 text-sm leading-7 text-slate-500">私有仓库也可以邀请协作者共同维护。</p>
        </div>
        <div class="flex items-center gap-3">
          <span class="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">{{ repoCount }} 个仓库</span>
          <button class="rounded-2xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white" @click="creating = !creating">
            {{ creating ? '收起表单' : '新建仓库' }}
          </button>
        </div>
      </section>

      <section v-if="creating" class="rounded-[32px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="space-y-4">
            <input v-model="form.name" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="仓库名称，例如：高数期末复习项目">
            <textarea v-model="form.description" rows="5" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none" placeholder="仓库说明，可写用途、维护方式、约定等"></textarea>
          </div>
          <div class="space-y-4">
            <select v-model="form.visibility" class="w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none">
              <option value="private">私有仓库</option>
              <option value="public">公开到仓库大厅</option>
            </select>
            <button class="rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white" @click="submitCreate">创建并进入详情页</button>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-3">
        <article v-for="repo in state.myRepos" :key="repo.id" class="rounded-[32px] border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-xl font-semibold text-slate-900">{{ repo.name }}</h3>
              <p class="mt-2 text-sm leading-7 text-slate-500">{{ repo.description || '暂无说明' }}</p>
            </div>
            <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="repo.visibility === 'public' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'">
              {{ repo.visibility === 'public' ? '公开大厅可见' : '私有仓库' }}
            </span>
          </div>
          <div class="mt-4 space-y-2 text-sm text-slate-500">
            <div>拥有者：{{ repo.owner_username }}</div>
            <div>我的身份：{{ repo.my_role === 'owner' ? '拥有者' : repo.my_role === 'collaborator' ? '协作者' : '访客' }}</div>
            <div>文件数：{{ repo.file_count }} · 成员数：{{ repo.member_count }}</div>
          </div>
          <div class="mt-5 flex gap-2">
            <button class="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" @click="router.push('/repos/' + repo.id)">
              {{ repo.can_manage ? '管理仓库' : '查看仓库' }}
            </button>
          </div>
        </article>

        <div v-if="!state.myRepos.length" class="rounded-[32px] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500 xl:col-span-3">
          你还没有任何仓库。可以先创建一个，把长期维护和多人协作的内容迁过来。
        </div>
      </section>
    </div>
  `,
};
