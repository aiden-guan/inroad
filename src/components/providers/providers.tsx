"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AskProvider } from "./ask-provider";
import { RunsProvider } from "./runs-provider";
import { WorkspaceProvider } from "./workspace-provider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <WorkspaceProvider>
          <RunsProvider>
            <AskProvider>
              {children}
              <Toaster
                position="bottom-right"
                gap={10}
                toastOptions={{
                  classNames: {
                    toast:
                      "!rounded-lg !bg-surface-raised !text-fg !shadow-lg !ring-1 !ring-border !border-0 !font-sans !text-[13px] !gap-2",
                    description: "!text-fg-2",
                    actionButton: "!bg-primary !text-primary-fg !rounded-sm !text-[12px] !font-medium",
                    cancelButton: "!bg-bg-subtle !text-fg-2 !rounded-sm !text-[12px]",
                  },
                }}
              />
            </AskProvider>
          </RunsProvider>
        </WorkspaceProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
