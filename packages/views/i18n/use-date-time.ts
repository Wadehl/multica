import { useMemo } from "react";
import { useLocale } from "./use-locale";

// Absolute date and time for deadlines the reader plans around. A quota window
// resets at a wall-clock moment, and "in 3h" does not say whether that lands
// before the end of the working day, so reset boundaries report the real time
// as well. The year is left out: every reset a provider reports is days away.
export function useDateTime(): (dateStr: string) => string {
  const locale = useLocale();
  return useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (dateStr: string) => formatter.format(new Date(dateStr));
  }, [locale]);
}
