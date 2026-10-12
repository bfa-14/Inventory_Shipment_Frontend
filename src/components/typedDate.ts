/**
 * A date typed (or pasted) into a DateInput, read DAY FIRST, as "YYYY-MM-DD" - or null when it is not a real date.
 *
 * THE ONE PARSER FOR TYPED DATES. The theme gives it to every DateInput (src/theme.ts), so no field passes its own.
 * Mantine's default parser ignores valueFormat (dayjs has no customParseFormat plugin here) and falls back to
 * `new Date(text)`, which reads "05/10/2026" as 10 May and turns half-typed text such as "31" into 2001. The people
 * using the app write the day first, so this reads only these shapes and nothing else:
 * - day, month, year: "5/10/2026", "05/10/2026", "5-10-26", "05.10.2026", "5 10 2026" - one or two digits for the
 *   day and the month, the same separator twice ("/", "-", "." or a space), a year of four digits or two (26 = 2026);
 * - a month name instead of the month number: "5 Oct 2026", "05 oct 2026", "5-October-26" (English, three letters or
 *   more, any case), the shape of the "DD MMM YYYY" fields;
 * - year first, as pasted from elsewhere: "2026-10-05" (also with "/", "." or a space), always two digits for the
 *   month and the day.
 * The day must exist in that month (31/02/2026 and 00/10/2026 are refused) and the year must be 1900-2099. Anything
 * else returns null, so DateInput keeps the last date it read and shows it again on blur.
 *
 * NO HALF-TYPED TEXT IS A DATE. DateInput parses at every key and keeps the last date that was not null, so the
 * beginning of a longer text must never parse: "29/02/20" on the way to 29/02/2027 would otherwise stay as 29 Feb
 * 2020 once "2027" turns out wrong. Hence the two-digit years 19 and 20 are refused (every accepted four-digit year
 * starts with them: type 2019 / 2020 in full), and year first needs "YYYY-MM-DD" ("2026-02-3" is not a date on the
 * way to 2026-02-31). A string, like the calendar's own picks, so the pages' onChange sees the same thing either way.
 */
export function parseTypedDate(value: string): string | null {
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null

  const dayFirst = /^(\d{1,2})([-/. ])(\d{1,2})\2(\d{4}|\d{2})$/.exec(text)
  if (dayFirst) return realDate(year(dayFirst[4]), Number(dayFirst[3]), Number(dayFirst[1]))

  const monthName = /^(\d{1,2})[-/. ]([a-z]{3,})\.?[-/. ](\d{4}|\d{2})$/i.exec(text)
  if (monthName) {
    const word = monthName[2].toLowerCase()
    const month = MONTHS.findIndex((name) => name.startsWith(word)) + 1
    return month > 0 ? realDate(year(monthName[3]), month, Number(monthName[1])) : null
  }

  const yearFirst = /^(\d{4})([-/. ])(\d{2})\2(\d{2})$/.exec(text)
  if (yearFirst) return realDate(Number(yearFirst[1]), Number(yearFirst[3]), Number(yearFirst[4]))

  return null
}

// Three letters already name one month only ("mar" March, "may" May, "jun" June, "jul" July).
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * A two-digit year is this century's: 26 = 2026. Except 19 and 20, which are the first half of a four-digit year
 * being typed (2026, 1999): they give 0, which realDate refuses.
 */
function year(digits: string): number {
  if (digits === '19' || digits === '20') return 0
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits)
}

/** "YYYY-MM-DD" when the day exists in that month of that year, else null (never rolled into the next month). */
function realDate(y: number, month: number, day: number): string | null {
  if (y < 1900 || y > 2099 || month < 1 || month > 12 || day < 1) return null
  // Day 0 of the next month is the last day of this one (month is 1-based here, 0-based for Date.UTC).
  if (day > new Date(Date.UTC(y, month, 0)).getUTCDate()) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
