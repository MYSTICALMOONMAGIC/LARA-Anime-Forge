export function getAnalyticsState(): {
  analyticsEnabled: boolean
  installationId: string
} {
  return {
    analyticsEnabled: false,
    installationId: ''
  }
}

export function setAnalyticsEnabled(
  _enabled: boolean
): void {
  // Telemetria zewnętrzna jest wyłączona w LARA Anime Forge.
}

export async function sendAnalyticsEvent(
  _eventName: string,
  _extraDetails?: Record<string, unknown> | null
): Promise<void> {
  // LARA Anime Forge nie wysyła danych analitycznych
  // do zewnętrznych serwerów.
  return
}
