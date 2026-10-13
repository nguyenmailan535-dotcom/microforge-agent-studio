"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3, Code2, Download, FileJson, LoaderCircle, LogOut, Menu, MoreHorizontal, Pencil, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";
import type { Blueprint, ValidationCheck } from "@/lib/agent-schema";

type Version = { id: string; createdAt: string; prompt: string; html: string; blueprint: Blueprint; checks: ValidationCheck[] };
type ConversationTurn = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
type Project = { id: string; name: string; prompt: string; html: string; blueprint: Blueprint; checks: ValidationCheck[]; versions: Version[]; history: ConversationTurn[]; createdAt: string; updatedAt: string };
type Profile = { email: string; name: string; role: string; createdAt: string; verifiedAt?: string };
type AnalyzeResponse = { blueprint: Blueprint; model: string };
type BuildResponse = { html: string; checks: ValidationCheck[]; repaired?: boolean; patched?: boolean; mode?: "full" | "compact" | "planned"; tasksCompleted?: number; model: string };
type PatchPlanResponse = { tasks: string[]; model: string };
const KEYS = { projects: "microforge.projects.v3", active: "microforge.active.v3", profile: "microforge.profile.v3" };
const EMPTY_BLUEPRINT: Blueprint = { title: "", summary: "", audience: "", requirements: [], dataModel: [], screens: [], acceptanceCriteria: [], visualDirection: "" };

