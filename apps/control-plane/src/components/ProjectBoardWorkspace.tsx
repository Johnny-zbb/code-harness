import { useState, type ComponentType, type ReactNode } from "react";
import { RiAddLine, RiArrowUpDownLine, RiFilter3Line, RiLayoutColumnLine, RiNotification3Line, RiInbox2Line, RiMoreLine, RiFolderLine, RiArrowRightSLine, RiCheckLine, RiKanbanView2 } from "@remixicon/react";
import { Button } from "@/components/boardui/base/buttons/button";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Avatar } from "@/components/boardui/base/avatar/avatar";
import { Chip } from "@/components/boardui/base/badges/chip";
import { Dropdown, DropdownTrigger, DropdownPopover, DropdownGroup, DropdownItem, DropdownDivider } from "@/components/boardui/base/dropdown/dropdown";
import { DashboardSidebar } from "@/components/boardui/application/dashboard/dashboard-sidebar";
import { ScrollRegion } from "./ScrollRegion";
import { boardStatus, priorities, repoName, type BoardSnapshot } from "../board";
import { cx } from "@/utils/cx";

const stages = [
  { key: "backlog", title: "待规划", hint: "准备好后移入待办", statuses: ["backlog"] },
  { key: "todo", title: "待办", hint: "Agent 自动领取", statuses: ["queued"] },
  { key: "doing", title: "进行中", hint: "开发与独立验证", statuses: ["running", "verifying"] },
  { key: "review", title: "验收", hint: "查看报告，再决定合入", statuses: ["review", "approved", "blocked"] },
  { key: "done", title: "完成", hint: "已确认并合入", statuses: ["merged"] },
];
const shortDate = (date: string) => new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(date));
const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };

