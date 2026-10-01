import { useState } from "react";
import { RiKanbanView2, RiInbox2Line, RiArchiveLine, RiSideBarFill, RiSearchLine, RiSunLine, RiMoonLine, RiFlaskLine, RiGitBranchLine } from "@remixicon/react";
import { Avatar } from "@/components/boardui/base/avatar/avatar";
import { Button } from "@/components/boardui/base/buttons/button";
import { IconButton } from "@/components/boardui/base/buttons/icon-button";
import { Input } from "@/components/boardui/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/boardui/base/segmented-control/segmented-control";
import { ScrollRegion } from "@/components/ScrollRegion";
import { cx } from "@/utils/cx";

/** Source-owned BoardUI sidebar, configured for the local agent workspace. */
export function DashboardSidebar({ selected, onSelect, onDemo, search, onSearch, dark, onThemeChange, counts, repository, runner }: {
  selected: string;
  onSelect: (key: string) => void;
  onDemo: () => void;
  search: string;
  onSearch: (value: string) => void;
  dark: boolean;
  onThemeChange: (dark: boolean) => void;
  counts: { all: number; review: number; done: number };
  repository: string;
  runner: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const items = [
    { key: "all", label: "任务看板", icon: RiKanbanView2, count: counts.all },
    { key: "review", label: "等待验收", icon: RiInbox2Line, count: counts.review },
    { key: "done", label: "已完成", icon: RiArchiveLine, count: counts.done },
  ];
  return <aside className={cx("project-sidebar rounded-3xl border border-border-button-white bg-background-secondary-default shadow-sidebar", collapsed && "project-sidebar-collapsed")} aria-label="工作台导航">
    <div className="project-sidebar-profile">
      <Avatar initials="K" size="md" />
      {!collapsed && <div className="project-sidebar-name"><strong className="text-body-medium">Kumo 工作台</strong><span className="text-caption-1-regular text-text-tertiary">个人工作空间</span></div>}
      <IconButton icon={RiSideBarFill} size="small" aria-label={collapsed ? "展开侧栏" : "收起侧栏"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} />
    </div>
    <div className="project-sidebar-search">
      {collapsed ? <IconButton icon={RiSearchLine} aria-label="搜索任务" onClick={() => setCollapsed(false)} /> : <Input aria-label="搜索任务" placeholder="搜索任务…" leadingIcon={RiSearchLine} value={search} onChange={onSearch} />}
    </div>
    <ScrollRegion containerClassName="project-sidebar-scroll" className="project-sidebar-nav">
      <nav aria-label="任务视图">
        {items.map(({ key, label, icon: Icon, count }) => <Button key={key} variant="ghost" leadingIcon={Icon} className={cx("project-nav-item", selected === key && "project-nav-selected")} aria-current={selected === key ? "page" : undefined} aria-label={label} onClick={() => onSelect(key)}>
          {!collapsed && <><span>{label}</span><span className="project-nav-count">{count}</span></>}
        </Button>)}
        <Button variant="ghost" leadingIcon={RiFlaskLine} className="project-nav-item" aria-label="演示工作区" onClick={onDemo}>{!collapsed && "演示工作区"}</Button>
      </nav>
      {!collapsed && <div className="project-sidebar-repo"><span className="text-caption-1-medium text-text-tertiary">当前仓库</span><div className="text-body-medium"><RiGitBranchLine size={16} />{repository || "连接中…"}</div></div>}
    </ScrollRegion>
    <div className="project-sidebar-bottom">
      {collapsed ? <IconButton icon={dark ? RiSunLine : RiMoonLine} aria-label={dark ? "浅色模式" : "深色模式"} onClick={() => onThemeChange(!dark)} /> : <SegmentedControl aria-label="外观" selectedKeys={[dark ? "dark" : "light"]} onSelectionChange={(keys) => onThemeChange([...keys][0] === "dark")}><SegmentedControlItem id="light"><RiSunLine size={16} />浅色</SegmentedControlItem><SegmentedControlItem id="dark"><RiMoonLine size={16} />深色</SegmentedControlItem></SegmentedControl>}
      <div className="project-sidebar-account"><Avatar initials="A" size="md" />{!collapsed && <div><strong className="text-body-medium">Agent 工作空间</strong><span className="text-caption-1-regular text-text-tertiary">{runner === "test-fixture" ? "测试执行器" : "本地 Codex · 并发 1"}</span></div>}</div>
    </div>
  </aside>;
}
