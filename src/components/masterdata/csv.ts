/** Turns the rows currently on screen into a CSV file the browser downloads. */
export function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const csv = [header, ...rows]
    .map((line) => line.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
