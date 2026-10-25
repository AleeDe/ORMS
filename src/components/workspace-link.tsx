"use client";

import { forwardRef, type ComponentProps } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { workspaceHref, workspaceIdFromPath } from "@/lib/workspace";

const WorkspaceLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof NextLink>>(function WorkspaceLink({ href, ...props }, ref) {
  const id = workspaceIdFromPath(usePathname());
  const scoped = id ? typeof href === "string" ? workspaceHref(id, href) : { ...href, pathname: workspaceHref(id, href.pathname ?? "/") } : href;
  return <NextLink ref={ref} href={scoped} {...props} />;
});
export default WorkspaceLink;
