/** Estado de pausa das conexões (bot desligado). Listeners checam para evitar logs. */
let paused = false;

export function setConnectionsPaused(p: boolean): void {
  paused = p;
}

export function isConnectionsPaused(): boolean {
  return paused;
}
