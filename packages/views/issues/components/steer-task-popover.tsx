"use client";

import { useState } from "react";
import { Loader2, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "@multica/core/api";
import type { AgentTask } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@multica/ui/components/ui/popover";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useT } from "../../i18n";

export function SteerTaskPopover({
  issueId,
  task,
  onOpenChange,
}: {
  issueId: string;
  task: AgentTask;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useT("issues");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const handleSend = async () => {
    const value = input.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      await api.steerTask(issueId, task.id, value);
      setInput("");
      handleOpenChange(false);
      toast.success(t(($) => $.execution_log.steer_sent));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $.execution_log.steer_failed),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(($) => $.execution_log.steer_aria)}
            title={t(($) => $.execution_log.steer_aria)}
          />
        }
      >
        <MessageSquare aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="top"
        sideOffset={8}
        className="w-80 gap-3 p-3"
      >
        <div className="space-y-0.5">
          <p className="text-label font-medium">{t(($) => $.execution_log.steer_title)}</p>
          <p className="text-caption text-muted-foreground">
            {t(($) => $.execution_log.steer_description)}
          </p>
        </div>
        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={t(($) => $.execution_log.steer_placeholder)}
          rows={3}
          className="min-h-20 resize-none text-body"
          disabled={sending}
        />
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="brandSubtle"
            disabled={!input.trim() || sending}
            onClick={() => void handleSend()}
          >
            {sending ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
            {t(($) => $.execution_log.steer_send)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
