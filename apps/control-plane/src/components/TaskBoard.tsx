import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, ModalOverlay, Modal, Dialog } from "react-aria-components";
import {
  RiAddLine,
  RiArrowLeftLine,
  RiGitMergeLine,
  RiChat3Line,
} from "@remixicon/react";
import { Button, ButtonLink } from "@/components/boardui/base/buttons/button";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Input } from "@/components/boardui/base/input/input";
import { Textarea } from "@/components/boardui/base/textarea/textarea";
import { Chip } from "@/components/boardui/base/badges/chip";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/boardui/base/segmented-control/segmented-control";
import { AgentThinking } from "@/components/boardui/application/agent-thinking/agent-thinking";
import {
  artifactUrl,
  boardRequest,
  boardStatus,
  repoName,
  type BoardTask,
  type BoardSnapshot,
  type BoardAttempt,
} from "../board";
import { FoldAvatar, agentVisual } from "./FoldAvatar";
import { ScrollRegion } from "./ScrollRegion";
import { Icon, icons } from "./Icon";
import { cx } from "@/utils/cx";

const columns = [
  {
    key: "todo",
    title: "待办",
    description: "Agent 会自动领取",
    statuses: ["queued"],
  },
  {
    key: "doing",
    title: "执行中",
    description: "独立开发，然后验证",
    statuses: ["running", "verifying"],
  },
  {
    key: "review",
    title: "等你验收",
    description: "查看报告，决定下一步",
    statuses: ["review", "approved", "blocked"],
  },
  {
    key: "done",
    title: "已完成",
    description: "你确认并合入的任务",
    statuses: ["merged"],
  },
] as const;

function BoardDialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="board-overlay"
    >
      <Modal className={cx("board-dialog", wide && "board-dialog-wide")}>
        <Dialog
          aria-label={title}
          className="board-dialog-content outline-none"
        >
          <header className="board-dialog-header">
            <div>
              {subtitle && <span className="board-eyebrow">{subtitle}</span>}
              <h2>{title}</h2>
            </div>
            <IconButton
              size="small"
              icon={icons.close}
              onClick={onClose}
              aria-label="关闭对话框"
            />
          </header>
          <ScrollRegion className="board-dialog-scroll">
            {children}
          </ScrollRegion>
          {footer && <footer className="board-dialog-footer">{footer}</footer>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function NewTask({
  defaultRepo,
  onClose,
  onCreated,
}: {
  defaultRepo: string;
  onClose: () => void;
  onCreated: (task: BoardTask) => void;
}) {
  const [repo, setRepo] = useState(() => {
    try {
      return localStorage.getItem("kumo-repo") || defaultRepo;
    } catch {
      return defaultRepo;
    }
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [checkCommand, setCheckCommand] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit() {
    setError("");
    setPending(true);
    try {
      const task = await boardRequest<BoardTask>("/api/board/tasks", {
        repo,
        title,
        description,
        acceptance,
        checkCommand,
      });
      try {
        localStorage.setItem("kumo-repo", repo);
      } catch {
        /* Optional preference. */
      }
      onCreated(task);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <BoardDialog
      title="新增任务"
      subtitle="给 Agent 一个清楚的目标"
      onClose={onClose}
      footer={
        <>
          <span>加入待办后自动开始，完成后等待你验收。</span>
          <Button
            type="submit"
            form="new-task-form"
            leadingIcon={RiAddLine}
            disabled={pending}
          >
            {pending ? "正在加入…" : "加入待办"}
          </Button>
        </>
      }
    >
      <Form
        id="new-task-form"
        className="board-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Input
          label="目标仓库"
          hint="本机 Git 仓库路径；Agent 基于当前分支的已提交代码，在独立工作区中执行。"
          value={repo}
          onChange={setRepo}
          isRequired
          name="repo"
        />
        <Input
          label="任务标题"
          placeholder="例如：为任务列表增加搜索"
          value={title}
          onChange={setTitle}
          isRequired
          maxLength={200}
          autoFocus
          name="title"
        />
        <Textarea
          label="任务要求"
          placeholder="描述你希望改变的行为，以及需要保留的行为。"
          value={description}
          onChange={setDescription}
          isRequired
          rows={4}
          maxLength={20000}
          name="description"
        />
        <Textarea
          label="验收条件"
          placeholder="例如：输入关键词后只显示匹配任务；清空输入恢复全部任务。"
          value={acceptance}
          onChange={setAcceptance}
          isRequired
          rows={3}
          maxLength={20000}
          name="acceptance"
        />
        <Input
          label="项目验证命令（可选）"
          placeholder="例如 npm test"
          hint="在任务工作区执行；Agent 还会独立检查验收条件。"
          value={checkCommand}
          onChange={setCheckCommand}
          maxLength={2000}
          name="checkCommand"
        />
        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}
      </Form>
    </BoardDialog>
  );
}

function ArtifactPreview({
  task,
  attempt,
  file,
}: {
  task: BoardTask;
  attempt: BoardAttempt;
  file: string;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setContent("");
    setError("");
    fetch(artifactUrl(task, attempt, file), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const value = await response.json();
          throw new Error(value.error || "文件暂不可用。");
        }
        return response.text();
      })
      .then((value) =>
        setContent(
          value.length > 120000
            ? value.slice(0, 120000) + "\n[预览已截断，可打开完整文件。]"
            : value || "此文件为空。",
        ),
      )
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [task.id, attempt.number, file]);
  return (
    <div className="board-artifact-preview">
      <div>
        <strong>{file}</strong>
        <ButtonLink
          size="xs"
          variant="secondary"
          href={artifactUrl(task, attempt, file)}
          target="_blank"
          rel="noreferrer"
          trailingIcon={icons.arrow}
        >
          完整文件
        </ButtonLink>
      </div>
      {error ? (
        <p role="alert" className="board-error">
          {error}
        </p>
      ) : (
        <pre>{content || "正在读取…"}</pre>
      )}
    </div>
  );
}

function TaskDetail({
  task,
  onClose,
  onRefresh,
}: {
  task: BoardTask;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [tab, setTab] = useState("report");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [file, setFile] = useState("git-diff.patch");
  const latest = task.attempts.at(-1);
  const [attemptNumber, setAttemptNumber] = useState(latest?.number || 1);
  useEffect(() => {
    setAttemptNumber(latest?.number || 1);
    setConfirmMerge(false);
  }, [latest?.number, task.headSha]);
  const attempt =
    task.attempts.find((item) => item.number === attemptNumber) || latest;
  const report = attempt?.verification;
  const historical = attempt?.number !== latest?.number;
  const shownHead = attempt?.headSha || task.headSha;
  const reviewFeedback = task.messages
    .filter(
      (message) =>
        message.role === "user" &&
        message.text !== task.description &&
        message.text !== "验收通过，等待手动合入。" &&
        (!attempt || message.at <= attempt.startedAt),
    )
    .at(-1);
  const busy = ["queued", "running", "verifying"].includes(task.status);
  const canRework = ["review", "blocked", "approved"].includes(task.status);
  async function action(name: string, body: unknown = {}) {
    setPending(true);
    setError("");
    try {
      await boardRequest(`/api/board/tasks/${task.id}/${name}`, body);
      setConfirmMerge(false);
      setFeedback("");
      await onRefresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <BoardDialog
      title={task.title}
      subtitle={`${repoName(task.repo)} · ${task.targetBranch}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span>
            {historical
              ? "正在查看历史报告，请回到最新报告后验收。"
              : task.status === "approved"
                ? "你已验收。合入仍需你确认。"
                : task.status === "merged"
                  ? "代码已合入目标分支。"
                  : "验收通过后，才会开放合入操作。"}
          </span>
          {historical && (
            <Button
              size="small"
              variant="secondary"
              onClick={() => setAttemptNumber(latest?.number || 1)}
            >
              最新报告
            </Button>
          )}
          {task.status === "review" && (
            <Button
              leadingIcon={icons.check}
              disabled={pending || attemptNumber !== latest?.number}
              onClick={() => void action("approve", { headSha: task.headSha })}
            >
              验收通过
            </Button>
          )}
          {task.status === "approved" && (
            <Button
              leadingIcon={RiGitMergeLine}
              disabled={pending || historical}
              onClick={() => {
                setConfirmMerge(true);
                setTab("report");
              }}
            >
              合入代码
            </Button>
          )}
        </>
      }
    >
      <div className="board-detail-body">
        <div className="board-detail-status">
          <Chip color={boardStatus[task.status].color}>
            {boardStatus[task.status].label}
          </Chip>
          <span>第 {task.attempts.length || 0} 次执行</span>
          {shownHead && (
            <span className="mono" title={shownHead}>
              {historical ? "报告版本" : "版本"} {shownHead.slice(0, 8)}
            </span>
          )}
        </div>
        <SegmentedControl
          aria-label="任务详情视图"
          selectedKeys={[tab]}
          onSelectionChange={(keys) => setTab(String([...keys][0]))}
        >
          <SegmentedControlItem id="report">验收报告</SegmentedControlItem>
          <SegmentedControlItem id="conversation">讨论</SegmentedControlItem>
          <SegmentedControlItem id="history">执行记录</SegmentedControlItem>
        </SegmentedControl>
        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}
        {task.error && <p className="board-error">{task.error}</p>}
        {confirmMerge && (
          <div className="board-merge-confirm">
            <strong>确认合入这个版本？</strong>
            <p>
              将 {task.headSha?.slice(0, 8)} 合入本地仓库 {repoName(task.repo)}{" "}
              的 {task.targetBranch} 分支。此操作不推送远端。
            </p>
            <div>
              <Button
                size="small"
                variant="secondary"
                onClick={() => setConfirmMerge(false)}
              >
                取消
              </Button>
              <Button
                size="small"
                leadingIcon={RiGitMergeLine}
                disabled={pending}
                onClick={() => void action("merge", { headSha: task.headSha })}
              >
                确认合入
              </Button>
            </div>
          </div>
        )}
        {tab === "report" && (
          <>
            <section className="board-detail-section">
              <h3>这次要完成什么</h3>
              <p>{task.description}</p>
              <h3>{reviewFeedback ? "初始验收条件" : "验收条件"}</h3>
              <p>{task.acceptance}</p>
              {reviewFeedback && (
                <>
                  <h3>本轮修改意见</h3>
                  <p>{reviewFeedback.text}</p>
                </>
              )}
            </section>
            <section className="board-detail-section">
              <div className="board-section-heading">
                <h3>第 {attempt?.number || 1} 次验证报告</h3>
                {report && (
                  <Chip
                    variant="caption"
                    color={report.verdict === "passed" ? "lime" : "rose"}
                  >
                    {report.verdict === "passed"
                      ? "独立验证通过"
                      : report.verdict === "failed"
                        ? "验证未通过"
                        : "验证受阻"}
                  </Chip>
                )}
              </div>
              {busy && attempt?.number === latest?.number ? (
                <>
                  <AgentThinking
                    showTimer={false}
                    label={
                      task.status === "queued"
                        ? "任务已排队，Agent 会自动领取"
                        : task.status === "verifying"
                          ? "正在独立验证，尚未产生最终报告"
                          : "Agent 正在开发，完成后会进行独立验证"
                    }
                  />
                  {task.activity?.length ? (
                    <div className="board-conversation" aria-live="polite">
                      {task.activity.map((message, index) => (
                        <article
                          key={index}
                          className="board-discussion-message board-message-agent"
                        >
                          <strong>
                            {message.role === "verifier"
                              ? "验证 Agent"
                              : "开发 Agent"}
                          </strong>
                          <p>{message.text}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : report ? (
                <>
                  <p>{report.summary}</p>
                  <ul className="board-checks">
                    {report.checks.map((check, index) => (
                      <li key={index}>
                        <Icon
                          name={
                            check.status === "passed" ? "check" : "activity"
                          }
                          size={16}
                        />
                        <div>
                          <strong>{check.name}</strong>
                          <p>{check.evidence}</p>
                        </div>
                        <Chip
                          variant="caption"
                          color={check.status === "passed" ? "lime" : "rose"}
                        >
                          {check.status === "passed" ? "通过" : "未通过"}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                  <div className="board-check-command">
                    <span>项目验证命令</span>
                    <strong>{task.checkCommand || "未指定额外命令"}</strong>
                    {task.checkCommand && (
                      <Chip
                        variant="caption"
                        color={attempt?.checkExitCode === 0 ? "lime" : "rose"}
                      >
                        {attempt?.checkExitCode === 0
                          ? "通过"
                          : attempt?.checkExitCode == null
                            ? "未执行"
                            : "失败"}
                      </Chip>
                    )}
                  </div>
                </>
              ) : (
                <p>尚无验证报告。执行日志会保留失败原因。</p>
              )}
            </section>
            {attempt?.evidenceDir && attempt.finishedAt && (
              <section className="board-detail-section">
                <h3>代码与证据</h3>
                <div className="board-artifact-buttons">
                  {[
                    "git-diff.patch",
                    "worker.log",
                    "verifier.log",
                    ...(task.checkCommand ? ["check.log"] : []),
                  ].map((name) => (
                    <Button
                      size="small"
                      variant={file === name ? "ghost" : "secondary"}
                      key={name}
                      onClick={() => setFile(name)}
                    >
                      {name === "git-diff.patch"
                        ? "代码差异"
                        : name === "worker.log"
                          ? "开发日志"
                          : name === "verifier.log"
                            ? "验证日志"
                            : "命令输出"}
                    </Button>
                  ))}
                </div>
                <ArtifactPreview task={task} attempt={attempt} file={file} />
              </section>
            )}
          </>
        )}
        {tab === "conversation" && (
          <>
            <div className="board-conversation">
              {task.messages.map((message, index) => (
                <article
                  key={index}
                  className={cx(
                    "board-discussion-message",
                    `board-message-${message.role}`,
                  )}
                >
                  <div>
                    <strong>
                      {message.role === "user"
                        ? "你"
                        : message.role === "agent"
                          ? "Agent"
                          : "任务进度"}
                    </strong>
                    <time dateTime={message.at}>
                      {new Date(message.at).toLocaleString("zh-CN", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
            {canRework && (
              <Form
                className="board-feedback"
                onSubmit={(event) => {
                  event.preventDefault();
                  void action("rework", { text: feedback });
                }}
              >
                <Textarea
                  label="告诉 Agent 还需要改什么"
                  hint="提交后回到待办，在原工作区继续开发，并重新生成验证报告。"
                  value={feedback}
                  onChange={setFeedback}
                  rows={4}
                  isRequired
                  maxLength={20000}
                />
                <Button
                  type="submit"
                  leadingIcon={RiChat3Line}
                  disabled={pending}
                >
                  发送并继续开发
                </Button>
              </Form>
            )}
            {busy && (
              <p className="board-detail-hint">
                本轮正在执行。完成后可以在这里提交修改意见。
              </p>
            )}
          </>
        )}
        {tab === "history" && (
          <div className="board-history">
            {[...task.attempts].reverse().map((item) => (
              <article key={item.number}>
                <div>
                  <strong>第 {item.number} 次执行</strong>
                  <Chip
                    variant="caption"
                    color={
                      item.status === "passed"
                        ? "lime"
                        : item.finishedAt
                          ? "rose"
                          : "blue"
                    }
                  >
                    {item.status === "passed"
                      ? "验证通过"
                      : item.finishedAt
                        ? "未通过"
                        : "进行中"}
                  </Chip>
                </div>
                <p>
                  {item.verification?.summary || item.error || "正在执行任务…"}
                </p>
                <span>{new Date(item.startedAt).toLocaleString("zh-CN")}</span>
                {item.worktree && (
                  <p className="board-path mono">{item.worktree}</p>
                )}
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => {
                    setAttemptNumber(item.number);
                    setTab("report");
                  }}
                >
                  查看第 {item.number} 次报告
                </Button>
              </article>
            ))}
            {task.attempts.length === 0 && (
              <p>Agent 领取任务后，会在这里留下每轮记录。</p>
            )}
          </div>
        )}
        {canRework && tab === "report" && (
          <Button
            variant="secondary"
            leadingIcon={RiChat3Line}
            onClick={() => setTab("conversation")}
          >
            还不满足？提交修改意见
          </Button>
        )}
      </div>
    </BoardDialog>
  );
}

export function TaskBoard({ onDemo }: { onDemo: () => void }) {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem("kumo-theme") === "dark";
    } catch {
      return false;
    }
  });
  const revision = useRef(-1);
  const mounted = useRef(true);
  async function refresh(signal?: AbortSignal) {
    const next = await boardRequest<BoardSnapshot>(
      "/api/board",
      undefined,
      signal,
    );
    if (!mounted.current) return;
    if (next.revision >= revision.current) {
      revision.current = next.revision;
      setSnapshot(next);
    }
    setError("");
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const load = () =>
      refresh(controller.signal).catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    void load();
    const interval = setInterval(() => {
      if (!document.hidden) void load();
    }, 2000);
    return () => {
      mounted.current = false;
      controller.abort();
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("kumo-theme", dark ? "dark" : "light");
    } catch {
      /* Optional preference. */
    }
  }, [dark]);
  const tasks = snapshot?.tasks || [];
  const visible = tasks.filter((task) =>
    `${task.title} ${task.description} ${repoName(task.repo)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected = tasks.find((task) => task.id === selectedId);
  const active = tasks.find((task) =>
    ["running", "verifying"].includes(task.status),
  );
  return (
    <div className="board-app">
      <aside className="board-sidebar" aria-label="任务工作台导航">
        <div className="board-brand">
          <FoldAvatar
            {...agentVisual("coordinator", 0)}
            size={48}
            mood={active ? "busy" : "idle"}
            label="Kumo"
          />
          <div>
            <strong>
              kumo<span>.</span>
            </strong>
            <span>你的 Agent 工作台</span>
          </div>
        </div>
        <span className="board-sidebar-label">工作空间</span>
        <Button
          leadingIcon={icons.grid}
          variant="ghost"
          className="board-nav-active"
          aria-current="page"
        >
          任务看板<span className="board-nav-count">{tasks.length}</span>
        </Button>
        <Button
          leadingIcon={icons.activity}
          variant="secondary"
          onClick={onDemo}
        >
          演示工作区
          <Chip variant="caption" color="soft">
            示例
          </Chip>
        </Button>
        <div className="board-sidebar-note">
          <FoldAvatar
            {...agentVisual("worker", 0)}
            size={40}
            mood={active ? "busy" : "idle"}
            label="开发 Agent"
          />
          <strong>{active ? "Agent 正在工作" : "准备好接收任务"}</strong>
          <p>
            {active ? active.title : "把需求加入待办，开发与验证会自动开始。"}
          </p>
          <span>
            <span className="dot" />
            {snapshot?.runner === "test-fixture"
              ? "测试执行器 · 临时仓库"
              : "本机 Codex · 顺序执行"}
          </span>
        </div>
        <div className="board-sidebar-foot">
          <span className="local-user">J</span>
          <div>
            <strong>由你验收和合入</strong>
            <span>任务与报告保存在本机</span>
          </div>
          <IconButton
            size="small"
            icon={dark ? icons.sun : icons.moon}
            onClick={() => setDark(!dark)}
            aria-label={dark ? "切换浅色主题" : "切换深色主题"}
          />
        </div>
      </aside>
      <main className="board-main">
        <div className="board-topbar">
          <span>
            <Icon name="grid" size={16} />
            工作空间<span>/</span>
            <strong>任务看板</strong>
          </span>
          <span
            className={cx("board-api-status", error && "board-api-error")}
            role="status"
          >
            <span className="dot" />
            {error ? "连接异常" : snapshot ? "已连接" : "正在连接"}
          </span>
        </div>
        <header className="board-page-heading">
          <div>
            <span className="board-eyebrow">想法 → 开发 → 验证 → 你的决定</span>
            <h1>
              把想法交给 Agent<span>.</span>
            </h1>
            <p>你安排任务，Agent 自动开发和验证。每一次合入，由你决定。</p>
          </div>
          <Button
            leadingIcon={RiAddLine}
            disabled={!snapshot}
            onClick={() => setShowNew(true)}
          >
            新增任务
          </Button>
        </header>
        <div className="board-overview">
          <div>
            <strong>
              {
                tasks.filter((task) =>
                  ["queued", "running", "verifying"].includes(task.status),
                ).length
              }
            </strong>
            <span>待执行与进行中</span>
          </div>
          <div>
            <strong>
              {
                tasks.filter((task) =>
                  ["review", "approved", "blocked"].includes(task.status),
                ).length
              }
            </strong>
            <span>等待你的决定</span>
          </div>
          <div>
            <strong>
              {tasks.filter((task) => task.status === "merged").length}
            </strong>
            <span>已验收并合入</span>
          </div>
          <Input
            size="small"
            type="search"
            leadingIcon={icons.search}
            placeholder="搜索任务或仓库…"
            aria-label="搜索任务"
            value={search}
            onChange={setSearch}
          />
        </div>
        {error && (
          <p role="alert" className="board-error">
            {error}
          </p>
        )}
        <div className="board-columns" aria-label="任务看板">
          {columns.map((column) => {
            const items = visible.filter((task) =>
              (column.statuses as readonly string[]).includes(task.status),
            );
            return (
              <section
                key={column.key}
                className={cx("board-column", `board-column-${column.key}`)}
                aria-label={column.title}
              >
                <header>
                  <div>
                    <span className="board-column-dot" />
                    <h2>{column.title}</h2>
                    <span className="count-badge">{items.length}</span>
                  </div>
                  <p>{column.description}</p>
                </header>
                <ScrollRegion className="board-column-scroll">
                  {items.map((task) => (
                    <article key={task.id}>
                      <Button
                        variant="secondary"
                        className="board-task-card"
                        aria-label={`查看任务：${task.title}`}
                        onClick={() => setSelectedId(task.id)}
                      >
                        <span className="board-task-content">
                          <span className="board-task-meta">
                            <span>任务 {task.id.slice(0, 6)}</span>
                            <Chip
                              variant="caption"
                              color={boardStatus[task.status].color}
                            >
                              {boardStatus[task.status].label}
                            </Chip>
                          </span>
                          <strong>{task.title}</strong>
                          <span className="board-task-description">
                            {task.description}
                          </span>
                          <span className="board-task-repo">
                            <Icon name="branch" size={14} />
                            {repoName(task.repo)}
                            <span>{task.targetBranch}</span>
                          </span>
                          <span className="board-task-footer">
                            <FoldAvatar
                              {...agentVisual("worker", 0)}
                              size={28}
                              mood={
                                task.status === "merged"
                                  ? "happy"
                                  : ["running", "verifying"].includes(
                                        task.status,
                                      )
                                    ? "busy"
                                    : "idle"
                              }
                              label="开发 Agent"
                            />
                            <span>
                              {task.attempts.length
                                ? `第 ${task.attempts.length} 次执行`
                                : "等待 Agent 领取"}
                            </span>
                            {task.status === "approved" && (
                              <span>你已验收</span>
                            )}
                          </span>
                        </span>
                      </Button>
                    </article>
                  ))}
                  {items.length === 0 && (
                    <div className="board-column-empty">
                      <Icon
                        name={
                          column.key === "done"
                            ? "check"
                            : column.key === "review"
                              ? "file"
                              : column.key === "doing"
                                ? "agents"
                                : "grid"
                        }
                        size={24}
                      />
                      <strong>
                        {column.key === "todo"
                          ? search
                            ? "没有匹配的待办"
                            : "下一件想做的事"
                          : column.key === "doing"
                            ? "执行中的任务会在这里"
                            : column.key === "review"
                              ? "报告好了，等你来验收"
                              : "完成的工作值得留一格"}
                      </strong>
                      <p>
                        {column.key === "todo"
                          ? "新增任务后，Agent 会自动开始。"
                          : column.key === "doing"
                            ? "你可以随时查看任务进度。"
                            : column.key === "review"
                              ? "验收、合入，或对话继续修改。"
                              : "只有你确认合入，任务才算完成。"}
                      </p>
                      {column.key === "todo" && !search && (
                        <Button
                          size="small"
                          variant="secondary"
                          leadingIcon={RiAddLine}
                          disabled={!snapshot}
                          onClick={() => setShowNew(true)}
                        >
                          新增任务
                        </Button>
                      )}
                    </div>
                  )}
                </ScrollRegion>
              </section>
            );
          })}
        </div>
        <footer className="board-page-footer">
          <span>
            <Icon name="branch" size={14} />
            独立工作区开发 · 完成后保留代码与报告
          </span>
          <span>没有任务会自动合入</span>
        </footer>
      </main>
      {showNew && snapshot && (
        <NewTask
          defaultRepo={snapshot.defaultRepo}
          onClose={() => setShowNew(false)}
          onCreated={(task) => {
            setShowNew(false);
            setSelectedId(task.id);
            void refresh().catch((reason) => setError(reason.message));
          }}
        />
      )}
      {selected && (
        <TaskDetail
          key={selected.id}
          task={selected}
          onClose={() => setSelectedId(null)}
          onRefresh={refresh}
        />
      )}
    </div>
  );
}

export function BackToBoard({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="small"
      variant="secondary"
      leadingIcon={RiArrowLeftLine}
      className="back-to-board"
      onClick={onClick}
    >
      返回任务看板
    </Button>
  );
}