export default function Home() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"new" | "workspace">("new");
  const [prompt, setPrompt] = useState("");
  const [tab, setTab] = useState<"preview" | "spec" | "code">("preview");
  const [generating, setGenerating] = useState(false);
  const [agentStep, setAgentStep] = useState(0);
  const [agentMessage, setAgentMessage] = useState("");
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renameProject, setRenameProject] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteProject, setDeleteProject] = useState<Project | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const activeProject = useMemo(() => projects.find((item) => item.id === activeId) || null, [projects, activeId]);

  useEffect(() => {
    queueMicrotask(() => {
      const storedProfile = readJson<Partial<Profile> | null>(KEYS.profile, null);
      const loadedProfile: Profile | null = storedProfile?.email ? {
        email: storedProfile.email,
        name: storedProfile.name?.trim() || storedProfile.email.split("@")[0],
        role: storedProfile.role || "",
        createdAt: storedProfile.createdAt || storedProfile.verifiedAt || new Date().toISOString(),
      } : null;
      const loadedProjects = migrateProjects();
      const savedActive = localStorage.getItem(KEYS.active);
      setProfile(loadedProfile);
      setProjects(loadedProjects);
      setActiveId(savedActive && loadedProjects.some((project) => project.id === savedActive) ? savedActive : null);
      setRegisterOpen(!loadedProfile);
      setReady(true);
    });
  }, []);
  useEffect(() => { if (!ready) return; localStorage.setItem(KEYS.projects, JSON.stringify(projects)); if (activeId) localStorage.setItem(KEYS.active, activeId); else localStorage.removeItem(KEYS.active); }, [projects, activeId, ready]);
  useEffect(() => { const onMessage = (event: MessageEvent) => { const data = event.data as { type?: string; projectId?: string; data?: unknown }; if (event.origin !== "null" || data?.type !== "MF_STORE" || !data.projectId) return; const known = readJson<Project[]>(KEYS.projects, []).some((project) => project.id === data.projectId); const serialized = JSON.stringify(data.data ?? null); if (known && serialized.length <= 1_000_000) localStorage.setItem(`microforge.runtime.${data.projectId}`, serialized); }; window.addEventListener("message", onMessage); return () => window.removeEventListener("message", onMessage); }, []);
  const flash = (message: string) => { setNotice(message); window.setTimeout(() => setNotice(null), 3200); };
  const saveProfile = (next: Profile) => { localStorage.setItem(KEYS.profile, JSON.stringify(next)); setProfile(next); setRegisterOpen(false); flash("工作区已初始化"); };
  const openProject = (project: Project) => { setActiveId(project.id); setPrompt(""); setView("workspace"); setTab("preview"); setSidebarOpen(false); setMenuId(null); setAgentMessage(""); setGenerationError(null); };
  const startNew = () => { setActiveId(null); setPrompt(""); setView("new"); setTab("preview"); setSidebarOpen(false); setAgentMessage(""); setGenerationError(null); };

  const generate = async () => {
    if (!profile) { setRegisterOpen(true); return; }
    const isIteration = view === "workspace" && Boolean(activeProject);
    if (prompt.trim().length < (isIteration ? 2 : 8)) { flash(isIteration ? "请描述本轮要修改的内容" : "请先描述应用目标、用户和关键流程"); return; }
    setGenerating(true); setAgentStep(0); setAgentMessage("正在理解需求并规划产品结构"); setGenerationError(null); setNotice(null);
    try {
      const requestPrompt = prompt.trim();
      const iterationProject = view === "workspace" ? activeProject : null;
      const analysis = iterationProject
        ? await runAgentStage<AnalyzeResponse>({ stage: "revise", prompt: requestPrompt, blueprint: iterationProject.blueprint })
        : await runAgentStage<AnalyzeResponse>({ stage: "analyze", prompt: requestPrompt });
      setAgentStep(1); setAgentMessage("需求已理解，正在生成完整应用代码");
      let result = iterationProject
        ? await runCodeStage({ stage: "iterate", prompt: requestPrompt, blueprint: analysis.blueprint, html: iterationProject.html }, true, setAgentMessage)
        : await runInitialBuild(requestPrompt, analysis.blueprint, setAgentMessage);
      setAgentStep(2); setAgentMessage("代码已生成，正在执行完整性与安全校验");
      if (result.checks.some((item) => !item.passed)) {
        setAgentMessage("检测到可修复问题，正在自动修复并重新校验");
        result = await runCodeStage({ stage: "repair", prompt: requestPrompt, blueprint: analysis.blueprint, html: result.html }, true, setAgentMessage);
      }
      const now = new Date().toISOString();
      const version: Version = { id: crypto.randomUUID(), createdAt: now, prompt: requestPrompt, html: result.html, blueprint: analysis.blueprint, checks: result.checks };
      const responseText = iterationProject
        ? `已完成修改并生成 v${iterationProject.versions.length + 1}。未要求变更的功能与现有数据会继续保留。`
        : result.mode === "planned"
          ? `Agent 已将需求拆解为 ${result.tasksCompleted || "多个"} 个有序任务，逐项生成、应用并校验补丁，初始版本“${analysis.blueprint.title}”已构建完成。`
          : result.mode === "compact"
            ? `Agent 已自动精简实现并生成初始版本“${analysis.blueprint.title}”，且已通过校验。`
            : `已生成初始版本“${analysis.blueprint.title}”并通过校验。`;
      const turns: ConversationTurn[] = [
        { id: crypto.randomUUID(), role: "user", content: requestPrompt, createdAt: now },
        { id: crypto.randomUUID(), role: "assistant", content: responseText, createdAt: now },
      ];
      const id = iterationProject?.id || crypto.randomUUID();
      setProjects((current) => {
        if (iterationProject) return current.map((item) => item.id === iterationProject.id ? { ...item, prompt: requestPrompt, html: result.html, blueprint: analysis.blueprint, checks: result.checks, versions: [version, ...item.versions].slice(0, 20), history: [...item.history, ...turns].slice(-40), updatedAt: now } : item);
        return [{ id, name: analysis.blueprint.title, prompt: requestPrompt, html: result.html, blueprint: analysis.blueprint, checks: result.checks, versions: [version], history: turns, createdAt: now, updatedAt: now }, ...current];
      });
      setActiveId(id); setPrompt(""); setView("workspace"); setTab("preview"); setAgentMessage("");
      flash(iterationProject ? (result.patched ? "修改已通过增量补丁应用并通过校验" : result.repaired ? "修改已应用，并完成一次自动修复" : "修改已应用并通过校验") : result.mode === "planned" ? "所有构建任务均已应用并通过校验" : result.mode === "compact" ? "自动精简成功，项目已生成并通过校验" : result.repaired ? "已生成，并完成一次自动修复" : "已生成并通过校验");
    } catch (error) {
      const message = error instanceof Error ? error.message : "生成失败，请稍后重试";
      setGenerationError(message); setAgentMessage("");
    } finally { setGenerating(false); }
  };

  const confirmRename = () => { if (!renameProject || !renameValue.trim()) return; setProjects((current) => current.map((item) => item.id === renameProject.id ? { ...item, name: renameValue.trim().slice(0, 80), updatedAt: new Date().toISOString() } : item)); setRenameProject(null); flash("项目已重命名"); };
  const confirmDelete = () => { if (!deleteProject) return; const target = deleteProject; setProjects((current) => current.filter((item) => item.id !== target.id)); localStorage.removeItem(`microforge.runtime.${target.id}`); if (activeId === target.id) startNew(); setDeleteProject(null); flash("项目及其运行数据已删除"); };
  const restoreVersion = (version: Version) => { if (!activeProject) return; const now = new Date().toISOString(); const restored: Version = { ...version, id: crypto.randomUUID(), createdAt: now, prompt: `恢复版本：${version.prompt}` }; const turn: ConversationTurn = { id: crypto.randomUUID(), role: "assistant", content: `已将应用恢复到 ${formatTime(version.createdAt)} 的版本，并创建新的当前版本。`, createdAt: now }; setProjects((current) => current.map((item) => item.id === activeProject.id ? { ...item, prompt: restored.prompt, html: restored.html, blueprint: restored.blueprint, checks: restored.checks, versions: [restored, ...item.versions].slice(0, 20), history: [...item.history, turn].slice(-40), updatedAt: now } : item)); setPrompt(""); flash("已恢复并保存为新版本"); };
  const exportProject = () => { if (activeProject) download(`${safeFilename(activeProject.name)}.html`, buildStandaloneDocument(activeProject.html, activeProject.id), "text/html"); };
  const exportBackup = () => { const runtime: Record<string, unknown> = {}; projects.forEach((project) => { runtime[project.id] = readJson(`microforge.runtime.${project.id}`, null); }); download(`microforge-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ schemaVersion: 3, profile, projects, runtime }, null, 2), "application/json"); };
  const importBackup = async (file: File) => { try { const data = JSON.parse(await file.text()) as { projects?: Project[]; runtime?: Record<string, unknown> }; if (!Array.isArray(data.projects)) throw new Error("备份文件格式无效"); const imported = data.projects.map(normalizeProject); setProjects(imported); Object.entries(data.runtime || {}).forEach(([id, value]) => localStorage.setItem(`microforge.runtime.${id}`, JSON.stringify(value))); setActiveId(null); setView("new"); flash(`已导入 ${imported.length} 个项目`); } catch (error) { flash(error instanceof Error ? error.message : "导入失败"); } };

  if (!ready) return <div className="loading-screen"><LoaderCircle className="spin" /> 正在初始化工作区…</div>;
  return <main className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Sparkles size={18} /></div><div><strong>MicroForge</strong><span>Agent Studio</span></div><button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏"><X size={18} /></button></div>
      <button className="new-button" onClick={startNew}><Plus size={17} /> 新建项目</button>
      <div className="side-label"><span>你的项目</span><span>{String(projects.length).padStart(2, "0")}</span></div>
      <div className="project-list">{projects.length === 0 ? <div className="side-empty">完成第一次生成后，项目会保存在这里。</div> : projects.map((project, index) => <div className={`project-row ${activeId === project.id ? "active" : ""}`} key={project.id}>
        <button className="project-main" onClick={() => openProject(project)}><span className="project-icon"><Check size={18} /></span><span className="project-copy"><strong>{project.name}</strong><small>{relativeTime(project.updatedAt)} · v{project.versions.length}</small></span><span className="project-index">{String(index + 1).padStart(2, "0")}</span></button>
        <button className="project-more" onClick={() => setMenuId(menuId === project.id ? null : project.id)} aria-label={`${project.name} 菜单`}><MoreHorizontal size={17} /></button>
        {menuId === project.id && <div className="project-menu"><button onClick={() => { setRenameProject(project); setRenameValue(project.name); setMenuId(null); }}><Pencil size={15} /> 重命名</button><button className="danger" onClick={() => { setDeleteProject(project); setMenuId(null); }}><Trash2 size={15} /> 删除</button></div>}
      </div>)}</div>
      <div className="sidebar-footer"><button onClick={exportBackup}><Download size={16} /> 导出备份</button><button onClick={() => fileInput.current?.click()}><FileJson size={16} /> 导入备份</button><input ref={fileInput} type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importBackup(file); event.target.value = ""; }} /></div>
    </aside>
    {sidebarOpen && <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="关闭侧栏" />}
    <section className="main-panel">
      <header className="topbar"><button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="打开侧栏"><Menu size={20} /></button><div className="breadcrumb"><span>MicroForge</span><ChevronRight size={14} /><strong>{activeProject?.name || "新建项目"}</strong></div><div className="account"><div className="avatar">{profile?.name?.slice(0, 1).toUpperCase() || <UserRound size={16} />}</div><div><strong>{profile?.name || "访客"}</strong><span>{profile?.email || "邮箱待填写"}</span></div>{profile ? <button className="icon-button" title="退出本机账户" onClick={() => { localStorage.removeItem(KEYS.profile); setProfile(null); setRegisterOpen(true); }}><LogOut size={16} /></button> : <button className="text-button" onClick={() => setRegisterOpen(true)}>注册</button>}</div></header>
      {view === "new" || !activeProject ? <NewProject prompt={prompt} setPrompt={setPrompt} generate={generate} generating={generating} agentStep={agentStep} agentMessage={agentMessage} generationError={generationError} /> : <Workspace project={activeProject} prompt={prompt} setPrompt={setPrompt} generate={generate} generating={generating} agentStep={agentStep} agentMessage={agentMessage} generationError={generationError} tab={tab} setTab={setTab} onExport={exportProject} onRestore={restoreVersion} />}
    </section>
    {registerOpen && <RegisterModal onComplete={saveProfile} onClose={profile ? () => setRegisterOpen(false) : undefined} />}
    {renameProject && <Modal title="重命名项目" onClose={() => setRenameProject(null)}><label className="field-label">项目名称<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") confirmRename(); }} maxLength={80} /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setRenameProject(null)}>取消</button><button className="primary-button" onClick={confirmRename}>保存名称</button></div></Modal>}
    {deleteProject && <Modal title="删除项目？" onClose={() => setDeleteProject(null)}><p className="modal-copy">将永久删除“{deleteProject.name}”及其版本和运行数据。此操作无法撤销。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteProject(null)}>取消</button><button className="danger-button" onClick={confirmDelete}><Trash2 size={16} /> 确认删除</button></div></Modal>}
    {notice && <div className="toast"><CheckCircle2 size={18} /> {notice}</div>}
  </main>;
}

async function runAgentStage<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: (T & { error?: string; code?: string }) | null = null;
  try { payload = JSON.parse(text) as T & { error?: string; code?: string }; } catch { /* handled below */ }
  if (!response.ok || !payload) {
    throw new AgentStageError(payload?.error || `Agent 阶段执行失败（${response.status}）`, payload?.code || "UNKNOWN", response.status);
  }
  return payload;
}

async function runCodeStage(body: Record<string, unknown>, allowPatch: boolean, onProgress: (message: string) => void): Promise<BuildResponse> {
  if (allowPatch && body.stage === "iterate" && shouldPlanPatches(body)) {
    onProgress("修改范围较大，正在拆解为多个可执行步骤");
    return runPlannedPatches(body, onProgress);
  }
  try {
    return await runAgentStage<BuildResponse>(body);
  } catch (error) {
    if (!(error instanceof AgentStageError) || error.code !== "OUTPUT_TOO_LONG") throw error;
  }
  onProgress("生成内容较长，正在压缩结构并重新生成（2/3）");
  try {
    return await runAgentStage<BuildResponse>({ ...body, compact: true });
  } catch (error) {
    if (!(error instanceof AgentStageError) || error.code !== "OUTPUT_TOO_LONG") throw error;
  }
  if (!allowPatch) {
    throw new AgentStageError("自动精简未能完成，请调整需求后重试", "COMPACT_BUILD_FAILED", 422);
  }
  if (body.stage === "iterate") {
    onProgress("完整源码较长，正在拆解并逐步应用修改");
    return runPlannedPatches(body, onProgress);
  }
  onProgress("修复内容较长，正在使用增量补丁完成校验");
  try {
    return await runAgentStage<BuildResponse>({ ...body, compact: false, patch: true });
  } catch (error) {
    if (error instanceof AgentStageError && error.code === "OUTPUT_TOO_LONG") {
      throw new AgentStageError("本轮增量修改仍超过模型输出上限，请将要求拆成两次修改后重试", error.code, error.status);
    }
    throw error;
  }
}

async function runInitialBuild(prompt: string, blueprint: Blueprint, onProgress: (message: string) => void): Promise<BuildResponse> {
  onProgress("正在把产品规格拆解为有序的小型构建任务");
  const [plan, bootstrap] = await Promise.all([
    runAgentStage<PatchPlanResponse>({ stage: "plan_build", prompt, blueprint }),
    runAgentStage<BuildResponse>({ stage: "bootstrap", prompt, blueprint }),
  ]);
  let html = bootstrap.html;
  let latest: BuildResponse = bootstrap;
  const splitBudget = { remaining: 24 };
  for (let index = 0; index < plan.tasks.length; index += 1) {
    const task = plan.tasks[index];
    onProgress(`正在构建第 ${index + 1}/${plan.tasks.length} 项：${task.slice(0, 32)}`);
    latest = await runPatchTask(task, blueprint, html, onProgress, splitBudget);
    html = latest.html;
  }
  onProgress("全部子任务已完成，正在汇总并确认最终结果");
  return { ...latest, html, patched: true, mode: "planned", tasksCompleted: plan.tasks.length };
}

function shouldPlanPatches(body: Record<string, unknown>) {
  const prompt = String(body.prompt || "");
  const html = String(body.html || "");
  const separators = prompt.match(/[、，,；;]/g)?.length || 0;
  return html.length > 24_000 || separators >= 2 || /(?:多个|若干|等模块)|同时.{0,12}(?:增加|添加|引入|实现)/.test(prompt);
}

async function runPlannedPatches(body: Record<string, unknown>, onProgress: (message: string) => void): Promise<BuildResponse> {
  const prompt = String(body.prompt || "");
  const blueprint = body.blueprint;
  let html = String(body.html || "");
  const plan = await runAgentStage<PatchPlanResponse>({ stage: "plan_patch", prompt, blueprint });
  let latest: BuildResponse | null = null;
  const splitBudget = { remaining: 24 };
  for (let index = 0; index < plan.tasks.length; index += 1) {
    const task = plan.tasks[index];
    onProgress(`正在应用第 ${index + 1}/${plan.tasks.length} 个修改：${task.slice(0, 28)}`);
    latest = await runPatchTask(task, blueprint, html, onProgress, splitBudget);
    html = latest.html;
  }
  if (!latest) throw new AgentStageError("未生成可执行的增量修改计划", "EMPTY_PATCH_PLAN", 502);
  return { ...latest, html, patched: true };
}

async function runPatchTask(task: string, blueprint: unknown, html: string, onProgress: (message: string) => void, splitBudget: { remaining: number }, depth = 0): Promise<BuildResponse> {
  try {
    return await runAgentStage<BuildResponse>({ stage: "iterate", prompt: task, blueprint, html, patch: true });
  } catch (error) {
    if (!(error instanceof AgentStageError) || !["OUTPUT_TOO_LONG", "PATCH_VALIDATION_FAILED", "PATCH_APPLY_FAILED", "PATCH_FORMAT_INVALID", "PATCH_SIZE_LIMIT"].includes(error.code)) throw error;
  }
  if (splitBudget.remaining <= 0 || depth >= 4) {
    throw new AgentStageError("任务已多次自动回滚和拆分但仍无法形成有效补丁，请缩小该项需求后重试", "PATCH_SPLIT_LIMIT", 422);
  }
  splitBudget.remaining -= 1;
  onProgress(`当前步骤未通过校验，已回滚；正在进一步拆分：${task.slice(0, 30)}`);
  const subPlan = await runAgentStage<PatchPlanResponse>({ stage: "plan_patch", prompt: `进一步拆分该子任务，确保每项只涉及一个数据字段、一个界面区域或一组紧密相关交互。每项补丁必须复用现有代码，不复制完整文档、样式或脚本：${task}`, blueprint });
  let currentHtml = html;
  let latest: BuildResponse | null = null;
  for (let index = 0; index < subPlan.tasks.length; index += 1) {
    const subTask = subPlan.tasks[index];
    onProgress(`正在处理拆分后的 ${index + 1}/${subPlan.tasks.length} 项：${subTask.slice(0, 28)}`);
    latest = await runPatchTask(subTask, blueprint, currentHtml, onProgress, splitBudget, depth + 1);
    currentHtml = latest.html;
  }
  if (!latest) throw new AgentStageError("未生成可执行的子任务计划", "EMPTY_PATCH_PLAN", 502);
  return { ...latest, html: currentHtml, patched: true };
}

class AgentStageError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = "AgentStageError";
  }
}

function NewProject({ prompt, setPrompt, generate, generating, agentStep, agentMessage, generationError }: { prompt: string; setPrompt: (value: string) => void; generate: () => void; generating: boolean; agentStep: number; agentMessage: string; generationError: string | null }) {
  return <div className="new-view"><div className="new-intro"><h1>描述应用需求</h1></div><div className="prompt-card"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !generating && prompt.trim().length >= 8) { event.preventDefault(); generate(); } }} placeholder="描述要解决的问题、目标用户、关键流程、数据和约束。例如：需要哪些角色？用户要完成什么操作？哪些数据必须保存？" rows={8} maxLength={6000} disabled={generating} /><div className="prompt-footer"><div className="prompt-meta"><span>{prompt.length} / 6000</span><small>Ctrl / ⌘ + Enter 快速提交</small></div><button className="generate-button" onClick={generate} disabled={generating || prompt.trim().length < 8}>{generating ? <><LoaderCircle className="spin" size={18} /> Agent 工作中</> : <><Sparkles size={18} /> 开始构建</>}</button></div></div><AgentFlow active={generating ? agentStep : -1} /><GenerationFeedback generating={generating} message={agentMessage} error={generationError} onRetry={generate} /><p className="privacy-note"><ShieldCheck size={15} /> 生成代码将在隔离 iframe 中运行，应用数据通过受控桥接保存在本机。</p></div>;
}

function Workspace({ project, prompt, setPrompt, generate, generating, agentStep, agentMessage, generationError, tab, setTab, onExport, onRestore }: { project: Project; prompt: string; setPrompt: (value: string) => void; generate: () => void; generating: boolean; agentStep: number; agentMessage: string; generationError: string | null; tab: "preview" | "spec" | "code"; setTab: (tab: "preview" | "spec" | "code") => void; onExport: () => void; onRestore: (version: Version) => void }) {
  const srcDoc = useMemo(() => buildSandboxDocument(project.html, project.id), [project.html, project.id]);
  return <div className="workspace"><div className="workspace-head"><div><span className="back-link"><ArrowLeft size={15} /> 项目工作区</span><h1>{project.name}</h1><p>{project.blueprint.summary}</p></div><button className="secondary-button" onClick={onExport}><Download size={16} /> 导出 HTML</button></div><IterationHistory history={project.history} /><div className="iteration-bar"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !generating && prompt.trim().length >= 2) { event.preventDefault(); generate(); } }} rows={2} maxLength={6000} placeholder="描述本轮修改，未提及的功能会保留…" disabled={generating} /><button onClick={generate} disabled={generating || prompt.trim().length < 2} title="应用修改（Ctrl / ⌘ + Enter）">{generating ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />} 应用修改</button></div>{generating && <AgentFlow active={agentStep} compact />}<GenerationFeedback generating={generating} message={agentMessage} error={generationError} onRetry={generate} compact /><div className="tabs"><button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}><Play size={15} /> Preview</button><button className={tab === "spec" ? "active" : ""} onClick={() => setTab("spec")}><FileJson size={15} /> Spec</button><button className={tab === "code" ? "active" : ""} onClick={() => setTab("code")}><Code2 size={15} /> Code</button></div><div className="workspace-body"><div className="artifact-panel">{tab === "preview" && <div className="preview-shell"><div className="browser-bar"><span /><span /><span /><strong>sandbox://{project.id.slice(0, 8)}</strong><em><ShieldCheck size={13} /> 隔离运行</em></div><iframe srcDoc="" ref={(node) => { if (node) window.setTimeout(() => { if (node.isConnected && node.srcdoc !== srcDoc) node.srcdoc = srcDoc; }, 0); }} title={`${project.name} 预览`} sandbox="allow-scripts allow-forms allow-modals allow-downloads" /></div>}{tab === "spec" && <SpecView blueprint={project.blueprint} checks={project.checks} />}{tab === "code" && <pre className="code-view"><code>{project.html}</code></pre>}</div><aside className="versions"><h2><Clock3 size={17} /> 版本记录</h2>{project.versions.map((version, index) => <div className="version" key={version.id}><div><strong>v{project.versions.length - index}</strong><span>{formatTime(version.createdAt)}</span></div><p>{version.prompt}</p>{index === 0 ? <small><CheckCircle2 size={13} /> 当前版本</small> : <button onClick={() => onRestore(version)}>恢复</button>}</div>)}</aside></div></div>;
}

function GenerationFeedback({ generating, message, error, onRetry, compact = false }: { generating: boolean; message: string; error: string | null; onRetry: () => void; compact?: boolean }) {
  if (!generating && !error) return null;
  return <div className={`generation-feedback ${error ? "error" : "working"} ${compact ? "compact" : ""}`} role={error ? "alert" : "status"} aria-live="polite">{error ? <CircleAlert size={17} /> : <LoaderCircle className="spin" size={17} />}<div><strong>{error ? "本次生成未完成" : "Agent 正在继续处理"}</strong><span>{error || message || "正在处理，请稍候…"}</span></div>{error && <button type="button" onClick={onRetry}><RefreshCw size={14} /> 重新生成</button>}</div>;
}

function IterationHistory({ history }: { history: ConversationTurn[] }) {
  const visible = history.slice(-6);
  return <section className="iteration-history" aria-label="迭代记录"><div className="iteration-history-head"><strong>迭代记录</strong><span>{Math.ceil(history.length / 2)} 轮</span></div><div className="iteration-messages">{visible.map((turn) => <div className={`iteration-message ${turn.role}`} key={turn.id}><span className="message-avatar">{turn.role === "user" ? <UserRound size={14} /> : <Sparkles size={14} />}</span><div><small>{turn.role === "user" ? "你的要求" : "Agent"} · {formatTime(turn.createdAt)}</small><p>{turn.content}</p></div></div>)}</div></section>;
}

function AgentFlow({ active, compact = false }: { active: number; compact?: boolean }) { const stages = [{ icon: FileJson, title: "理解需求", copy: "提取目标、实体与流程" }, { icon: Code2, title: "生成代码", copy: "拆解任务并逐步构建" }, { icon: ShieldCheck, title: "校验结果", copy: "逐步校验、回滚与修复" }]; return <div className={`agent-flow ${compact ? "compact" : ""}`}>{stages.map((stage, index) => { const Icon = stage.icon; const state = active < 0 ? "idle" : index < active ? "done" : index === active ? "active" : "waiting"; return <div className={`agent-stage ${state}`} key={stage.title}><span className="stage-icon">{state === "done" ? <Check size={18} /> : state === "active" ? <LoaderCircle className="spin" size={18} /> : <Icon size={18} />}</span><div><strong>{stage.title}</strong>{!compact && <span>{stage.copy}</span>}</div>{index < stages.length - 1 && <i />}</div>; })}</div>; }

function SpecView({ blueprint, checks }: { blueprint: Blueprint; checks: ValidationCheck[] }) { return <div className="spec-view"><section><span className="eyebrow">产品理解</span><h2>{blueprint.title}</h2><p>{blueprint.summary}</p><div className="spec-meta"><strong>目标用户</strong><span>{blueprint.audience}</span><strong>视觉方向</strong><span>{blueprint.visualDirection}</span></div></section><div className="spec-grid"><section><h3>核心需求</h3><ul>{blueprint.requirements.map((item) => <li key={item}><CheckCircle2 size={15} /> {item}</li>)}</ul></section><section><h3>页面与流程</h3>{blueprint.screens.map((screen) => <div className="screen-spec" key={screen.name}><strong>{screen.name}</strong><span>{screen.purpose}</span><small>{screen.actions.join(" · ")}</small></div>)}</section><section><h3>数据模型</h3>{blueprint.dataModel.length ? blueprint.dataModel.map((model) => <div className="data-model" key={model.name}><strong>{model.name}</strong><span>{model.fields.map((field) => field.name).join(" · ")}</span></div>) : <p>此应用无需结构化数据。</p>}</section><section><h3>校验结果</h3><ul>{checks.map((item) => <li key={item.id} className={item.passed ? "pass" : "fail"}>{item.passed ? <CheckCircle2 size={15} /> : <X size={15} />}<span><strong>{item.label}</strong><small>{item.detail}</small></span></li>)}</ul></section></div></div>; }

function RegisterModal({ onComplete, onClose }: { onComplete: (profile: Profile) => void; onClose?: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const normalizedEmail = email.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) && normalizedEmail.length <= 160;
  const submit = () => {
    if (!validEmail) return;
    onComplete({
      email: normalizedEmail,
      name: name.trim() || normalizedEmail.split("@")[0],
      role: role.trim(),
      createdAt: new Date().toISOString(),
    });
  };
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="register-title"><div className="register-modal">{onClose && <button className="modal-close" onClick={onClose}><X size={18} /></button>}<div className="register-brand"><div className="brand-mark"><Sparkles size={20} /></div><span>MicroForge</span></div><h2 id="register-title">初始化你的工作区</h2><p>填写邮箱即可开始使用。无需验证码，资料和项目仅保存在当前浏览器。</p><label className="field-label">邮箱地址<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoFocus onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /></label><label className="field-label">你的名字（选填）<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="默认使用邮箱前缀" /></label><label className="field-label">角色（选填）<input value={role} onChange={(event) => setRole(event.target.value)} maxLength={60} placeholder="例如：Agent 开发实习生" /></label><button className="primary-button full" onClick={submit} disabled={!validEmail}><CheckCircle2 size={17} /> 进入工作区</button><p className="terms">邮箱仅用于标识此浏览器中的本地工作区，不会发送验证邮件。</p></div></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-layer" role="dialog" aria-modal="true"><div className="small-modal"><button className="modal-close" onClick={onClose}><X size={18} /></button><h2>{title}</h2>{children}</div></div>; }
function buildSandboxDocument(html: string, projectId: string) { const initial = readJson(`microforge.runtime.${projectId}`, null); const bridge = `<script>(function(){const projectId=${safeJson(projectId)};let value=${safeJson(initial)};window.microforgeStore={get:async()=>value,set:async next=>{value=next;parent.postMessage({type:'MF_STORE',projectId,data:next},'*');return true},remove:async()=>{value=null;parent.postMessage({type:'MF_STORE',projectId,data:null},'*');return true}}})()<\/script>`; return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`) : bridge + html; }
function buildStandaloneDocument(html: string, projectId: string) { const key = `microforge.exported.${projectId}`; const bridge = `<script>(function(){const key=${safeJson(key)};window.microforgeStore={get:async()=>{try{return JSON.parse(localStorage.getItem(key))}catch{return null}},set:async value=>{localStorage.setItem(key,JSON.stringify(value));return true},remove:async()=>{localStorage.removeItem(key);return true}}})()<\/script>`; return /<head[^>]*>/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`) : bridge + html; }
function normalizeProject(project: Project): Project {
  const time = project.updatedAt || project.createdAt || new Date().toISOString();
  const history = Array.isArray(project.history) && project.history.length ? project.history : [
    { id: crypto.randomUUID(), role: "user" as const, content: project.prompt || "继续完善这个应用", createdAt: time },
    { id: crypto.randomUUID(), role: "assistant" as const, content: "已有版本已载入，可以继续提出修改。", createdAt: time },
  ];
  return { ...project, history };
}
function migrateProjects(): Project[] { const current = readJson<Project[]>(KEYS.projects, []); if (current.length) return current.map(normalizeProject); const old = readJson<Array<Record<string, unknown>>>("microforge.projects.v2", []); const migrated = old.map((item) => { const spec = (item.spec || {}) as Record<string, unknown>; const name = String(item.name || spec.name || "未命名项目"); const prompt = String(spec.prompt || item.prompt || "从旧版本迁移的项目"); const html = String(item.html || ""); const time = String(item.updatedAt || item.createdAt || new Date().toISOString()); const blueprint: Blueprint = { ...EMPTY_BLUEPRINT, title: name, summary: "从 MicroForge v2 迁移的项目", audience: "原项目用户", requirements: ["保留旧版本功能", "继续支持本地持久化"], acceptanceCriteria: ["项目可正常预览", "数据能够保存"], visualDirection: "沿用原项目视觉", screens: [{ name: "主界面", purpose: "保留原项目体验", actions: [] }] }; const checks: ValidationCheck[] = []; const version: Version = { id: crypto.randomUUID(), createdAt: time, prompt, html, blueprint, checks }; return normalizeProject({ id: String(item.id || crypto.randomUUID()), name, prompt, html, blueprint, checks, versions: [version], history: [], createdAt: String(item.createdAt || time), updatedAt: time }); }); if (migrated.length) localStorage.setItem(KEYS.projects, JSON.stringify(migrated)); return migrated; }
function readJson<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function safeJson(value: unknown) { return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e"); }
function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url); }
function safeFilename(value: string) { return value.replace(/[\\/:*?"<>|]/g, "-").slice(0, 70) || "microforge-app"; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function relativeTime(value: string) { const diff = Date.now() - new Date(value).getTime(); if (diff < 60_000) return "刚刚"; if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`; if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`; return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value)); }