function ToolMenu({ label, icon: Icon, active, children }: { label: string; icon: ComponentType<{ size?: string | number }>; active?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Dropdown isOpen={open} onOpenChange={setOpen}>
    <DropdownTrigger aria-label={label} className={cx("project-tool", active && "project-tool-active")}><Icon size={20} /></DropdownTrigger>
    <DropdownPopover aria-label={label} placement="bottom end">{children(() => setOpen(false))}</DropdownPopover>
  </Dropdown>;
}

export function ProjectBoardWorkspace({ snapshot, error, search, onSearch, dark, onThemeChange, onDemo, onCreate, onOpenTask, onMove }: {
  snapshot: BoardSnapshot | null; error: string; search: string; onSearch: (value: string) => void; dark: boolean; onThemeChange: (dark: boolean) => void; onDemo: () => void;
  onCreate: (backlog: boolean) => void; onOpenTask: (id: string) => void; onMove: (id: string, status: "backlog" | "queued") => Promise<void>;
}) {
  const [view, setView] = useState("all");
  const [repo, setRepo] = useState("all");
  const [sort, setSort] = useState("oldest");
  const [compact, setCompact] = useState(false);
  const [labels, setLabels] = useState(true);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const tasks = snapshot?.tasks || [];
  const reviewCount = tasks.filter((task) => ["review", "approved", "blocked"].includes(task.status)).length;
  const doneCount = tasks.filter((task) => task.status === "merged").length;
  const repositories = [...new Set(tasks.map((task) => task.repo))];
  const visible = tasks.filter((task) => {
    const matchesView = view === "all" || (view === "review" ? ["review", "approved", "blocked"].includes(task.status) : task.status === "merged");
    return matchesView && (repo === "all" || repo === task.repo) && `${task.title} ${task.description} ${repoName(task.repo)}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }).sort((a, b) => sort === "priority" ? priorityOrder[a.priority || "medium"] - priorityOrder[b.priority || "medium"] || a.createdAt.localeCompare(b.createdAt) : sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt));
  const filterActive = view !== "all" || repo !== "all";
  return <div className="project-app">
    <DashboardSidebar selected={view} onSelect={setView} onDemo={onDemo} search={search} onSearch={onSearch} dark={dark} onThemeChange={onThemeChange} counts={{ all: tasks.length, review: reviewCount, done: doneCount }} repository={repoName(snapshot?.defaultRepo || "")} runner={snapshot?.runner || "codex"} />
    <main className="project-main">
      <div className="project-breadcrumb text-body-2-medium"><Avatar size="xs" initials="K" /><span>Kumo 工作空间</span><RiArrowRightSLine size={16} /><span>{repoName(snapshot?.defaultRepo || "code-harness")}</span><RiArrowRightSLine size={16} /><span className="text-text-primary">任务看板</span></div>
      <header className="project-header">
        <h1 className="text-title-2-medium">开发任务看板</h1>
        <div className="project-toolbar">
          <span className="project-notification"><IconButton icon={RiNotification3Line} aria-label={`等待验收 ${reviewCount} 个任务`} size="small" onClick={() => setView(view === "review" ? "all" : "review")} />{reviewCount > 0 && <span className="project-notification-count">{reviewCount}</span>}</span>
          <IconButton icon={RiInbox2Line} size="small" aria-label="查看已完成任务" onClick={() => setView(view === "done" ? "all" : "done")} />
          <span className="project-toolbar-divider" />
          <ToolMenu label="排序" icon={RiArrowUpDownLine} active={sort !== "oldest"}>{(close) => <DropdownGroup label="任务排序">{[["oldest", "最早创建"], ["newest", "最新创建"], ["priority", "优先级"]].map(([key, label]) => <DropdownItem key={key} selected={sort === key} onSelect={() => { setSort(key); close(); }}><span className="flex-1">{label}</span>{sort === key && <RiCheckLine size={16} />}</DropdownItem>)}</DropdownGroup>}</ToolMenu>
          <ToolMenu label="筛选" icon={RiFilter3Line} active={filterActive}>{(close) => <><DropdownGroup label="任务视图">{[["all", "全部任务"], ["review", "等待验收"], ["done", "已完成"]].map(([key, label]) => <DropdownItem key={key} selected={view === key} onSelect={() => { setView(key); close(); }}>{label}</DropdownItem>)}</DropdownGroup><DropdownDivider /><DropdownGroup label="仓库"><DropdownItem selected={repo === "all"} onSelect={() => { setRepo("all"); close(); }}>全部仓库</DropdownItem>{repositories.map((path) => <DropdownItem key={path} selected={repo === path} onSelect={() => { setRepo(path); close(); }}><RiFolderLine size={16} />{repoName(path)}</DropdownItem>)}</DropdownGroup></>}</ToolMenu>
          <ToolMenu label="显示设置" icon={RiLayoutColumnLine} active={compact || !labels}>{() => <DropdownGroup label="看板显示"><DropdownItem selected={compact} onSelect={() => setCompact(!compact)}><span className="flex-1">紧凑卡片</span>{compact && <RiCheckLine size={16} />}</DropdownItem><DropdownItem selected={labels} onSelect={() => setLabels(!labels)}><span className="flex-1">显示优先级与仓库</span>{labels && <RiCheckLine size={16} />}</DropdownItem></DropdownGroup>}</ToolMenu>
          <Button leadingIcon={RiAddLine} size="small" onClick={() => onCreate(false)}>新建任务</Button>
        </div>
      </header>
      {snapshot?.runner === "test-fixture" && <div className="project-fixture-notice text-caption-1-medium">测试预览 · 临时 Git 仓库与确定性执行器</div>}
      {error && <p className="board-error" role="alert">{error}</p>}
      {(filterActive || search) && <div className="project-filter-summary text-caption-1-medium"><span>显示 {visible.length} / {tasks.length} 个任务</span><Button size="small" variant="ghost" onClick={() => { setView("all"); setRepo("all"); onSearch(""); }}>清除筛选</Button></div>}
      <div className={cx("project-columns", compact && "project-columns-compact")} aria-label="任务看板" role="region" tabIndex={0}>
        {stages.map((stage) => {
          const stageTasks = visible.filter((task) => stage.statuses.includes(task.status));
          const canDrop = ["backlog", "todo"].includes(stage.key);
          return <section key={stage.key} className={cx("project-column", dropStage === stage.key && "project-column-drop")} aria-label={`${stage.title} ${stageTasks.length} 个任务`} onDragOver={(event) => { if (canDrop && dragged) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropStage(stage.key); } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropStage(null); }} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (canDrop && id && id === dragged) void onMove(id, stage.key === "backlog" ? "backlog" : "queued"); setDragged(null); setDropStage(null); }}>
            <header className="project-column-header"><h2 className="text-body-medium">{stage.title}<span className="project-column-count text-body-2-regular">{stageTasks.length}</span></h2><div><ToolMenu label={`${stage.title}列操作`} icon={RiMoreLine}>{(close) => <DropdownGroup label={stage.title}><DropdownItem onSelect={() => { setView(stage.key === "review" ? "review" : stage.key === "done" ? "done" : "all"); close(); }}>查看{stage.key === "review" || stage.key === "done" ? stage.title : "全部"}任务</DropdownItem>{canDrop && <DropdownItem onSelect={() => { onCreate(stage.key === "backlog"); close(); }}>在这里新增任务</DropdownItem>}</DropdownGroup>}</ToolMenu>{canDrop && <IconButton icon={RiAddLine} size="small" aria-label={`新增${stage.title}任务`} onClick={() => onCreate(stage.key === "backlog")} />}</div></header>
            <ScrollRegion containerClassName="project-column-region" className="project-column-scroll" tabIndex={0} aria-label={`${stage.title}任务列表`}>
              {stageTasks.map((task) => {
                const priority = priorities[task.priority || "medium"];
                const number = tasks.findIndex((item) => item.id === task.id) + 1;
                const ready = ["backlog", "queued"].includes(task.status) && !task.attempts.length;
                return <button key={task.id} type="button" className="project-card" aria-label={`KM-${number.toString().padStart(2, "0")} ${task.title}，${boardStatus[task.status].label}`} onClick={() => onOpenTask(task.id)} draggable={ready} onDragStart={(event) => { event.dataTransfer.setData("text/plain", task.id); event.dataTransfer.effectAllowed = "move"; setDragged(task.id); }} onDragEnd={() => { setDragged(null); setDropStage(null); }}>
                  <div className="project-card-top text-caption-1-regular"><span className="project-card-reference">KM-{number.toString().padStart(2, "0")}<RiArrowRightSLine size={12} /><span title={task.repo}>{repoName(task.repo)}</span></span><span className="project-assignees">{task.attempts.length ? <><Avatar initials="C" size="xs" title="开发 Agent" /><Avatar initials="V" size="xs" title="验证 Agent" /></> : <Avatar initials="K" size="xs" title="由你创建" />}</span></div>
                  {labels && <div className="project-card-labels"><Chip color={priority.color} variant="caption">{priority.label}优先级</Chip><span className="project-repo-chip text-caption-1-medium"><RiFolderLine size={12} />{repoName(task.repo)}</span></div>}
                  <h3 className="text-body-medium">{task.title}</h3>
                  <div className="project-card-bottom text-caption-1-regular"><span>{task.status === "merged" ? "完成于" : "创建于"} {shortDate(task.status === "merged" ? task.updatedAt : task.createdAt)}</span>{["running", "verifying", "blocked", "approved"].includes(task.status) && <span className={cx("project-card-status", task.status === "blocked" && "text-text-error-primary")}><span className={cx("project-status-dot", ["running", "verifying"].includes(task.status) && "project-status-live")} />{boardStatus[task.status].label}</span>}</div>
                </button>;
              })}
              {!stageTasks.length && <div className="project-empty"><RiKanbanView2 size={24} /><span className="text-body-2-medium">{snapshot ? "暂无任务" : "正在加载…"}</span><p className="text-caption-1-regular">{stage.hint}</p>{canDrop && <Button size="small" variant="ghost" leadingIcon={RiAddLine} onClick={() => onCreate(stage.key === "backlog")}>新增任务</Button>}</div>}
            </ScrollRegion>
          </section>;
        })}
      </div>
      <footer className="project-footer text-caption-1-regular"><span className="project-connection-dot" />{snapshot ? "已连接" : "连接中"}<span>待办自动开发 · 验证完成后等你验收</span><span>{tasks.length} 个任务</span></footer>
    </main>
  </div>;
}
