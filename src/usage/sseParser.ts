/**
 * Minimal incremental Server-Sent Events parser. Feed decoded text chunks;
 * returns the `data:` payload of every completed event. Comments (`: ping`)
 * and other fields are ignored. Pure — no `vscode` imports.
 */
export class SseParser {
  private buffer = '';
  private dataLines: string[] = [];

  push(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r?\n/)) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + (this.buffer[newline] === '\r' ? 2 : 1));
      if (line === '') {
        if (this.dataLines.length > 0) {
          events.push(this.dataLines.join('\n'));
          this.dataLines = [];
        }
      } else if (line.startsWith('data:')) {
        this.dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return events;
  }
}
