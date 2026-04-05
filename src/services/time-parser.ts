import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

const DEFAULT_TZ = "Asia/Singapore";
const WEEKDAY_MAP: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

function endOfDayISO(date: dayjs.Dayjs): string {
  return date.tz(DEFAULT_TZ).hour(23).minute(59).second(59).millisecond(0).format();
}

function resolveYear(base: dayjs.Dayjs, month: number, day: number): number {
  const sameYear = dayjs.tz(
    `${base.year()}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 23:59:59`,
    "YYYY-MM-DD HH:mm:ss",
    DEFAULT_TZ,
  );

  if (sameYear.isBefore(base.subtract(1, "day"))) {
    return base.year() + 1;
  }

  return base.year();
}

export function parseDueTime(text: string, nowIso: string): string | null {
  const base = dayjs.tz(nowIso, DEFAULT_TZ);
  const normalized = text.replace(/\s+/g, "");

  if (/明天/.test(normalized)) {
    return endOfDayISO(base.add(1, "day"));
  }

  if (/后天/.test(normalized)) {
    return endOfDayISO(base.add(2, "day"));
  }

  if (/月底/.test(normalized)) {
    return endOfDayISO(base.endOf("month"));
  }

  const explicitDateMatch = normalized.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?(?:前|之前|截止)?/);
  if (explicitDateMatch) {
    const [, yearRaw, monthRaw, dayRaw] = explicitDateMatch;
    const month = Number(monthRaw);
    const day = Number(dayRaw);
    const year = yearRaw ? Number(yearRaw) : resolveYear(base, month, day);
    return endOfDayISO(
      dayjs.tz(
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} 23:59:59`,
        "YYYY-MM-DD HH:mm:ss",
        DEFAULT_TZ,
      ),
    );
  }

  const isoDateMatch = normalized.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoDateMatch) {
    const [, year, month, day] = isoDateMatch;
    return endOfDayISO(
      dayjs.tz(`${year}-${month}-${day} 23:59:59`, "YYYY-MM-DD HH:mm:ss", DEFAULT_TZ),
    );
  }

  const nextWeekMatch = normalized.match(/下周([一二三四五六日天])/);
  if (nextWeekMatch) {
    const targetWeekday = WEEKDAY_MAP[nextWeekMatch[1]];
    const currentWeekday = base.day();
    const daysUntil = 7 - currentWeekday + targetWeekday;
    return endOfDayISO(base.add(daysUntil, "day"));
  }

  const thisWeekMatch = normalized.match(/(?:这周|周)([一二三四五六日天])/);
  if (thisWeekMatch && !/下周/.test(normalized)) {
    const targetWeekday = WEEKDAY_MAP[thisWeekMatch[1]];
    let daysUntil = targetWeekday - base.day();
    if (daysUntil < 0) {
      daysUntil += 7;
    }
    return endOfDayISO(base.add(daysUntil, "day"));
  }

  return null;
}
