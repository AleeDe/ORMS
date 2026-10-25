"use client";

import { useMemo } from "react";
import { usePathname as useNextPathname, useRouter as useNextRouter } from "next/navigation";
import { workspaceHref, workspaceIdFromPath, workspacePath } from "@/lib/workspace";
export { useSearchParams, useParams } from "next/navigation";

export function usePathname() { return workspacePath(useNextPathname()); }
export function useRouter() {
  const router = useNextRouter();
  const id = workspaceIdFromPath(useNextPathname());
  return useMemo(() => ({ ...router,
    push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(id ? workspaceHref(id, href) : href, options),
    replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(id ? workspaceHref(id, href) : href, options),
    prefetch: (href: string, options?: Parameters<typeof router.prefetch>[1]) => router.prefetch(id ? workspaceHref(id, href) : href, options),
  }), [id, router]);
}
