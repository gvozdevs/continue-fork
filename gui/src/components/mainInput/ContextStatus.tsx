import { useMemo, useRef } from "react";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { saveCurrentSession } from "../../redux/thunks/session";
import { useCompactConversation } from "../../util/compactConversation";
import { ToolTip } from "../gui/Tooltip";

const ContextStatus = () => {
  const dispatch = useAppDispatch();
  const contextPercentage = useAppSelector(
    (state) => state.session.contextPercentage,
  );
  const selectedChatModel = useAppSelector(
    (state) => state.config.config.selectedModelByRole.chat?.model,
  );
  const previousHistoryLength = useRef<number | null>(null);
  const previousSelectedChatModel = useRef<string | null>(null);
  const history = useAppSelector((state) => state.session.history);
  const percent = Math.round((contextPercentage ?? 0) * 100);
  const contextInputTokens = useAppSelector(
    (state) => state.session.contextInputTokens,
  );
  const contextLength = useAppSelector((state) => state.session.contextLength);
  const isPruned = useAppSelector((state) => state.session.isPruned);

  const isDifferentModelAndSameHistory = useMemo(() => {
    if (!selectedChatModel) return false;
    // only reset if history changes
    if (previousHistoryLength.current !== history.length) {
      previousHistoryLength.current = history.length;
      previousSelectedChatModel.current = selectedChatModel;
      return false;
    }
    return previousSelectedChatModel.current !== selectedChatModel;
  }, [history.length, selectedChatModel]);

  const compactConversation = useCompactConversation();

  // if user changed to a different model, we shouldn't show the context status until the user sends a new message
  if (isDifferentModelAndSameHistory) {
    return null;
  }

  const tone =
    isPruned || percent >= 80
      ? "text-red-400"
      : percent >= 60
        ? "text-yellow-500"
        : "text-green-500";
  const ring = 14;
  const stroke = 2;
  const radius = (ring - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(100, percent));
  const dash = (filled / 100) * circumference;

  return (
    <div>
      <ToolTip
        closeEvents={{
          // blur: false,
          mouseleave: true,
          click: true,
          mouseup: false,
        }}
        clickable
        content={
          <div className="flex flex-col gap-0 text-left text-xs">
            <span className="inline-block">
              {contextInputTokens !== undefined && contextLength
                ? `${contextInputTokens.toLocaleString()} / ${contextLength.toLocaleString()} tokens`
                : `${percent}% of context filled.`}
            </span>
            {isPruned && (
              <span className="inline-block">
                {`Oldest messages are being removed.`}
              </span>
            )}
            {history.length > 0 && (
              <div className="flex flex-col gap-1 whitespace-pre">
                <div>
                  <span
                    className="hover:text-link inline-block cursor-pointer underline"
                    onClick={() => compactConversation(history.length - 1)}
                  >
                    Compact conversation
                  </span>
                  {"\n"}
                  <span
                    className="hover:text-link inline-block cursor-pointer underline"
                    onClick={() => {
                      void dispatch(
                        saveCurrentSession({
                          openNewSession: true,
                          generateTitle: false,
                        }),
                      );
                    }}
                  >
                    Start a new session
                  </span>
                </div>
              </div>
            )}
          </div>
        }
      >
        <div className={`flex items-center gap-1 ${tone}`}>
          <svg
            width={ring}
            height={ring}
            viewBox={`0 0 ${ring} ${ring}`}
            aria-hidden="true"
          >
            <circle
              cx={ring / 2}
              cy={ring / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeWidth={stroke}
            />
            <circle
              cx={ring / 2}
              cy={ring / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${ring / 2} ${ring / 2})`}
            />
          </svg>
          <span>{percent}%</span>
        </div>
      </ToolTip>
    </div>
  );
};

export default ContextStatus;
