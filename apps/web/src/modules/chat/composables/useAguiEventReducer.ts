import { useChatStore } from "@/stores/chat";
import type { ChatMessageItem } from "@/modules/chat/types/chat";
import type {
  AguiEvent,
  Citation,
} from "@/modules/chat/types/stream";

interface UseAguiEventReducerOptions {
  assistantMsgId: number;
  pushDelta: (delta: string) => void;
  flush: () => void;
}

/**
 * 将 AG-UI 事件归约为聊天 Store 和当前消息状态。
 */
export function useAguiEventReducer(options: UseAguiEventReducerOptions) {
  const chatStore = useChatStore();

  const getCurrentAssistantMsg = () =>
    chatStore.messages.find(
      (m: ChatMessageItem) => m.id === options.assistantMsgId,
    ) as ChatMessageItem | undefined;

  function snapshotCitations() {
    const msg = getCurrentAssistantMsg();
    if (msg) msg.citations = [...chatStore.citations];
  }

  function handleEvent(event: AguiEvent): void {
    switch (event.type) {
      case "RUN_STARTED":
        chatStore.setRunStarted(event.runId);
        break;

      case "RUN_FINISHED":
        handleRunFinished(event.citations);
        break;

      case "RUN_ERROR":
        chatStore.setMessageStatus(options.assistantMsgId, "error");
        break;

      case "STEP_STARTED":
        chatStore.upsertStep({
          stepName: event.stepName,
          status: "running",
        });
        break;

      case "STEP_FINISHED":
        chatStore.upsertStep({
          stepName: event.stepName,
          status: "completed",
          input: event.input,
          output: event.output,
          durationMs: event.durationMs,
        });
        break;

      case "TOOL_CALL_START":
        chatStore.upsertToolCall({
          toolCallId: event.toolCallId,
          toolCallName: event.toolCallName,
          input: event.input,
          status: "running",
        });
        break;

      case "TOOL_CALL_RESULT":
        handleToolCallResult(event);
        break;

      case "TEXT_MESSAGE_START":
        break;

      case "TEXT_MESSAGE_CONTENT":
        options.pushDelta(event.delta);
        break;

      case "TEXT_MESSAGE_END":
        options.flush();
        break;
    }
  }

  function handleRunFinished(citations?: Citation[]) {
    chatStore.setRunFinished();

    const msg = getCurrentAssistantMsg();
    if (!msg) return;

    msg.aguiSteps = [...chatStore.aguiSteps];
    msg.aguiToolCalls = [...chatStore.aguiToolCalls];

    if (citations && citations.length > 0) {
      chatStore.setCitations(citations);
      msg.citations = [...chatStore.citations];
    }

    if (msg.messageStatus === "streaming") {
      chatStore.setMessageStatus(options.assistantMsgId, "completed");
    }
  }

  function handleToolCallResult(
    event: Extract<AguiEvent, { type: "TOOL_CALL_RESULT" }>,
  ) {
    chatStore.upsertToolCall({
      toolCallId: event.toolCallId,
      toolCallName: event.toolCallName,
      output: event.output,
      durationMs: event.durationMs,
      status: "completed",
    });

    if (
      event.toolCallName !== "search_knowledge_base" ||
      !event.output?.documents
    ) {
      return;
    }

    const docs = Array.isArray(event.output.documents)
      ? (event.output.documents as Citation[])
      : [];

    if (docs.length === 0) return;

    if (event.output.append) {
      chatStore.appendCitations(docs);
    } else {
      chatStore.setCitations(docs);
    }

    snapshotCitations();
  }

  return {
    handleEvent,
  };
}
