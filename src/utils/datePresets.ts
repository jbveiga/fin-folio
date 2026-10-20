export type DatePresetId =
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "this_year"
  | "all_time";

export interface DatePresetOption {
  id: DatePresetId;
  label: string;
  startDate: string;
  endDate: string;
}

function formatIsoDate(year: number, monthZeroIndexed: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(monthZeroIndexed + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDatePresets(now: Date = new Date()): DatePresetOption[] {
  const year = now.getFullYear();
  const month = now.getMonth();

  // This Month: 1st of current month -> last day of current month
  const thisMonthStart = formatIsoDate(year, month, 1);
  const lastDayThisMonth = new Date(year, month + 1, 0).getDate();
  const thisMonthEnd = formatIsoDate(year, month, lastDayThisMonth);

  // Last Month: 1st of previous month -> last day of previous month
  const prevMonthDate = new Date(year, month - 1, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();
  const lastDayPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();
  const lastMonthStart = formatIsoDate(prevYear, prevMonth, 1);
  const lastMonthEnd = formatIsoDate(prevYear, prevMonth, lastDayPrevMonth);

  // Last 30 Days: today - 30 days -> today
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const last30Start = formatIsoDate(
    thirtyDaysAgo.getFullYear(),
    thirtyDaysAgo.getMonth(),
    thirtyDaysAgo.getDate()
  );
  const todayIso = formatIsoDate(year, month, now.getDate());

  // This Year: Jan 1 -> Dec 31
  const thisYearStart = `${year}-01-01`;
  const thisYearEnd = `${year}-12-31`;

  return [
    {
      id: "this_month",
      label: "This Month",
      startDate: thisMonthStart,
      endDate: thisMonthEnd,
    },
    {
      id: "last_month",
      label: "Last Month",
      startDate: lastMonthStart,
      endDate: lastMonthEnd,
    },
    {
      id: "last_30_days",
      label: "Last 30 Days",
      startDate: last30Start,
      endDate: todayIso,
    },
    {
      id: "this_year",
      label: "This Year",
      startDate: thisYearStart,
      endDate: thisYearEnd,
    },
    {
      id: "all_time",
      label: "All Time",
      startDate: "",
      endDate: "",
    },
  ];
}

export function getActiveDatePresetId(
  startDate: string,
  endDate: string,
  presets: DatePresetOption[] = getDatePresets()
): DatePresetId | null {
  for (const preset of presets) {
    if (preset.startDate === startDate && preset.endDate === endDate) {
      return preset.id;
    }
  }
  return null;
}
