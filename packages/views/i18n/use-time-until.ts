import { useT } from "./use-t";

// Localized relative-time formatter for deadlines that have not arrived yet —
// quota reset boundaries, mainly. `useTimeAgo` floors a negative delta to zero
// minutes, so every upcoming timestamp renders as "just now" through it.
// Returns a function so call-site usage stays terse:
// `const timeUntil = useTimeUntil(); ...timeUntil(dateStr)`.
export function useTimeUntil() {
  const { t } = useT("common");
  return (dateStr: string): string => {
    const diff = new Date(dateStr).getTime() - Date.now();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t(($) => $.time.due_now);
    if (minutes < 60) return t(($) => $.time.in_minutes, { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t(($) => $.time.in_hours, { count: hours });
    return t(($) => $.time.in_days, { count: Math.floor(hours / 24) });
  };
}
