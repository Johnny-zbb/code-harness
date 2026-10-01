import {
  RiLayoutGridLine,
  RiGroupLine,
  RiGitBranchLine,
  RiArrowRightUpLine,
  RiCheckLine,
  RiTimeLine,
  RiRestartLine,
  RiFileTextLine,
  RiImageLine,
  RiCodeLine,
  RiSearchLine,
  RiCloseLine,
  RiLayoutRightLine,
  RiSunLine,
  RiMoonLine,
  RiArrowRightSLine,
  RiPulseLine,
} from "@remixicon/react";

export const icons = {
  grid: RiLayoutGridLine,
  agents: RiGroupLine,
  branch: RiGitBranchLine,
  arrow: RiArrowRightUpLine,
  check: RiCheckLine,
  clock: RiTimeLine,
  retry: RiRestartLine,
  file: RiFileTextLine,
  image: RiImageLine,
  code: RiCodeLine,
  search: RiSearchLine,
  close: RiCloseLine,
  panel: RiLayoutRightLine,
  sun: RiSunLine,
  moon: RiMoonLine,
  chevron: RiArrowRightSLine,
  activity: RiPulseLine,
};
export type IconName = keyof typeof icons;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component size={size} aria-hidden="true" />;
}
