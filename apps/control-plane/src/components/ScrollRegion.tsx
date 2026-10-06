import { useState, type HTMLAttributes, type Ref } from "react";
import { cx } from "@/utils/cx";

interface Props extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>;
  containerClassName?: string;
}

/** Keep the surface fade stationary while the content and keyboard focus scroll. */
export function ScrollRegion({
  ref,
  containerClassName,
  className,
  onScroll,
  children,
  ...props
}: Props) {
  const [opacity, setOpacity] = useState(0);
  return (
    <div className={cx("scroll-region", containerClassName)}>
      <div
        {...props}
        className={className}
        ref={(node) => {
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        onScroll={(event) => {
          setOpacity(Math.min(1, event.currentTarget.scrollTop / 24));
          onScroll?.(event);
        }}
      >
        {children}
      </div>
      <div className="scroll-soft-edge" aria-hidden="true">
        <span className="scroll-edge-fine" style={{ opacity }} />
        <span className="scroll-edge-blur" style={{ opacity }} />
        <span className="scroll-edge-fade" style={{ opacity }} />
      </div>
    </div>
  );
}
